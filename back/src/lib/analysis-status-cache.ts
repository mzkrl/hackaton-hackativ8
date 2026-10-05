import { getRedis, isRedisConfigured } from "./redis";

/**
 * Short-lived cache for analysis status reads.
 *
 * The status endpoint is polled on a timer for as long as a run takes, so it is
 * the highest-frequency read in the app. Without a cache, every poll is a Postgres
 * round trip for a row whose contents often have not changed since the last one.
 *
 * Fails **open**, unlike `rate-limit.ts`. A cache miss is merely slower, so if
 * Redis is unavailable every read goes to the database and the app keeps working.
 * Failing closed here would turn a cache outage into a total outage of the
 * feature the user is actively watching.
 *
 * ## Why there is no cross-process invalidation
 *
 * The worker writes `completed`/`failed` from a different process, and it could
 * not invalidate anyway without first looking up the owner of the analysis --
 * an extra query per job to fix something the TTL already bounds. So staleness is
 * bounded by TTL instead:
 *
 * - Pending rows are held for 2s, which is the same order as the frontend's poll
 *   interval. The worst case is one extra "still queued" frame before the client
 *   sees the real status.
 * - Terminal rows are held for 30s, and that is safe because a given analysis id
 *   is immutable once terminal: re-running creates a new row with a new id rather
 *   than mutating the old one.
 */

/** Terminal statuses are immutable, so they can be held far longer. */
const TERMINAL = new Set(["completed", "failed"]);

const PENDING_TTL_SECONDS = 2;
const TERMINAL_TTL_SECONDS = 30;

export type AnalysisStatusView = {
	id: string;
	status: string;
	queueJobId: string | null;
	errorMessage: string | null;
	updatedAt: Date | string;
};

/**
 * The key is scoped to the authenticated user, not just the analysis.
 *
 * This is the whole security property of the cache. The endpoint's authorisation
 * comes from `findOwnedAnalysis(id, userId)`. If the key were just the analysis
 * id, a hit would short-circuit that check, and because analysis ids are UUIDs
 * that are handed out to clients, anyone who learned another user's id could
 * read their run status without ever proving ownership. Baking the session's
 * user id into the key means a stored value is only ever returned to the same
 * principal that caused it to be stored.
 */
const cacheKey = (userId: string, analysisId: string) =>
	`analysis:status:${userId}:${analysisId}`;

const ttlFor = (status: string) =>
	TERMINAL.has(status) ? TERMINAL_TTL_SECONDS : PENDING_TTL_SECONDS;

export const readCachedStatus = async (
	userId: string,
	analysisId: string,
): Promise<AnalysisStatusView | undefined> => {
	if (!isRedisConfigured()) return undefined;

	try {
		const redis = await getRedis();
		const raw = await redis.get(cacheKey(userId, analysisId));

		if (!raw) return undefined;

		const parsed = JSON.parse(raw) as AnalysisStatusView;

		// `updatedAt` crosses the wire as JSON, so it arrives as a string. Validate
		// the shape rather than trusting the cast, so a future change to what gets
		// written cannot hand the client a malformed payload.
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof parsed.id !== "string" ||
			typeof parsed.status !== "string"
		) {
			return undefined;
		}

		return parsed;
	} catch (error) {
		console.warn("[analysis-status] cache read failed, falling back to postgres:", error);
		return undefined;
	}
};

export const writeCachedStatus = async (
	userId: string,
	view: AnalysisStatusView,
): Promise<void> => {
	if (!isRedisConfigured()) return;

	try {
		const redis = await getRedis();
		await redis.set(
			cacheKey(userId, view.id),
			JSON.stringify(view),
			"EX",
			ttlFor(view.status),
		);
	} catch (error) {
		// Never surface this: the read already succeeded, and failing the response
		// because a cache write failed would be a self-inflicted outage.
		console.warn("[analysis-status] cache write failed:", error);
	}
};

/**
 * Drops every cached status for a user.
 *
 * Called when an analysis row changes in a way that makes the cached view a lie
 * -- principally when a worker transitions it to `completed` or `failed`.
 */
export const invalidateCachedStatuses = async (
	userId: string,
	analysisIds: string[],
): Promise<void> => {
	if (!isRedisConfigured() || analysisIds.length === 0) return;

	try {
		const redis = await getRedis();
		await redis.del(...analysisIds.map((id) => cacheKey(userId, id)));
	} catch (error) {
		console.warn("[analysis-status] cache invalidation failed:", error);
	}
};
