/**
 * Tolerant reading of `analyses.result_json`.
 *
 * `result_json` is a `jsonb` column typed as `Record<string, unknown>`, and
 * nothing validates its contents — the worker writes whatever the Bio Service
 * returned. The shapes below follow the documented Bio API responses
 * (`record` / `composition` / `gc_content` / `orfs`, plus the BLAST `hits`
 * array), but they are read defensively: every field is optional, wrong types
 * are dropped rather than thrown on, and anything unrecognised is preserved so
 * it can still be shown as raw JSON.
 *
 * The alternative -- `JSON.parse` into a hard interface and hope -- turns one
 * unexpected worker response into a blank screen mid-demo.
 */

/** A finite number, or `undefined`. Rejects NaN, Infinity, and numeric strings. */
const num = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return undefined;
};

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** The four bases, in the order a composition chart wants them. */
export const BASES = ["A", "T", "G", "C"] as const;
export type Base = (typeof BASES)[number];

export type Composition = Record<Base, number> | null;

export type SequenceRecord = {
	id?: string;
	description?: string;
	length?: number;
};

export type Orf = {
	/** 1-based inclusive coordinates, as reported by the tool. */
	start?: number;
	end?: number;
	length?: number;
	frame?: string | number;
	strand?: string;
	startCodon?: string;
	stopCodon?: string;
};

export type BlastHit = {
	accession?: string;
	identity?: number;
	eValue?: number;
	bitScore?: number;
	subjectLength?: number;
};

export type Translation = {
	/** Amino-acid string, as reported by the tool. */
	proteinSequence?: string;
	proteinLength?: number;
	nucleotideLength?: number;
	/** e.g. "Input length is not a multiple of 3; last N nucleotide(s) ignored." */
	note?: string;
	containsStopCodon?: boolean;
};

/** Base counts with any subset of the four bases. */
export type BaseCounts = Partial<Record<Base, number>>;

export type SequenceStatistics = {
	length?: number;
	baseCounts?: BaseCounts;
	uniqueBases?: number;
	mostFrequentBase?: string;
	leastFrequentBase?: string;
	ambiguousBaseCount?: number;
};

export type SequenceTypeInfo = {
	sequenceType?: string;
	confidence?: string;
	reasoning?: string;
	hasDnaChars?: boolean;
	hasRnaChars?: boolean;
	hasProteinOnlyChars?: boolean;
};

export type SequenceFeatures = {
	summary?: string;
	length?: number;
	isValid?: boolean;
	sequenceType?: string;
	typeConfidence?: string;
	gcContentPercent?: number;
	baseCounts?: BaseCounts;
	mostFrequentBase?: string;
	ambiguousBaseCount?: number;
	invalidCharacters?: string[];
};

export type Validation = {
	isValid?: boolean;
	iupacDnaValid?: boolean;
	iupacRnaValid?: boolean;
	iupacProteinValid?: boolean;
	sequenceLength?: number;
	invalidCharacters?: string[];
	message?: string;
};

export type FastaRecord = {
	id?: string;
	length?: number;
	description?: string;
};

export type Fasta = {
	totalRecords?: number;
	records: FastaRecord[];
};

export type AnalysisResult = {
	record?: SequenceRecord;
	composition: Composition;
	gcContent?: number;
	orfs: Orf[];
	blastProgram?: string;
	blastHits: BlastHit[];
	/** Translated protein, when the `translate` tool ran. */
	translation?: Translation;
	/** `sequence_statistics` figures. */
	sequenceStatistics?: SequenceStatistics;
	/** `detect_sequence_type` call. */
	sequenceType?: SequenceTypeInfo;
	/** `extract_sequence_features` summary. */
	sequenceFeatures?: SequenceFeatures;
	/** `validate_sequence` IUPAC flags. */
	validation?: Validation;
	/** `parse_fasta` record metadata (residue text is stripped server-side). */
	fasta?: Fasta;
	/**
	 * Optional AI interpretation written by the Insight Analyst flow. Prose, not
	 * data: it is a reasoning layer over the figures, never their source.
	 */
	insight?: string;
	/** Keys present in the payload that none of the renderers claimed. */
	extra: Record<string, unknown>;
	/** True when nothing at all was understood, so the caller shows raw JSON. */
	empty: boolean;
};

const readComposition = (value: unknown): Composition => {
	const source = record(value);
	if (!source) return null;

	// Only accept it if at least one base is a real count, otherwise a stray
	// `composition: {}` would render as a chart of four zeroes.
	const counts = {} as Record<Base, number>;
	let seen = 0;
	for (const base of BASES) {
		const count = num(source[base]);
		if (count !== undefined) {
			counts[base] = count;
			seen += 1;
		}
	}
	return seen > 0 ? counts : null;
};

