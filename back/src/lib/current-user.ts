import { eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { guestSessions, users } from "../db/schema";
import { ApiError } from "./api-error";
import { isDevIdentityAllowed } from "./runtime";
import { readCookie, SESSION_COOKIE, verifySession } from "./session";

/**
 * Who a request is acting as.
 *
 * A guest is a real principal with the same rights over its own data as a user
 * has over theirs. The `kind` is not a privilege level — it is a discriminator
 * that ownership checks use to pick the column to match on, and that a few
 * routes use to decide whether an action is available at all (a guest cannot
 * claim itself into an account; it needs a real user to claim it).
 */
export type Principal =
	| { kind: "user"; id: string }
	| { kind: "guest"; id: string };

/**
 * The guest token format, in one place.
 *
 * The prefix doubles as the discriminator between a guest token and a signed
 * user token, and the suffix is 32 bytes of CSPRNG output. Both halves are load
 * bearing: the prefix routes `resolvePrincipal` to the right branch, and the
 * exact length is what makes a guess infeasible. Claiming a session is a
 * destructive, ownership-granting operation keyed on this string, so the claim
 * route validates the whole shape rather than trusting the prefix alone — a
 * prefix-only check would let `gs_` through and silently claim nothing.
 */
export const GUEST_TOKEN_PREFIX = "gs_";

const GUEST_TOKEN_BODY = /^[0-9a-f]{64}$/;

/** True only for a token this server could have issued. */
export const isGuestToken = (value: string): boolean =>
	value.startsWith(GUEST_TOKEN_PREFIX) && GUEST_TOKEN_BODY.test(value.slice(GUEST_TOKEN_PREFIX.length));

/** Mints a token. The random source is the platform CSPRNG, never `Math.random`. */
export const newGuestToken = (): string => {
	const bytes = new Uint8Array(32);

	crypto.getRandomValues(bytes);

	return `${GUEST_TOKEN_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
};

/**
 * Resolves the caller from the session cookie alone.
 *
 * This deliberately does not touch the database for a user session. The token
 * is HMAC-signed and short-lived, and every ownership check already re-reads the
 * row, so an extra lookup per request would buy nothing.
 *
 * A guest token is different: it is a random opaque value with no signature to
 * verify, so the only way to know it is still valid is to look it up. That is
 * one indexed primary-key read, and it is what makes expiry enforceable — a
 * signed token carries its own expiry, a stored one has to be checked.
 */
export const resolvePrincipal = async (request: Request): Promise<Principal | null> => {
	const token = readCookie(request, SESSION_COOKIE);
	if (!token) return null;

	// Guest session: gs_<64hex>. The prefix is a type discriminator, so the two
	// kinds never collide and a user token can never be mistaken for a guest one.
	if (token.startsWith(GUEST_TOKEN_PREFIX)) {
		const [session] = await getDb()
			.select()
			.from(guestSessions)
			.where(eq(guestSessions.id, token))
			.limit(1);

		if (!session) return null;
		if (session.expiresAt.getTime() <= Date.now()) return null;

		return { kind: "guest", id: token };
	}

	const userId = await verifySession(token);
	if (!userId) return null;

	return { kind: "user", id: userId };
};

/**
 * @deprecated Use `requirePrincipal`. Retained for the few routes that genuinely
 * need a user account rather than any authenticated principal.
 */
export const resolveUserId = async (request: Request): Promise<string | null> => {
	const principal = await resolvePrincipal(request);
	return principal?.kind === "user" ? principal.id : null;
};

/**
 * Announced once per process, so a shared identity is never invisible.
 *
 * The reason this is noisy: the dev fallback used to engage silently whenever a
 * session cookie was missing. That is indistinguishable from "logged in", which
 * is how a SameSite mismatch between the frontend host and the API host presents
 * — register returns 201, every later read returns the dev account, and nothing
 * anywhere reports an error. Anyone hitting this in a browser should treat it as
 * a broken session, not a feature.
 */
let devIdentityAnnounced = false;

export const warnDevIdentityAtStartup = () => {
	if (!isDevIdentityAllowed() || devIdentityAnnounced) return;

	devIdentityAnnounced = true;
	console.warn(
		"[auth] DEV IDENTITY ENABLED — any request without a valid session cookie is " +
			`impersonated as ${(process.env.DEV_USER_EMAIL ?? "developer@local.test")
				.trim()
				.toLowerCase()}. Never set ALLOW_DEV_AUTH on a public deployment.`,
	);
};

const devUserId = async (): Promise<string> => {
	warnDevIdentityAtStartup();

	const email = (process.env.DEV_USER_EMAIL ?? "developer@local.test")
		.trim()
		.toLowerCase();

	const [user] = await getDb()
		.insert(users)
		.values({
			email,
			name: "Local Developer",
			passwordHash: `disabled:${crypto.randomUUID()}`,
		})
		.onConflictDoUpdate({
			target: users.email,
			set: { updatedAt: new Date() },
		})
		.returning({ id: users.id });

	return user.id;
};

/**
 * The principal every route acts as, or 401.
 *
 * A real session always wins. The shared dev identity is a local convenience
 * that requires `ALLOW_DEV_AUTH` to be explicitly set *and* the runtime to not be
 * the hosted VPS, so an unconfigured deployment authenticates for itself instead
 * of handing every anonymous visitor the same account.
 */
export const requirePrincipal = async (request: Request): Promise<Principal> => {
	const principal = await resolvePrincipal(request);
	if (principal) {
		return principal;
	}

	if (!isDevIdentityAllowed()) {
		throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
	}

	return { kind: "user", id: await devUserId() };
};

/**
 * The user id every route acts as, or 401.
 *
 * @deprecated Use `requirePrincipal`. This is for the few routes that genuinely
 * need a user account — claiming a guest session, for instance — and would
 * otherwise have to assert `kind === "user"` themselves.
 */
export const requireUserId = async (request: Request): Promise<string> => {
	const principal = await requirePrincipal(request);

	if (principal.kind !== "user") {
		throw new ApiError(401, "UNAUTHENTICATED", "A user account is required.");
	}

	return principal.id;
};
