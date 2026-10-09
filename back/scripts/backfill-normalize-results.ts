/**
 * One-off backfill: normalise `analyses.result_json` rows that were written
 * before the worker normalised its output.
 *
 * Before `normalize-result.ts` existed the worker stored the executor's wrapped
 * shape (`{ source, results }` or `{ source, outputs }`), which the frontend
 * cannot render and dumped as raw JSON. New runs are normalised in the worker;
 * this rewrites the old rows to the same flat shape so their cards render too.
 *
 * Safety:
 *   * Dry-run by default. Nothing is written unless you pass `--apply`.
 *   * Only touches rows that still carry the wrapped shape (`results` object or
 *     `outputs` array). A row that is already flat is skipped, because running
 *     `normalizeAnalysisOutcome` on flat data would drop the flat fields.
 *   * Only the `result_json` column is changed; status, errors and timestamps
 *     are left alone.
 *
 * Usage:
 *   cd back && bun run scripts/backfill-normalize-results.ts          # dry run
 *   cd back && bun run scripts/backfill-normalize-results.ts --apply  # write
 */

import { eq, isNotNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { analyses } from "../src/db/schema";
import { normalizeAnalysisOutcome } from "../src/lib/normalize-result";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

/** Rows written by the pre-normalisation worker. */
const isWrapped = (result: Record<string, unknown>): boolean =>
	isRecord(result.results) || Array.isArray(result.outputs);

const apply = process.argv.includes("--apply");

const run = async () => {
	const rows = await getDb()
		.select({
			id: analyses.id,
			analysisType: analyses.analysisType,
			resultJson: analyses.resultJson,
		})
		.from(analyses)
		.where(isNotNull(analyses.resultJson));

	let scanned = 0;
	let rewritten = 0;
	let unchanged = 0;

	for (const row of rows) {
		scanned += 1;

		const result = row.resultJson;

		if (!isRecord(result) || !isWrapped(result)) {
			unchanged += 1;
			continue;
		}

		const normalized = normalizeAnalysisOutcome(result);
		const before = JSON.stringify(result);
		const after = JSON.stringify(normalized);

		if (before === after) {
			unchanged += 1;
			continue;
		}

		rewritten += 1;
		console.log(`${apply ? "rewrite" : "would rewrite"} ${row.id} (${row.analysisType})`);
		console.log(`  before: ${before.slice(0, 200)}`);
		console.log(`  after:  ${after.slice(0, 200)}`);

		if (apply) {
			await getDb()
				.update(analyses)
				.set({ resultJson: normalized, updatedAt: new Date() })
				.where(eq(analyses.id, row.id));
		}
	}

	console.log(
		`\n${apply ? "applied" : "dry run"}: scanned ${scanned}, ${apply ? "rewrote" : "would rewrite"} ${rewritten}, left ${unchanged} unchanged.`,
	);

	if (!apply) {
		console.log("Re-run with --apply to write these changes.");
	}
};

run()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(`backfill failed: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	});