const readOrfs = (value: unknown): Orf[] =>
	list(value).flatMap((entry) => {
		const source = record(entry);
		if (!source) return [];
		return [
			{
				start: num(source.start) ?? num(source.startPosition) ?? num(source.start_position),
				end: num(source.end) ?? num(source.endPosition) ?? num(source.end_position),
				length: num(source.length) ?? num(source.orfLength) ?? num(source.orf_length),
				frame: str(source.frame) ?? num(source.frame),
				strand: str(source.strand),
				startCodon: str(source.startCodon) ?? str(source.start_codon),
				stopCodon: str(source.stopCodon) ?? str(source.stop_codon),
			},
		];
	});

const readHits = (value: unknown): BlastHit[] =>
	list(value).flatMap((entry) => {
		const source = record(entry);
		if (!source) return [];
		return [
			{
				accession: str(source.accession) ?? str(source.id) ?? str(source.subjectId),
				identity:
					num(source.identity) ??
					num(source.percentIdentity) ??
					num(source.percent_identity) ??
					num(source.p_identity),
				eValue:
					num(source.eValue) ??
					num(source.e_value) ??
					num(source.evalue) ??
					num(source.expect),
				bitScore:
					num(source.bitScore) ?? num(source.bit_score) ?? num(source.bits) ?? num(source.score),
				subjectLength: num(source.subjectLength) ?? num(source.subject_length) ?? num(source.length),
			},
		];
	});

/** Snake_case aliases, because the Bio Service and the plan use different ones. */
const readRecord = (value: unknown): SequenceRecord | undefined => {
	const source = record(value);
	if (!source) return undefined;
	return {
		id: str(source.id) ?? str(source.recordId) ?? str(source.record_id),
		description: str(source.description) ?? str(source.def),
		length: num(source.length) ?? num(source.sequenceLength),
	};
};

/** The translated protein, from whichever key the payload used. */
const readTranslation = (value: unknown): Translation | undefined => {
	const source = record(value);
	if (!source) return undefined;

	const proteinSequence = str(source.protein_sequence) ?? str(source.proteinSequence);
	if (!proteinSequence) return undefined;

	return {
		proteinSequence,
		proteinLength: num(source.protein_length) ?? num(source.proteinLength),
		nucleotideLength: num(source.nucleotide_length) ?? num(source.nucleotideLength),
		note: str(source.note),
		containsStopCodon:
			typeof source.contains_stop_codon === "boolean"
				? source.contains_stop_codon
				: typeof source.containsStopCodon === "boolean"
					? source.containsStopCodon
					: undefined,
	};
};

const bool = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

/** A non-empty string list, or `undefined` when the value is not one. */
const stringList = (value: unknown): string[] | undefined => {
	if (!Array.isArray(value)) return undefined;
	const items = value.flatMap((entry) => {
		const text = str(entry);
		return text ? [text] : [];
	});
	return items;
};

const readBaseCounts = (value: unknown): BaseCounts | undefined => {
	const source = record(value);
	if (!source) return undefined;

	const counts: BaseCounts = {};
	let seen = 0;
	for (const base of BASES) {
		const count = num(source[base]);
		if (count !== undefined) {
			counts[base] = count;
			seen += 1;
		}
	}
	return seen > 0 ? counts : undefined;
};

const readSequenceStatistics = (value: unknown): SequenceStatistics | undefined => {
	const source = record(value);
	if (!source) return undefined;
	return {
		length: num(source.length),
		baseCounts: readBaseCounts(source.base_counts),
		uniqueBases: num(source.unique_bases),
		mostFrequentBase: str(source.most_frequent_base),
		leastFrequentBase: str(source.least_frequent_base),
		ambiguousBaseCount: num(source.ambiguous_base_count),
	};
};

const readSequenceType = (value: unknown): SequenceTypeInfo | undefined => {
	const source = record(value);
	if (!source) return undefined;
	return {
		sequenceType: str(source.sequence_type),
		confidence: str(source.confidence),
		reasoning: str(source.reasoning),
		hasDnaChars: bool(source.has_dna_chars),
		hasRnaChars: bool(source.has_rna_chars),
		hasProteinOnlyChars: bool(source.has_protein_only_chars),
	};
};

const readSequenceFeatures = (value: unknown): SequenceFeatures | undefined => {
	const source = record(value);
	if (!source) return undefined;
	return {
		summary: str(source.summary),
		length: num(source.length),
		isValid: bool(source.is_valid),
		sequenceType: str(source.sequence_type),
		typeConfidence: str(source.type_confidence),
		gcContentPercent: num(source.gc_content_percent),
		baseCounts: readBaseCounts(source.base_counts),
		mostFrequentBase: str(source.most_frequent_base),
		ambiguousBaseCount: num(source.ambiguous_base_count),
		invalidCharacters: stringList(source.invalid_characters),
	};
};

