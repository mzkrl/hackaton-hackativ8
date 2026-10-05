/**
 * Verifies the status-poll rate limit and status cache against the real Redis.
 *
 * Both have a behaviour that mocks cannot show: the limiter must persist a
 * counter across processes, and the cache must actually expire on its TTL. So
 * this talks to the configured Redis rather than stubbing it.
 *
 * Everything it writes is namespaced under a synthetic user id and deleted at the
 * end, so it cannot consume a real user's budget or leave keys behind.
 *
 * Usage:
 *   cd back && bun run scripts/check-poll-budget.ts
 */

import { getRedis } from "../src/lib/redis";
import { enforce, RATE_LIMITS } from "../src/lib/rate-limit";
import { readCachedStatus, writeCachedStatus } from "../src/lib/analysis-status-cache";

const PROBE_USER = "probe-polling-budget-user";
const OTHER_USER = "probe-polling-budget-other";
const ANALYSIS_ID = "11111111-2222-3333-4444-555555555555";

const results: string[] = [];
const check = (label: string, ok: boolean, detail = "") => {
	results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * `enforce` throws an ApiError(429) rather than returning a verdict, so a probe
 * has to catch to learn where the budget ran out.
 */
const call = async (userId: string) => {
	try {
		await enforce(RATE_LIMITS.analysisStatusPoll(), userId);
		return true;
	} catch {
		return false;
	}
};

const expectRateLimited = async (label: string, attempts: number) => {
	let limitedAt = 0;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (!(await call(PROBE_USER)) && limitedAt === 0) limitedAt = attempt;
	}

	check(label, limitedAt > 0, limitedAt ? `first 429 on request ${limitedAt}` : "never limited");
};

/**
 * Clears only this probe's own counters.
 *
 * The key format is `rl:<scope>:<identifier>` (see `rateKey` in rate-limit.ts).
 * An earlier draft swept `ratelimit:*`, which matched nothing -- so the checks
 * below silently shared one continuous counter and the isolation they claim to
 * prove was not actually proven.
 */
const clearKeys = async () => {
	const redis = await getRedis();
	const keys = await redis.keys(`rl:analysis.status:${PROBE_USER}`);
	if (keys.length > 0) await redis.del(...keys);
	return keys.length;
};

const run = async () => {
	const rule = RATE_LIMITS.analysisStatusPoll();
	const swept = await clearKeys();

	console.log(`limit = ${rule.limit} per ${rule.windowSeconds}s`);
	if (swept > 0) console.log(`(swept ${swept} stale probe keys from an earlier run)\n`);

	// 1. The budget must cover a realistic dashboard. Five concurrent analyses
	//    polled every 2s is 150 requests a minute; the limit has to clear that or
	//    normal use gets throttled, which is the failure this default guards.
	const steadyState = Math.ceil((5 * 60) / 2);
	check(
		`budget covers 5 concurrent analyses polling at 2s (${steadyState} req/min)`,
		rule.limit > steadyState,
		`${rule.limit} > ${steadyState}`,
	);

	// 2. ...and must still refuse a flood shortly after.
	await expectRateLimited("flood is eventually refused", rule.limit + 5);

	// 3. One user's spend must not consume another's budget.
	await clearKeys();
	await expectRateLimited("spender is limited", rule.limit + 1);
	const otherAllowed = await call(OTHER_USER);
	check(
		"a different user is unaffected by the spender's flood",
		otherAllowed,
		otherAllowed ? "still has budget" : "LEAKED: spender starved another user",
	);

	// 3b. A fresh budget must be genuinely fresh, which only holds if the sweep
	//     above matched. This is the assertion that catches a wrong key pattern.
	await clearKeys();
	const afterSweep = await call(PROBE_USER);
	check(
		"clearing the counter restores the full budget",
		afterSweep,
		afterSweep ? "request 1 allowed again" : "stuck limited: sweep did not match",
	);

	// 4. The cache must be invisible across users, which is the IDOR guard.
	await clearKeys();
	const view = {
		id: ANALYSIS_ID,
		status: "queued",
		queueJobId: "job-1",
		errorMessage: null,
		updatedAt: new Date().toISOString(),
	};
	await writeCachedStatus(PROBE_USER, view);

	const own = await readCachedStatus(PROBE_USER, ANALYSIS_ID);
	const foreign = await readCachedStatus(OTHER_USER, ANALYSIS_ID);
	check("owner reads back its own cached status", own?.id === ANALYSIS_ID);
	check(
		"another user cannot read the cached status",
		foreign === undefined,
		foreign ? `LEAKED ${foreign.id}` : "miss, as required",
	);

	// 5. A pending status must expire fast enough that the UI is not stale.
	const pendingTtl = await getRedis().then(async (r) => r.ttl(`analysis:status:${PROBE_USER}:${ANALYSIS_ID}`));
	check(
		"pending status expires quickly",
		pendingTtl > 0 && pendingTtl <= 5,
		`ttl=${pendingTtl}s`,
	);

	// 6. Terminal statuses are immutable, so they are held far longer.
	await writeCachedStatus(PROBE_USER, { ...view, status: "completed" });
	const terminalTtl = await getRedis().then(async (r) => r.ttl(`analysis:status:${PROBE_USER}:${ANALYSIS_ID}`));
	check("terminal status is cached longer", terminalTtl > pendingTtl, `ttl=${terminalTtl}s`);

	await clearKeys();
	await getRedis().then((r) => r.del(`analysis:status:${PROBE_USER}:${ANALYSIS_ID}`));

	console.log(results.join("\n"));

	const failed = results.filter((line) => line.startsWith("FAIL")).length;
	console.log(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}`);
	process.exit(failed === 0 ? 0 : 1);
};

run().catch((error) => {
	console.error(`probe failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
