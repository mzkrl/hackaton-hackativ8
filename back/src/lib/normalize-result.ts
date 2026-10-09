/**
 * Rewrites an executor outcome into the flat shape `result_json` is documented
 * to hold.
 *
 * The two executors used to hand back differently-wrapped payloads:
 *
 *   * Bio Service  -> `{ source: "bio_service", results: { <tool>: {...} } }`
 *   * Langflow     -> `{ source: "langflow", flow_id, session_id, outputs: [...] }`
 *
 * while `front/lib/result.ts` reads a *flat* object (`gc_content`, `composition`,
 * `orfs`, `hits`, ...). Neither wrapped shape contained those keys, so the UI
 * silently degraded to a raw-JSON dump for every analysis. Normalising here makes
 * the backend the single owner of the `result_json` contract: switching between
 * Langflow and the Bio Service can no longer change what the frontend renders.
 *
 * The Bio Service answers with one entry per tool, keyed by the tool name:
 *
 *   calculate_gc_content            -> { gc_content_percent, gc_count, ... }
 *   calculate_nucleotide_composition-> { counts: { A, T, G, C, U, other }, ... }
 *   find_orfs                       -> { total_orfs, orfs: [ { start, end, ... } ] }
 *   translate_sequence              -> { protein_sequence, ... }
 *   sequence_statistics             -> { length, base_counts, ... }
 *   ...
 *
 * Tools the frontend has a renderer for are flattened into the fields it reads;
 * the remaining tools are copied through verbatim so they still appear under the
 * UI's "Other fields" disclosure rather than being thrown away.
 */

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const num = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

/** Tool keys the flattening below consumes; dropping them avoids showing the
 *  same figure twice (once rendered, once as an opaque tool blob). */
const FLATTENED_TOOLS = new Set([
	"calculate_gc_content",
	"calculate_nucleotide_composition",
	"find_orfs",
	"translate_sequence",
]);

/**
 * Counts for the four DNA bases, from the composition tool.
 *
 * The Bio Service reports `U` and `other` too; they are dropped because the
 * frontend's chart is a DNA base-count chart and a stray `U` bucket would render
 * as a fifth, always-empty bar.
 */
const readComposition = (results: JsonRecord): { A: number; T: number; G: number; C: number } | undefined => {
	const composition = results.calculate_nucleotide_composition;
	const counts = isRecord(composition) ? composition.counts : undefined;

	if (!isRecord(counts)) return undefined;

	const a = num(counts.A);
	const t = num(counts.T);
	const g = num(counts.G);
	const c = num(counts.C);

	if (a === undefined || t === undefined || g === undefined || c === undefined) return undefined;

	return { A: a, T: t, G: g, C: c };
};

/** GC%, preferring the dedicated tool and falling back to the combined extractor. */
const readGcContent = (results: JsonRecord): number | undefined => {
	const gc = isRecord(results.calculate_gc_content) ? results.calculate_gc_content : undefined;
	const features = isRecord(results.extract_sequence_features)
		? results.extract_sequence_features
		: undefined;

	return num(gc?.gc_content_percent) ?? num(features?.gc_content_percent);
};

/** Sequence length, from whichever tool reported one. */
const readLength = (results: JsonRecord): number | undefined => {
	const stats = isRecord(results.sequence_statistics) ? results.sequence_statistics : undefined;
	const gc = isRecord(results.calculate_gc_content) ? results.calculate_gc_content : undefined;
	const features = isRecord(results.extract_sequence_features)
		? results.extract_sequence_features
		: undefined;
	const composition = isRecord(results.calculate_nucleotide_composition)
		? results.calculate_nucleotide_composition
		: undefined;

	return (
		num(stats?.length) ??
		num(gc?.total_length) ??
		num(features?.length) ??
		num(composition?.total_length) ??
		(isRecord(results.find_orfs) ? num(results.find_orfs.total_length) : undefined)
	);
};

/**
 * The translated protein, in the shape the frontend renders.
 *
 * The Bio Service reports `translate_sequence.protein_sequence`; it is lifted to
 * a top-level `translation` so the UI does not have to dig into a tool-keyed
 * blob. Anything the tool omitted is left out rather than defaulted, so the UI
 * can tell "not reported" from "reported as empty".
 */
