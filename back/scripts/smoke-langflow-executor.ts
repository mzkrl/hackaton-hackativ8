/**
 * End-to-end smoke check for the Langflow executor, including the optional
 * Insight Analyst interpretation.
 *
 * Runs the real `runLangflowAnalysis` against the real Langflow instance with a
 * real sequence row and the real object out of S3, then normalises the outcome
 * exactly the way `analysis-executor.ts` does, so this prints what `result_json`
 * would actually hold for the frontend.
 *
 * Nothing is stubbed. Requires LANGFLOW_URL, LANGFLOW_MAIN_FLOW_ID and
 * LANGFLOW_API_KEY. When LANGFLOW_INSIGHT_FLOW_ID is set the AI interpretation
 * is requested as well.
 *
 * Usage:
 *   cd back && bun run scripts/smoke-langflow-executor.ts [analysisType]
 *
 * Read-only. It performs one analysis run (plus one insight run when enabled).
 */

import { desc, isNotNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { sequences } from "../src/db/schema";
import { runLangflowAnalysis } from "../src/lib/langflow-executor";
import { normalizeAnalysisOutcome } from "../src/lib/normalize-result";

const run = async () => {
	const analysisType = (process.argv[2] ?? "gc_content").trim();

	if (!/^[a-z0-9_]{1,64}$/.test(analysisType)) {
		throw new Error(`analysisType must match [a-z0-9_]{1,64}, got ${JSON.stringify(analysisType)}`);
	}

	if (!process.env.LANGFLOW_URL?.trim() || !process.env.LANGFLOW_MAIN_FLOW_ID?.trim()) {
		throw new Error(
			"LANGFLOW_URL and LANGFLOW_MAIN_FLOW_ID must be set (bun loads back/.env automatically).",
		);
	}

	const rows = await getDb()
		.select({ id: sequences.id, filename: sequences.originalFilename })
		.from(sequences)
		.where(isNotNull(sequences.objectKey))
		.orderBy(desc(sequences.createdAt))
		.limit(50);

	if (rows.length === 0) throw new Error("no sequence row with an objectKey was found.");

	const { resolveSequenceContent } = await import("../src/lib/sequence-content");

	let chosen: { id: string; filename: string | null; length: number } | undefined;

	for (const candidate of rows) {
		try {
			const resolved = await resolveSequenceContent(candidate.id);
			chosen = { id: candidate.id, filename: candidate.filename, length: resolved.length };
			break;
		} catch {
			continue;
		}
	}

	if (!chosen) throw new Error("no sequence row produced a parsable sequence.");

	console.log(
		`using sequence ${chosen.id} (${chosen.filename ?? "unnamed"}, ${chosen.length} bases), analysis_type=${analysisType}`,
	);
	console.log(
		`insight flow: ${process.env.LANGFLOW_INSIGHT_FLOW_ID?.trim() ? process.env.LANGFLOW_INSIGHT_FLOW_ID.trim() : "(disabled)"}\n`,
	);

	const started = Date.now();

	const outcome = await runLangflowAnalysis({
		analysisId: "00000000-0000-4000-8000-000000000000",
		projectId: "00000000-0000-4000-8000-000000000001",
		sequenceId: chosen.id,
		analysisType,
	});

	const normalized = normalizeAnalysisOutcome(outcome);

	console.log(`ok in ${Date.now() - started}ms\n`);

	if (typeof normalized.insight === "string" && normalized.insight.trim()) {
		console.log("--- insight ---");
		console.log(normalized.insight);
		console.log("---------------\n");
	} else {
		console.log("no insight returned (flow disabled or best-effort failure)\n");
	}

	console.log(JSON.stringify(normalized, null, 2).slice(0, 2000));
};

run()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(`smoke failed: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	});
