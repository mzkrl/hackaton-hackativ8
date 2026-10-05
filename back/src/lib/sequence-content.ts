/**
 * Resolves the raw nucleotide text for a stored sequence.
 *
 * The `sequences` table deliberately holds only metadata -- length, hash, format,
 * and the `objectKey` of the uploaded file. The bases themselves live in object
 * storage. That split is right: it keeps multi-megabyte files out of Postgres and
 * out of every query that joins against a sequence.
 *
 * It has one consequence that is easy to miss: an analysis job carries only ids,
 * so nothing in the job payload contains the sequence. Both executors need actual
 * text -- the Bio API's `POST /analyze` takes a required `sequence` string, and
 * Langflow's webhook needs the sequence in its input to prompt the model. So the
 * worker has to go back to storage for it.
 */

import { eq } from "drizzle-orm";

import { getDb } from "../db/client";
import { sequences } from "../db/schema";
import { getObjectText } from "./storage";

/** Rejects ids that are not UUIDs before they reach the database. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IUPAC nucleotide codes, the only characters a sequence line may contain. */
const IUPAC = /^[ACGTRYSWKMBDHVNacgtryswkmbdhvn\s]+$/;

/**
 * Pulls the sequence out of a FASTA/GenBank file.
 *
 * Both formats wrap the bases across many lines and both put free text in the
 * header, so the whole file cannot be sent as `sequence`:
 *
 *   FASTA     `>NC_000913 description...` followed by base lines
 *   GenBank   `FEATURES             ...` tables plus a `ORIGIN` block whose base
 *             lines are numbered (`        1 gatcctccat atacaacggt`)
 *
 * GenBank needs the `ORIGIN` marker because the feature table above it is
 * annotation, not sequence, and the digits in its coordinates would otherwise be
 * read as bases. Anything before the first record header, or outside an `ORIGIN`
 * block, is dropped.
 *
 * Digits and spaces are stripped from the residue lines; every other character is
 * preserved so an unexpected symbol surfaces as a validation error rather than
 * being silently deleted and corrupting the sequence.
 */
export const parseSequenceText = (raw: string): string => {
	const lines = raw.split(/\r?\n/);

	let sawFastaHeader = false;
	let sawOrigin = false;
	let sawGenBankHeader = false;
	const residues: string[] = [];

	/** GenBank residue lines are only meaningful inside ORIGIN. */
	const collect = (line: string) => residues.push(line.replace(/[\d\s]/g, ""));

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === "") continue;

		if (trimmed.startsWith(">")) {
			// First record wins. A multi-record FASTA is a legitimate upload (a
			// genome plus plasmids, say), but concatenating the records would
			// invent a sequence that exists in no organism, and every downstream
			// number computed from it would be wrong in a way nothing would catch.
			// Taking record one is the conventional reading of "the sequence" and
			// is at least predictable; `sequences.sequenceLength` describes the
			// whole file either way, so a mismatch is possible and is a known
			// limitation rather than something to paper over here.
			if (sawFastaHeader) break;

			sawFastaHeader = true;
			continue;
		}

		if (/^LOCUS\b/i.test(trimmed) || /^ACCESSION\b/i.test(trimmed)) {
			sawGenBankHeader = true;
			sawOrigin = false;
			continue;
		}

		if (/^ORIGIN\b/i.test(trimmed)) {
			sawOrigin = true;
			continue;
		}

		if (/^(FEATURES|BASEFEATURES)\b/i.test(trimmed)) {
			sawOrigin = false;
			continue;
		}

		// Stop at a record terminator rather than ingesting the next record.
		if (/^\/\//.test(trimmed)) {
			sawOrigin = false;
			continue;
		}

		if (sawOrigin) {
			collect(trimmed);
		}
	}

	if (sawOrigin || sawGenBankHeader) {
		return residues.join("").trim();
	}

	if (sawFastaHeader) {
		// Second pass for FASTA. Kept separate from the loop above because the
		// break-on-second-header rule and the "only inside ORIGIN" rule are
		// different exclusions, and interleaving them made the control flow easy
		// to get wrong.
		const body: string[] = [];
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed === "") continue;
			if (trimmed.startsWith(">")) {
				if (body.length > 0) break;
				continue;
			}
			body.push(trimmed.replace(/\s/g, ""));
		}
		return body.join("");
	}

	// No structure at all. Some uploads are bare sequence with no `>` header --
	// common for `.txt`/`.csv` exports from spreadsheets and instruments -- so the
	// whole file is treated as residues. Anything that is not actually a
	// sequence is caught by the IUPAC check in `resolveSequenceContent`, which
	// is the right place for that judgement because it can name the offending
	// characters.
	return raw.replace(/[\s]/g, "");
};

export type ResolvedSequence = {
	sequenceId: string;
	format: string;
	sequence: string;
	/** Character count of `sequence`, which can differ from the stored metadata. */
	length: number;
};

/**
 * Reads a sequence out of storage.
 *
 * Exists so callers can be tested without touching Postgres or S3. Bun's
 * `mock.module` is process-global and leaks across test files in a single test
 * run, so a mocked resolver would silently replace the real parser for every
 * other suite. Passing the function in keeps the substitution local.
 */
export type SequenceResolver = (sequenceId: string) => Promise<ResolvedSequence>;

/**
 * Loads and parses a sequence by id.
 *
 * Throws `ApiError` rather than a bare Error so the worker records a status code
 * the UI can act on: a missing object (404) or an unparseable file (422) are
 * user-fixable, whereas a storage outage should not be reported as bad input.
 */
export const resolveSequenceContent = async (
	sequenceId: string,
): Promise<ResolvedSequence> => {
	if (!UUID.test(sequenceId)) {
		throw new Error(`resolveSequenceContent called with a non-UUID id: ${sequenceId}`);
	}

	const [row] = await getDb()
		.select()
		.from(sequences)
		.where(eq(sequences.id, sequenceId))
		.limit(1);

	if (!row) {
		throw new Error(`Sequence ${sequenceId} does not exist.`);
	}

	if (!row.objectKey) {
		// Reachable when a row was created by an import path that recorded
		// metadata without ever uploading bytes.
		throw new Error(
			`Sequence ${sequenceId} has no stored object (objectKey is null), so its bases cannot be read.`,
		);
	}

	const raw = await getObjectText(row.objectKey);
	const parsed = parseSequenceText(raw);

	if (parsed === "") {
		throw new Error(
			`Stored object for sequence ${sequenceId} (${row.objectKey}) contains no parsable sequence data.`,
		);
	}

	if (!IUPAC.test(parsed)) {
		// Report the offending characters rather than the whole sequence: the
		// sequence itself can be megabytes long and is not ours to log.
		const offending = [...new Set(parsed.replace(/[ACGTRYSWKMBDHVNacgtryswkmbdhvn\s]/g, ""))];
		throw new Error(
			`Sequence ${sequenceId} contains characters that are not IUPAC nucleotide codes: ${JSON.stringify(offending.slice(0, 10))}`,
		);
	}

	return {
		sequenceId: row.id,
		format: row.format,
		sequence: parsed,
		length: parsed.length,
	};
};
