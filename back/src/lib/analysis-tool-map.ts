/**
 * Translates our analysis types into the Bio Service's tool vocabulary.
 *
 * The two vocabularies do not match, and assuming they do is worse than it
 * sounds: the service answers `400 unknown_tools` and names every tool it does
 * accept, so a wrong name costs a round trip per analysis and turns a working
 * feature into an outage. This map is the single place where that mismatch lives.
 *
 * The service's full list, taken from a live `400` response:
 *
 *   calculate_gc_content         calculate_nucleotide_composition
 *   detect_sequence_type         extract_sequence_features
 *   find_orfs                    parse_fasta
 *   sequence_statistics          translate_sequence
 *   validate_sequence
 *
 * The vocabulary is now mapped 1:1, with one derivation: `at_content`.
 * `detect_sequence_type`, `extract_sequence_features`, `sequence_statistics`,
 * `validate_sequence` and `parse_fasta` are exposed as their own analysis types
 * (they appear in `DEFAULT_ANALYSIS_TYPES`).
 */
export const BIO_SERVICE_TOOLS = [
	"calculate_gc_content",
	"calculate_nucleotide_composition",
	"detect_sequence_type",
	"extract_sequence_features",
	"find_orfs",
	"parse_fasta",
	"sequence_statistics",
	"translate_sequence",
	"validate_sequence",
] as const;

export type BioServiceTool = (typeof BIO_SERVICE_TOOLS)[number];

/**
 * Our analysis type -> the Bio Service tools that satisfy it.
 *
 * Every exposed type maps to at least one real tool -- an empty array (or a
 * missing key) means the request can never be served, and `bioToolsFor` throws
 * rather than substituting a look-alike. Only `at_content` is derived rather
 * than 1:1.
 */
export const BIO_TOOLS_FOR_TYPE: Readonly<Record<string, readonly BioServiceTool[]>> = {
	gc_content: ["calculate_gc_content"],
	composition: ["calculate_nucleotide_composition"],
	orfs: ["find_orfs"],
	translate: ["translate_sequence"],
	sequence_statistics: ["sequence_statistics"],
	detect_sequence_type: ["detect_sequence_type"],
	extract_sequence_features: ["extract_sequence_features"],
	validate_sequence: ["validate_sequence"],
	parse_fasta: ["parse_fasta"],

	// No dedicated AT tool exists. AT% is A% + T%, so the composition tool
	// produces the inputs and the caller derives the figure. Recorded as a
	// derivation rather than a direct equivalent so the shape difference is
	// visible to whoever consumes the result.
	at_content: ["calculate_nucleotide_composition"],
};

export const isBioSupported = (analysisType: string): boolean =>
	(BIO_TOOLS_FOR_TYPE[analysisType.trim().toLowerCase()]?.length ?? 0) > 0;

/**
 * Returns the tools for a type, or throws when the Bio Service cannot serve it.
 *
 * Throwing rather than falling back to a generic tool is deliberate. Silently
 * substituting, say, `sequence_statistics` for `find_orfs` would return a
 * confident, plausible, entirely unrelated number, and nothing downstream could
 * tell.
 */
export const bioToolsFor = (analysisType: string): readonly BioServiceTool[] => {
	const normalized = analysisType.trim().toLowerCase();
	const tools = BIO_TOOLS_FOR_TYPE[normalized];

	if (!tools) {
		throw new Error(
			`Unknown analysis type ${JSON.stringify(analysisType)}. It must pass isAllowedAnalysisType before reaching an executor.`,
		);
	}

	if (tools.length === 0) {
		throw new Error(
			`The Bio Service cannot perform ${JSON.stringify(analysisType)}: it exposes no matching tool. ` +
				`Supported by the Bio Service: ${Object.entries(BIO_TOOLS_FOR_TYPE)
					.filter(([, value]) => value.length > 0)
					.map(([key]) => key)
					.join(", ")}.`,
		);
	}

	return tools;
};
