/**
 * End-to-end smoke check for the analysis executor.
 *
 * Runs the real `runBioAnalysis` against the real Bio Service, using a real
 * sequence row and the real object out of S3. Nothing is stubbed.
 *
 * This is the check that matters for the contract fix: the previous code posted
 * to `/sequence/analyze` with `{ analysisType, sequenceId, projectId }`, and the
 * service answered `404`. The unit tests confirm what we send; only this
 * confirms the service accepts it.
 *
 * Usage:
 *   cd back && bun run scripts/smoke-bio-executor.ts [analysisType]
 *
 * Read-only. It performs one analysis call against the Bio Service.
 */

import { desc, isNotNull } from "drizzle-orm";

import { runBioAnalysis } from "../src/lib/bio-executor";
import { getDb } from "../src/db/client";
import { sequences } from "../src/db/schema";

const run = async () => {
	const analysisType = (process.argv[2] ?? "gc_content").trim();

	if (!/^[a-z0-9_]{1,64}$/.test(analysisType)) {
		throw new Error(`analysisType must match [a-z0-9_]{1,64}, got ${JSON.stringify(analysisType)}`);
	}

	const [row] = await getDb()
		.select({ id: sequences.id, filename: sequences.originalFilename, format: sequences.format })
		.from(sequences)
		.where(isNotNull(sequences.objectKey))
		.orderBy(desc(sequences.createdAt))
		.limit(50);

	// Prefer a row whose object actually parses, so the smoke test measures the
	// executor rather than tripping over one of the non-sequence storage fixtures
	// in the dev bucket.
	if (!row) throw new Error("no sequence row with an objectKey was found.");

	const { resolveSequenceContent } = await import("../src/lib/sequence-content");

	let chosen: { id: string; filename: string | null; length: number } | undefined;

	for (const candidate of [row, ...(await getDb()
		.select({ id: sequences.id, filename: sequences.originalFilename, format: sequences.format })
		.from(sequences)
		.where(isNotNull(sequences.objectKey))
		.orderBy(desc(sequences.createdAt))
		.limit(50))]) {
		try {
			const resolved = await resolveSequenceContent(candidate.id);
			chosen = { id: candidate.id, filename: candidate.filename, length: resolved.length };
			break;
		} catch {
			continue;
		}
	}

	if (!chosen) {
		throw new Error("no sequence row produced a parsable sequence.");
	}

	const { bioToolsFor } = await import("../src/lib/analysis-tool-map");

	let tools: readonly string[];

	try {
		tools = bioToolsFor(analysisType);
	} catch (error) {
		console.log(`using sequence ${chosen.id} (${chosen.filename ?? "unnamed"}, ${chosen.length} bases)`);
		throw error;
	}

	console.log(`using sequence ${chosen.id} (${chosen.filename ?? "unnamed"}, ${chosen.length} bases)`);
	console.log(`posting to the Bio Service as tools=${JSON.stringify(tools)}\n`);

	const started = Date.now();

	const outcome = await runBioAnalysis({
		// The Bio path reads neither of these; they are present only because the
		// job type carries them.
		analysisId: "00000000-0000-4000-8000-000000000000",
		projectId: "00000000-0000-4000-8000-000000000001",
		sequenceId: chosen.id,
		analysisType,
	});

	console.log(`ok in ${Date.now() - started}ms`);
	console.log(JSON.stringify(outcome, null, 2).slice(0, 1200));
};

run()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(`smoke failed: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	});
