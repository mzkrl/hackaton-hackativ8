/**
 * Prints the analysis dependency report without going through the HTTP server.
 *
 * `/health/dependencies` requires the API to be running. This runs the same
 * checks in-process so the wiring can be verified from the dev box, where the
 * API is usually not up.
 *
 * Usage:
 *   cd back && bun run scripts/check-dependencies.ts
 */

import { checkAnalysisDependencies, dependenciesReady } from "../src/lib/analysis-dependencies";

const run = async () => {
	const statuses = await checkAnalysisDependencies();

	for (const status of statuses) {
		const mark = !status.configured ? "-" : status.reachable ? "+" : "!";
		console.log(`${mark} ${status.name.padEnd(22)} ${status.detail ?? ""}`);
	}

	const ready = dependenciesReady(statuses);
	console.log(`\ndependenciesReady = ${ready}`);

	// A non-ready report is information, not a crash: on a dev box that has
	// deliberately left Langflow unconfigured, failing here would be wrong.
	if (!ready) console.log("(some configured dependency did not answer)");

	process.exit(0);
};

run().catch((error) => {
	console.error(`check failed: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
});
