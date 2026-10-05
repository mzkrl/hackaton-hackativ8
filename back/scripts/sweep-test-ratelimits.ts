/**
 * Clears rate-limit counters created by local test traffic.
 *
 * The integration suite in `__tests__/api/` creates a fresh user per test, and
 * `auth.register` is limited to a handful per hour keyed by client IP. Every
 * local run comes from 127.0.0.1, so they all share one bucket and the suite
 * starts returning 429 partway through -- which reads like dozens of unrelated
 * product failures rather than one exhausted bucket.
 *
 * Scoped deliberately: it only sweeps the scopes the suite exercises, so it
 * cannot clear a real user's budget.
 *
 * Usage:
 *   cd back && bun run scripts/sweep-test-ratelimits.ts
 */

import { getRedis } from "../src/lib/redis";

/** The scopes `__tests__/api/` drives hard enough to exhaust a shared bucket. */
const SUITE_SCOPES = [
	"auth.register",
	"auth.login",
	"analysis.status",
	"analysis.queue",
	"storage.presign",
	"storage.mutate",
];

const run = async () => {
	const redis = await getRedis();
	let total = 0;

	for (const scope of SUITE_SCOPES) {
		const keys = await redis.keys(`rl:${scope}:*`);
		if (keys.length > 0) await redis.del(...keys);
		total += keys.length;
		console.log(`  ${scope.padEnd(18)} swept ${keys.length}`);
	}

	console.log(`total swept: ${total}`);
	await redis.quit();
};

run().catch((error) => {
	console.error(`sweep failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
