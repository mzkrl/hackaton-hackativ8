import { ApiError } from "./api-error";
import { getRedis, isRedisConfigured } from "./redis";

/**
 * Redis-backed fixed-window rate limiting.
 *
 * Why this exists: `/auth/login` is unauthenticated and verifies a PBKDF2 hash
 * at 210_000 iterations, which is deliberately slow. Without a limit, login is
 * both a brute-force surface and a CPU amplifier — a few hundred requests can
 * saturate a core. `/storage/presign` and `POST /analyses` are unbounded writers
 * (database rows, queue jobs), so they are limited per authenticated user.
 *
 * Two properties this file is careful about:
 *
 * 1. The counter is shared state, not per-process. An in-process `Map` would
 *    give each API instance its own budget, so N instances means N x limit, and
 *    a restart hands everyone a fresh allowance.
 *
 * 2. It fails closed. If Redis is unreachable the limit cannot be enforced, so
 *    the request is refused with 503 rather than waved through. A limiter that
 *    fails open is not a limiter. The error code is distinct from a real 429 so
 *    the UI can tell "you are being rate limited" apart from "the limiter is
 *    broken".
 */

export type RateLimitRule = {
	/** Logical bucket, e.g. "auth.login". Keeps windows from colliding. */
	scope: string;
	/** Maximum requests allowed inside the window. */
	limit: number;
	/** Window length in seconds. */
	windowSeconds: number;
};

export type RateLimitResult = {
	allowed: boolean;
	limit: number;
	remaining: number;
	/** Unix seconds at which the current window ends. */
	resetAt: number;
};