const readValidation = (value: unknown): Validation | undefined => {
	const source = record(value);
	if (!source) return undefined;
	return {
		isValid: bool(source.is_valid),
		iupacDnaValid: bool(source.iupac_dna_valid),
		iupacRnaValid: bool(source.iupac_rna_valid),
		iupacProteinValid: bool(source.iupac_protein_valid),
		sequenceLength: num(source.sequence_length),
		invalidCharacters: stringList(source.invalid_characters),
		message: str(source.message),
	};
};

const readFasta = (value: unknown): Fasta | undefined => {
	const source = record(value);
	if (!source) return undefined;

	const records = list(source.records).flatMap((entry) => {
		const item = record(entry);
		if (!item) return [];
		return [
			{
				id: str(item.id),
				length: num(item.length),
				description: str(item.description),
			},
		];
	});

	return { totalRecords: num(source.total_records), records };
};

/**
 * Every key the readers above can consume. Anything not in this list falls
 * through to `extra` and is still shown, so a payload from an older or newer
 * Bio Service degrades to "here is the raw data" instead of to nothing.
 *
 * Aliases are listed alongside their canonical name because they must not also
 * appear in `extra` -- that would render the same value twice.
 */
const CLAIMED_KEYS = new Set([
	// record
	"record",
	// composition
	"composition",
	// gc content
	"gc_content",
	"gcContent",
	"gcContentPercent",
	// ORFs
	"orfs",
	"ORFs",
	"openReadingFrames",
	"open_reading_frames",
	// BLAST
	"program",
	"blastProgram",
	"blast_program",
	"hits",
	"blastHits",
	"blast_hits",
	// translated protein
	"translation",
	// sequence statistics / type / features / validation / FASTA
	"sequence_statistics",
	"sequenceStatistics",
	"sequence_type",
	// Older rows stored the raw tool blob under its service name.
	"detect_sequence_type",
	"sequence_features",
	"extract_sequence_features",
	"validation",
	"validate_sequence",
	"fasta",
	"parse_fasta",
	// AI interpretation
	"insight",
	// Executor provenance, shown as the footer's "computed by" note rather than
	// as a data field.
	"source",
]);

export const parseResult = (payload: unknown): AnalysisResult => {
	const source = record(payload);
	if (!source) {
		return { composition: null, orfs: [], blastHits: [], extra: {}, empty: true };
	}

	const result: AnalysisResult = {
		record: readRecord(source.record),
		composition: readComposition(source.composition),
		gcContent: num(source.gc_content) ?? num(source.gcContent) ?? num(source.gcContentPercent),
		orfs: readOrfs(source.orfs ?? source.ORFs ?? source.openReadingFrames ?? source.open_reading_frames),
		blastProgram: str(source.program) ?? str(source.blastProgram) ?? str(source.blast_program),
		blastHits: readHits(source.hits ?? source.blastHits ?? source.blast_hits),
		translation: readTranslation(source.translation),
		sequenceStatistics: readSequenceStatistics(
			source.sequence_statistics ?? source.sequenceStatistics,
		),
		sequenceType: readSequenceType(source.sequence_type ?? source.detect_sequence_type),
		sequenceFeatures: readSequenceFeatures(
			source.sequence_features ?? source.extract_sequence_features,
		),
		validation: readValidation(source.validation ?? source.validate_sequence),
		fasta: readFasta(source.fasta ?? source.parse_fasta),
		insight: str(source.insight),
		extra: {},
		empty: false,
	};

	for (const [key, value] of Object.entries(source)) {
		if (!CLAIMED_KEYS.has(key)) result.extra[key] = value;
	}

	// Nothing rendered and nothing left over: the caller falls back to raw JSON.
	result.empty =
		!result.record &&
		result.composition === null &&
		result.gcContent === undefined &&
		result.orfs.length === 0 &&
		result.blastHits.length === 0 &&
		!result.translation &&
		!result.sequenceStatistics &&
		!result.sequenceType &&
		!result.sequenceFeatures &&
		!result.validation &&
		!result.fasta &&
		!result.insight &&
		Object.keys(result.extra).length === 0;

	return result;
};

/**
 * GC content implied by the composition, when the payload omits `gc_content`.
 *
 * Reported separately from the parsed value so the UI can say which one it is
 * showing -- a derived figure must not be presented as if the tool reported it.
 */
export const deriveGcContent = (composition: Composition): number | undefined => {
	if (!composition) return undefined;
	const total = BASES.reduce((sum, base) => sum + (composition[base] ?? 0), 0);
	if (total === 0) return undefined;
	return Number((((composition.G ?? 0) + (composition.C ?? 0)) / total * 100).toFixed(1));
};

/** AT content implied by the composition, for the same reason as above. */
export const deriveAtContent = (composition: Composition): number | undefined => {
	if (!composition) return undefined;
	const total = BASES.reduce((sum, base) => sum + (composition[base] ?? 0), 0);
	if (total === 0) return undefined;
	return Number((((composition.A ?? 0) + (composition.T ?? 0)) / total * 100).toFixed(1));
};
