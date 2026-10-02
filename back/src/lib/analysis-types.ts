import { ApiError } from "./api-error";

/**
 * The closed set of analyses the API will accept.
 *
 * `analysisType` used to be `t.String({ minLength: 1, maxLength: 64 })`, which
 * meant any string a caller liked was stored and then forwarded verbatim to the
 * analysis service. That service is internal and reached by id, not by the
 * client, so the value it is handed should be one this process chose — an
 * unrecognised type is a bug or an attempt to reach something unintended, and
 * both deserve a 422 rather than a job.
 *
 * Defaults come from AGENTS.md §4.10. Override with `ANALYSIS_ALLOWED_TYPES`
 * when the Bio Service exposes a different set:
 *
 *   ANALYSIS_ALLOWED_TYPES=gc_content,orfs,translate,blast
 *
 * An unset or empty variable falls back to the defaults above rather than to an
 * empty list, so a missing config cannot silently reject every legitimate
 * request. A malformed entry is ignored, and if *nothing* parses the defaults
 * are used, so the allowlist can never end up wide open by accident.
 */
export const DEFAULT_ANALYSIS_TYPES = [
	"gc_content",
	"at_content",
	"composition",
	"orfs",
	"translate",
	"reverse_complement",
	"blast",
	"genbank_record",
] as const;

export type AnalysisType = (typeof DEFAULT_ANALYSIS_TYPES)[number];

const parse = (raw: string | undefined): string[] => {
	if (!raw?.trim()) return [...DEFAULT_ANALYSIS_TYPES];

	const parsed = raw
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => /^[a-z0-9_]{1,64}$/.test(entry));

	return parsed.length > 0 ? parsed : [...DEFAULT_ANALYSIS_TYPES];
};

let cache: { raw: string | undefined; types: string[] } | undefined;

export const allowedAnalysisTypes = (): readonly string[] => {
	const raw = process.env.ANALYSIS_ALLOWED_TYPES;

	if (!cache || cache.raw !== raw) {
		cache = { raw, types: parse(raw) };
	}

	return cache.types;
};

export const isAllowedAnalysisType = (value: string) =>
	allowedAnalysisTypes().includes(value.trim().toLowerCase());

/**
 * Normalises and validates an analysis type, or throws 422.
 *
 * Lowercasing here is what makes the allowlist a canonical form rather than a
 * set of near-duplicates: `GC_Content` and `gc_content` are the same analysis
 * and must not become two different queue entries.
 */
export const assertAllowedAnalysisType = (value: string): string => {
	const normalized = value.trim().toLowerCase();

	if (!allowedAnalysisTypes().includes(normalized)) {
		throw new ApiError(
			422,
			"UNSUPPORTED_ANALYSIS",
			`Unsupported analysis type. Allowed: ${allowedAnalysisTypes().join(", ")}`,
		);
	}

	return normalized;
};
