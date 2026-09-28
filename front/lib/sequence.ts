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

export const MAX_DIRECT_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_PROXY_UPLOAD_BYTES = 5 * 1024 * 1024;

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

	const isFasta = trimmed.startsWith(">");
	const recordId = isFasta ? trimmed.slice(1).split(/\s/)[0]?.slice(0, 255) : undefined;
	const sequence = isFasta
		? trimmed
				.split(/\r?\n/)
				.filter((line) => !line.startsWith(">"))
				.join("")
		: trimmed.replace(/\s+/g, "");

	return {
		format: isFasta ? "fasta" : "raw",
		recordId: recordId && recordId.length > 0 ? recordId : undefined,
		sequenceLength: sequence.length,
		sequenceHash: hashSequence(sequence),
	};
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
