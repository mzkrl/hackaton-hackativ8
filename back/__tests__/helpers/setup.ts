import { db } from "./db";

/**
 * A single shared readiness check: the API must be up and the database must
 * answer before any suite makes assertions, so a dead service is reported once
 * rather than as dozens of confusing failures.
 */
export const assertStackReady = async (url: string) => {
	const response = await fetch(`${url}/health`);

	if (!response.ok) {
		throw new Error(`API health check failed: ${response.status}`);
	}

	const body = (await response.json()) as { database?: string };

	if (body.database !== "connected") {
		throw new Error(`API reports database=${body.database}, expected "connected"`);
	}
};

/**
 * Verifies the test client can actually reach postgres.
 *
 * Call this from a suite that wants the probe. Do not pair it with an
 * `afterAll` that closes `db`: the client in `helpers/db.ts` is a module-level
 * singleton with `max: 1`, and Bun runs test files in a single process, so
 * closing it from one file leaves every later file holding a dead connection.
 * The suite-wide `bun test` teardown handles closing it instead — which is why
 * no test file calls `registerLifecycle`.
 */
export const assertDatabaseReachable = async () => {
	const rows = await db`select 1 as ok`;

	if (Number(rows[0]!.ok) !== 1) {
		throw new Error("database probe failed");
	}
};