const readTranslation = (results: JsonRecord): JsonRecord | undefined => {
	const translation = isRecord(results.translate_sequence) ? results.translate_sequence : undefined;
	if (!translation) return undefined;

	const protein = str(translation.protein_sequence);
	if (!protein) return undefined;

	return {
		protein_sequence: protein,
		protein_length: num(translation.protein_length),
		nucleotide_length: num(translation.nucleotide_length),
		note: str(translation.translation_note),
		contains_stop_codon:
			typeof translation.contains_stop_codon === "boolean"
				? translation.contains_stop_codon
				: undefined,
	};
};

/**
 * ORFs in the shape the table renders.
 *
 * The Bio Service reports `strand` as `1`/`-1` and omits the codons, so the
 * strand is turned into a `+`/`-` sign (the frontend's reader only accepts
 * strings) and the start/stop codons are sliced out of the ORF's own sequence.
 */
const readOrfs = (results: JsonRecord): JsonRecord[] => {
	const findOrfs = results.find_orfs;
	const raw = isRecord(findOrfs) ? findOrfs.orfs : undefined;

	if (!Array.isArray(raw)) return [];

	return raw.flatMap((entry) => {
		if (!isRecord(entry)) return [];

		const sequence = str(entry.sequence);
		const strand = num(entry.strand);

		return [
			{
				start: num(entry.start),
				end: num(entry.end),
				length: num(entry.length),
				// The frontend accepts a numeric frame but only a string strand.
				frame: num(entry.frame) ?? str(entry.frame),
				strand: strand === undefined ? undefined : strand < 0 ? "-" : "+",
				startCodon: sequence ? sequence.slice(0, 3) : undefined,
				stopCodon: sequence && sequence.length >= 6 ? sequence.slice(-3) : undefined,
			},
		];
	});
};

/**
 * Pulls the structured Bio results out of a Langflow `/run` output.
 *
 * The connector emits `{ user_question, analysis_results }` as one Message. An
 * output that is not that JSON is treated as the Insight Analyst's prose and
 * returned separately, so the caller can attach it as `insight`.
 */
const splitLangflowOutputs = (
	outputs: unknown,
): { results?: JsonRecord; insight?: string } => {
	let structured: JsonRecord | undefined;
	const prose: string[] = [];

	if (!Array.isArray(outputs)) return {};

	for (const entry of outputs) {
		if (typeof entry !== "string") continue;

		let parsed: unknown;
		try {
			parsed = JSON.parse(entry);
		} catch {
			prose.push(entry.trim());
			continue;
		}

		let candidate: JsonRecord | undefined;
		if (isRecord(parsed)) {
			if (isRecord(parsed.analysis_results)) candidate = parsed.analysis_results;
			else if (isRecord(parsed.results)) candidate = parsed.results;
		}

		if (candidate) {
			// First structured payload wins; a second would be a duplicate.
			if (!structured) structured = candidate;
		} else if (isRecord(parsed) && Object.keys(parsed).length > 0) {
			// Valid JSON that is not our report (e.g. Langflow noise) is ignored
			// rather than rendered as prose.
			continue;
		}
	}

	return { results: structured, insight: prose.length ? prose.join("\n\n") : undefined };
};

/**
 * Normalises either executor outcome. `source` is preserved so the dispatch
 * tests and logs can still tell which path ran.
 */
export const normalizeAnalysisOutcome = (outcome: JsonRecord): JsonRecord => {
	const normalized: JsonRecord = { source: outcome.source };

	let results: JsonRecord | undefined;
	let insight: string | undefined;

	if (isRecord(outcome.results)) {
		results = outcome.results;
	} else if (outcome.outputs !== undefined) {
		const split = splitLangflowOutputs(outcome.outputs);
		results = split.results;
		insight = split.insight;
	}

	if (results) {
		const gcContent = readGcContent(results);
		const composition = readComposition(results);
		const orfs = readOrfs(results);
		const length = readLength(results);
		const translation = readTranslation(results);

		if (gcContent !== undefined) normalized.gc_content = gcContent;
		if (composition) normalized.composition = composition;
		if (orfs.length > 0) normalized.orfs = orfs;
		if (length !== undefined) normalized.record = { length };
		if (translation) normalized.translation = translation;

		// Non-flattened tools pass through with their service names, so nothing
		// is lost and the frontend shows them under "Other fields".
		for (const [key, value] of Object.entries(results)) {
			if (!FLATTENED_TOOLS.has(key)) normalized[key] = value;
		}
	}

	if (insight) normalized.insight = insight;

	return normalized;
};