const num = (value: string | undefined, fallback: number) => {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Reads a limit from the environment, defaulting to `fallback`.
 *
 * `0` disables the limiter for that route. That is a deliberate operator
 * choice for local work, not something a request can influence.
 */
const limitFromEnv = (envKey: string, fallback: number) => {
	const raw = process.env[envKey];
	if (raw === undefined) return fallback;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return fallback;
	return Math.floor(parsed);
};

/**
 * The client address, used only as a rate-limit correlation key.
 *
 * This is never an identity and never authorizes anything: it is a hint from
 * the network layer, and a caller who can forge it only changes which bucket
 * they are counted against. Authorization always comes from the session.
 *
 * `TRUSTED_IP_HEADER` names the header that carries the real address. The API
 * binds to loopback and is published by a tunnel, so the tunnel rewrites this
 * header and no direct caller can reach the process to forge it. If you expose
 * the API directly, set it to a header you actually control, or leave it unset
 * and every caller shares one bucket.
 */
export const clientIp = (request: Request): string => {
	const header = process.env.TRUSTED_IP_HEADER?.trim();

	if (header) {
		const value = request.headers.get(header)?.trim();
		if (value) return value.slice(0, 64);
	}

	return "unknown";
};

/**
 * Same as `clientIp`, but raises instead of silently bucketing every caller
 * together.
 *
 * One shared bucket is not a broken limiter — it is a limiter that applies the
 * same budget to everybody, so one noisy client throttles the rest. When the
 * header that identifies the caller is missing the safe behaviour is to stop,
 * not to lump everyone into `unknown`.
 *
 * Set `TRUSTED_IP_HEADER` to the header your proxy sets. With the API bound to
 * loopback behind a tunnel that is `cf-connecting-ip`; the tunnel rewrites it
 * and no other process can reach the listener to forge it. Set
 * `RATE_LIMIT_FALLBACK_TO_UNKNOWN=1` to accept the shared bucket anyway, which
 * is convenient locally and wrong in production.
 */
export const requireClientIp = (request: Request): string => {
	const address = clientIp(request);

	if (address !== "unknown") {
		return address;
	}

	if (process.env.RATE_LIMIT_FALLBACK_TO_UNKNOWN === "1") {
		return address;
	}

	throw new ApiError(
		503,
		"RATE_LIMIT_UNAVAILABLE",
		"Cannot identify the caller for rate limiting. TRUSTED_IP_HEADER is not set.",
	);
};

/**
 * Counts one hit and returns whether it is inside the budget.
 *
 * `INCR` then `EXPIRE` only when the counter has no expiry yet. Re-setting the
 * expiry on every hit would slide the window forward indefinitely and let a
 * caller who keeps requesting never actually be limited.
 */
export const consume = async (
	rule: RateLimitRule,
	identifier: string,
): Promise<RateLimitResult> => {
	if (rule.limit <= 0) {
		return {
			allowed: true,
			limit: 0,
			remaining: Number.POSITIVE_INFINITY,
			resetAt: 0,
		};
	}

	if (!isRedisConfigured()) {
		throw new ApiError(
			503,
			"RATE_LIMIT_UNAVAILABLE",
			"Rate limiting is not configured on this deployment.",
		);
	}

	const windowSeconds = num(
		process.env[`RATE_LIMIT_${rule.scope.replace(/\./g, "_").toUpperCase()}_WINDOW_SECONDS`],
		rule.windowSeconds,
	);

	const key = `rl:${rule.scope}:${identifier}`;
	const nowSeconds = Math.floor(Date.now() / 1000);

	let count: number;
	let ttl: number;

	try {
		const redis = await getRedis();
		const replies = (await redis.multi().incr(key).ttl(key).exec()) as
			| [Error | null, unknown][]
			| null;

		if (!replies) {
			throw new Error("rate-limit transaction returned no replies");
		}

		const [incrError, incrReply] = replies[0] ?? [];
		const [ttlError, ttlReply] = replies[1] ?? [];

		if (incrError) throw incrError;
		if (ttlError) throw ttlError;

		count = Number(incrReply);
		ttl = Number(ttlReply ?? -1);

		// A fresh counter has no expiry. Starting it here, and only here, opens
		// the window without extending it on later hits.
		if (ttl < 0) {
			await redis.expire(key, windowSeconds);
			ttl = windowSeconds;
		}
	} catch (error) {
		console.error(`[rate-limit] ${rule.scope}: counter unavailable, failing closed:`, error);

		throw new ApiError(
			503,
			"RATE_LIMIT_UNAVAILABLE",
			"Rate limiting is temporarily unavailable. Please retry.",
		);
	}

	return {
		allowed: count <= rule.limit,
		limit: rule.limit,
		remaining: Math.max(0, rule.limit - count),
		resetAt: nowSeconds + Math.max(ttl, 0),
	};
};

/**
 * Consumes one hit or throws 429.
 *
 * The identifier may be a thunk. Resolving it lazily matters: a disabled rule
 * (`limit: 0`) must not pay for caller identification, and the identity helpers
 * raise when they cannot attribute a request. Evaluating the argument eagerly
 * would make turning a limit off still require the header it depends on.
 *
 * Throwing keeps every call site down to a single line, which is the point: a
 * limit that has to be remembered at each call site is a limit that will be
 * forgotten at one of them.
 */
export const enforce = async (
	rule: RateLimitRule,
	identifier: string | (() => string),
): Promise<RateLimitResult> => {
	if (rule.limit <= 0) {
		return {
			allowed: true,
			limit: 0,
			remaining: Number.POSITIVE_INFINITY,
			resetAt: 0,
		};
	}

	const key = typeof identifier === "function" ? identifier() : identifier;
	const result = await consume(rule, key);

	if (!result.allowed) {
		const retryAfter = Math.max(1, result.resetAt - Math.floor(Date.now() / 1000));

		throw new ApiError(
			429,
			"RATE_LIMITED",
			"Too many requests. Please wait and try again.",
			{ retryAfter, limit: result.limit, scope: rule.scope },
		);
	}

	return result;
};

/* ------------------------------------------------------------------ rules --- */

/**
 * The budgets actually applied, so the route files stay declarative and the
 * whole policy is readable in one place.
 *
 * Login is the tightest because each attempt costs a 210k-iteration hash.
 */
export const RATE_LIMITS = {
	authLogin: (): RateLimitRule => ({
		scope: "auth.login",
		limit: limitFromEnv("RATE_LIMIT_AUTH_LOGIN", 10),
		windowSeconds: num(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_SECONDS, 15 * 60),
	}),
	authRegister: (): RateLimitRule => ({
		scope: "auth.register",
		limit: limitFromEnv("RATE_LIMIT_AUTH_REGISTER", 5),
		windowSeconds: num(process.env.RATE_LIMIT_AUTH_REGISTER_WINDOW_SECONDS, 60 * 60),
	}),

	/**
	 * Guest session creation.
	 *
	 * Keyed on client address, not on a principal: there is no principal yet.
	 * The limit is tight because a guest session is free to create and each one
	 * is a row in the database plus a cookie; an unbounded endpoint here is a
	 * way to fill both.
	 */
	authGuest: (): RateLimitRule => ({
		scope: "auth.guest",
		limit: limitFromEnv("RATE_LIMIT_AUTH_GUEST", 10),
		windowSeconds: num(process.env.RATE_LIMIT_AUTH_GUEST_WINDOW_SECONDS, 60 * 60),
	}),
	analysisQueue: (): RateLimitRule => ({
		scope: "analysis.queue",
		limit: limitFromEnv("RATE_LIMIT_ANALYSIS_QUEUE", 30),
		windowSeconds: num(process.env.RATE_LIMIT_ANALYSIS_QUEUE_WINDOW_SECONDS, 60 * 60),
	}),
	storagePresign: (): RateLimitRule => ({
		scope: "storage.presign",
		limit: limitFromEnv("RATE_LIMIT_STORAGE_PRESIGN", 60),
		windowSeconds: num(process.env.RATE_LIMIT_STORAGE_PRESIGN_WINDOW_SECONDS, 60 * 60),
	}),
	storageUpload: (): RateLimitRule => ({
		scope: "storage.upload",
		limit: limitFromEnv("RATE_LIMIT_STORAGE_UPLOAD", 30),
		windowSeconds: num(process.env.RATE_LIMIT_STORAGE_UPLOAD_WINDOW_SECONDS, 60 * 60),
	}),
	storageMutate: (): RateLimitRule => ({
		scope: "storage.mutate",
		limit: limitFromEnv("RATE_LIMIT_STORAGE_MUTATE", 60),
		windowSeconds: num(process.env.RATE_LIMIT_STORAGE_MUTATE_WINDOW_SECONDS, 60 * 60),
	}),

	/**
	 * Budget for `GET /analyses/:id/status`, which the frontend calls on a timer.
	 *
	 * Generous on purpose, and windowed per minute rather than per hour. A run can
	 * take up to `LANGFLOW_TIMEOUT_MS`, and a 2-second poll is 30 requests a minute
	 * per analysis; a dashboard watching a handful of runs multiplies that. A
	 * tighter limit would throttle a legitimate dashboard rather than an attacker,
	 * and the symptom would be a stuck-looking UI instead of a logged error.
	 *
	 * A minute window also fits the abuse signal. Polling floods arrive in bursts,
	 * and an hourly window cannot express that -- it would let a burst spend the
	 * whole budget in seconds and then lock a real user out for the rest of the hour.
	 *
	 * The real defence against a polling flood is the short-TTL Redis cache in
	 * `analysis-status-cache.ts`, which answers repeats without touching Postgres.
	 * This limit is the backstop for a client hammering past what the cache absorbs.
	 */
	analysisStatusPoll: (): RateLimitRule => ({
		scope: "analysis.status",
		limit: limitFromEnv("RATE_LIMIT_ANALYSIS_STATUS_POLL", 240),
		windowSeconds: num(process.env.RATE_LIMIT_ANALYSIS_STATUS_POLL_WINDOW_SECONDS, 60),
	}),
} satisfies Record<string, () => RateLimitRule>;
