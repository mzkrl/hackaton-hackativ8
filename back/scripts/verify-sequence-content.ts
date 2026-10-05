/**
 * Reads real sequence rows out of Postgres, pulls their objects out of S3, and
 * reports what the parser made of each one.
 *
 * The unit tests for `parseSequenceText` use hand-written fixtures, which can
 * agree with the parser and still both be wrong about what the upload path
 * actually stores. This runs the same code over real objects, so a format
 * nobody anticipated -- a vendor GenBank with an unusual header, a FASTA with a
 * wrapped description -- shows up as a parse failure instead of as a silently
 * wrong analysis result.
 *
 * Usage:
 *   cd back && bun run scripts/verify-sequence-content.ts [limit]
 *
 * Read-only: it selects rows and calls GetObject. Nothing is written.
 */

import { desc, isNotNull } from "drizzle-orm";

import { getDb } from "../src/db/client";
import { sequences } from "../src/db/schema";
import { resolveSequenceContent } from "../src/lib/sequence-content";

const run = async () => {
	const limit = Number(process.argv[2] ?? 10);

	if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
		throw new Error(`limit must be an integer 1..200, got ${process.argv[2]}`);
	}

	const rows = await getDb()
		.select({
			id: sequences.id,
			format: sequences.format,
			filename: sequences.originalFilename,
			objectKey: sequences.objectKey,
			metadataLength: sequences.sequenceLength,
		})
		.from(sequences)
		.where(isNotNull(sequences.objectKey))
		.orderBy(desc(sequences.createdAt))
		.limit(limit);

	console.log(`checking ${rows.length} sequence row(s) with a stored object\n`);

	let ok = 0;
	const failures: string[] = [];

	for (const row of rows) {
		try {
			const resolved = await resolveSequenceContent(row.id);
			// A large gap between the parsed length and the stored metadata means
			// the parser dropped or invented bases, which is the failure that
			// matters even when the parse "succeeds".
			const delta =
				row.metadataLength === null ? null : resolved.length - row.metadataLength;

			console.log(
				`  ok    ${row.format.padEnd(8)} parsed=${String(resolved.length).padStart(9)}` +
					`  meta=${String(row.metadataLength ?? "-").padStart(9)}` +
					`  delta=${delta === null ? "-" : String(delta).padStart(8)}  ${row.filename ?? "(no filename)"}`,
			);
			ok += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.log(`  FAIL  ${row.format.padEnd(8)} ${row.filename ?? "(no filename)"}`);
			console.log(`        ${message}`);
			failures.push(`${row.id}: ${message}`);
		}
	}

	console.log(`\n${ok} ok, ${failures.length} failed, of ${rows.length} checked`);

	if (failures.length > 0) {
		console.log("\nfailures:");
		for (const failure of failures) console.log(`  - ${failure}`);
		process.exitCode = 1;
	}
};

run()
	.then(() => process.exit(process.exitCode ?? 0))
	.catch((error) => {
		console.error(`verify failed: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	});
