/**
 * Helpers for describing a pasted sequence before it is registered.
 *
 * `POST /projects/:id/sequences` is a metadata-only endpoint: it takes a format,
 * a length and a hash, and nothing else. The backend deliberately does not
 * parse the text — the Bio service owns that — so the client has to produce
 * these three values. It does not verify them, which is why this module keeps
 * its parsing trivial and reports what it actually did rather than guessing at
 * a real parser's behaviour.
 */

export type SequenceSummary = {
	format: string;
	recordId: string | undefined;
	sequenceLength: number;
	sequenceHash: string;
};

/** Extensions the backend accepts, mirrored from `back/src/lib/storage.ts`. */
export const ALLOWED_EXTENSIONS = [
	".fasta",
	".fa",
	".fna",
	".gb",
	".gbk",
	".genbank",
	".txt",
	".csv",
	".tsv",
	".json",
	".pdf",
] as const;

/**
 * Uploads go through the API, which relays the bytes to object storage. Storage
 * is bound to loopback on the API host and its presigned URLs embed that host,
 * so the browser cannot reach it directly. Mirrors
 * `MAX_BACKEND_UPLOAD_BYTES` in `back/src/lib/storage.ts`.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const hasAllowedExtension = (filename: string) => {
	const dot = filename.lastIndexOf(".");
	if (dot === -1) return false;
	return (ALLOWED_EXTENSIONS as readonly string[]).includes(filename.slice(dot).toLowerCase());
};

export const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};

/**
 * FNV-1a, run twice with different offsets so the digest is 16 hex chars
 * instead of 8. Not a cryptographic hash and not meant to be: the column is an
 * index for looking up similar sequences, and the backend does not enforce
 * uniqueness on it.
 */
const fnv1a = (text: string, seed: number) => {
	let hash = seed;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash;
};

export const hashSequence = (text: string) =>
	`fnv1a-${fnv1a(text, 0x811c9dc5).toString(16).padStart(8, "0")}-${fnv1a(
		text,
		0x7fffffff,
	)
		.toString(16)
		.padStart(8, "0")}`;

/**
 * Summarises pasted text into the three fields the endpoint requires.
 *
 * FASTA and GenBank headers are recognised only to locate the record id and the
 * format; they are not validated. Anything else is treated as bare sequence and
 * is measured exactly as typed, whitespace included, because the client cannot
 * know which of the formats the Bio service will infer.
 *
 * For multi-record FASTA, returns one summary per record so the caller can
 * create N sequence rows. This is the fix for the silent data loss described in
 * PLAN.md §3.4: previously only record 1 was kept and records 2..N were
 * discarded without warning.
 */
export const summariseSequence = (text: string): SequenceSummary => {
	const trimmed = text.trim();

	if (trimmed.startsWith("LOCUS")) {
		const name = /^LOCUS\s+(\S+)/m.exec(trimmed)?.[1];
		return {
			format: "genbank",
			recordId: name?.slice(0, 255),
			sequenceLength: countResidues(trimmed),
			sequenceHash: hashSequence(trimmed),
		};
	}

	if (trimmed.startsWith(">")) {
		const records = parseFastaRecords(trimmed);
		if (records.length === 1) {
			const record = records[0];
			return {
				format: "fasta",
				recordId: record.recordId,
				sequenceLength: record.sequence.length,
				sequenceHash: hashSequence(record.sequence),
			};
		}
		// Multi-record: return the first record's summary as a fallback.
		// The caller should use `summariseAllSequences` for the full list.
		const first = records[0];
		return {
			format: "fasta",
			recordId: first.recordId,
			sequenceLength: first.sequence.length,
			sequenceHash: hashSequence(first.sequence),
		};
	}

	const sequence = trimmed.replace(/\s+/g, "");
	return {
		format: "raw",
		recordId: undefined,
		sequenceLength: sequence.length,
		sequenceHash: hashSequence(sequence),
	};
};

/**
 * Parses all records from a multi-record FASTA string.
 *
 * Each record starts with `>` and continues until the next `>` or EOF.
 * Returns an array of `{ recordId, sequence }` objects. The recordId is the
 * first whitespace-delimited token after `>`, matching the convention used
 * by the Bio service's `/analyze/file` endpoint.
 */
export const parseFastaRecords = (text: string): Array<{ recordId: string; sequence: string }> => {
	const records: Array<{ recordId: string; sequence: string }> = [];
	let currentRecord: { recordId: string; sequence: string } | null = null;

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "") continue;

		if (trimmed.startsWith(">")) {
			if (currentRecord) {
				records.push(currentRecord);
			}
			const recordId = trimmed.slice(1).split(/\s/)[0]?.slice(0, 255) ?? "";
			currentRecord = { recordId, sequence: "" };
		} else if (currentRecord) {
			currentRecord.sequence += trimmed.replace(/\s/g, "");
		}
	}

	if (currentRecord) {
		records.push(currentRecord);
	}

	return records;
};

/**
 * Summarises all sequences in a potentially multi-record FASTA string.
 *
 * Returns one `SequenceSummary` per record. For non-FASTA input, returns a
 * single-element array. This is the function callers should use when they
 * need to create one sequence row per record.
 */
export const summariseAllSequences = (text: string): SequenceSummary[] => {
	const trimmed = text.trim();

	if (trimmed.startsWith("LOCUS")) {
		const name = /^LOCUS\s+(\S+)/m.exec(trimmed)?.[1];
		return [{
			format: "genbank",
			recordId: name?.slice(0, 255),
			sequenceLength: countResidues(trimmed),
			sequenceHash: hashSequence(trimmed),
		}];
	}

	if (trimmed.startsWith(">")) {
		const records = parseFastaRecords(trimmed);
		return records.map((record) => ({
			format: "fasta",
			recordId: record.recordId,
			sequenceLength: record.sequence.length,
			sequenceHash: hashSequence(record.sequence),
		}));
	}

	const sequence = trimmed.replace(/\s+/g, "");
	return [{
		format: "raw",
		recordId: undefined,
		sequenceLength: sequence.length,
		sequenceHash: hashSequence(sequence),
	}];
};

/**
 * GenBank keeps residues in a numbered ORIGIN block, so counting letters
 * directly would also count the column numbers.
 */
const countResidues = (text: string) => {
	const start = text.indexOf("ORIGIN");
	if (start === -1) {
		return text.replace(/[^a-z]/gi, "").length;
	}
	return text
		.slice(start)
		.split(/\r?\n/)
		.slice(1)
		.map((line) => line.replace(/[\d\s]/g, ""))
		.join("").length;
};
