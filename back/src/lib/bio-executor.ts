import { UnrecoverableError } from "bullmq";

import { bioToolsFor } from "./analysis-tool-map";
import type { AnalysisJob } from "./queue";
import { resolveSequenceContent } from "./sequence-content";
import type { SequenceResolver } from "./sequence-content";

export type AnalysisOutcome = Record<string, unknown>;

/**
 * Returns a usable origin, or an empty string when the value is not one.
 *
 * Only absolute http(s) URLs are accepted, and any path or query is discarded:
 * the endpoint appended by the caller is a fixed suffix, so a base carrying a
 * path would silently produce a wrong URL like `http://host/v1/sequence/analyze`.
 */
const normaliseBaseUrl = (raw: string): string => {
	let parsed: URL;

	try {
		parsed = new URL(raw);
	} catch {
		return "";
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return "";
	}

	if (!parsed.hostname) {
		return "";
	}

	return `${parsed.origin}`;
};

/**
 * The Bio API's `/analyze` returns `{ status, file_metadata, results }`.
 *
 * Only `results` is stored as `result_json`. The other two are transport
 * metadata: `file_metadata` describes the service's own handling of the file, and
 * `status` duplicates the `analyses.status` column that the worker already
 * maintains. Keeping them would give two sources of truth for the same fact, and
 * the UI would have to guess which one to render.
 */
const normaliseBioResponse = (payload: Record<string, unknown>): AnalysisOutcome => {
	const results = payload.results;

	if (results === undefined || results === null) {
		throw new Error(
			`Bio service response did not contain a "results" field (keys: ${Object.keys(payload).join(", ") || "none"}).`,
		);
	}

	// A non-object here means the service answered with something other than the
	// documented shape. Storing it verbatim would put an unexpected value in
	// `result_json` that the frontend then has to defend against.
	if (typeof results !== "object") {
		throw new Error(
			`Bio service returned "results" as ${typeof results}, expected an object.`,
		);
	}

	return { source: "bio_service", results };
};

/**
 * Runs an analysis through the Bio API directly.
 *
 * This is the fallback path. Langflow is the primary executor because it is what
 * produces the model-written interpretation; the Bio API does the deterministic
 * sequence maths. `runAnalysis` in `analysis-executor.ts` decides which to use.
 *
 * The service is unauthenticated and lives on the VPS, so there is no API key
 * here by design -- see the note in `.env.example`.
 */
export const runBioAnalysis = async (
	job: AnalysisJob,
	resolve: SequenceResolver = resolveSequenceContent,
): Promise<AnalysisOutcome> => {
	const raw = process.env.BIO_SERVICE_URL?.trim() ?? "";

	// `!baseUrl` alone is not a sufficient guard. An env file can carry a
	// commented-out value such as `BIO_SERVICE_URL=    # langflow here`, which is
	// a non-empty string that survives the read, slips past a falsy check, and
	// then fails later as an opaque fetch error against a nonsense URL. Requiring
	// a parseable absolute http(s) URL turns that into one clear message naming
	// the actual problem.
	const baseUrl = raw ? normaliseBaseUrl(raw) : "";

	if (!baseUrl) {
		// Unrecoverable, so BullMQ fails the job on the first attempt instead of
		// retrying. A missing executor cannot become present by trying again, and
		// retrying it triples the failure log and delays the error surfacing to
		// the user by the backoff schedule.
		throw new UnrecoverableError(
			raw
				? `BIO_SERVICE_URL is set to ${JSON.stringify(raw)}, which is not an absolute http(s) URL. Fix the value or unset it.`
				: "BIO_SERVICE_URL is not configured, so the Bio Service executor is unavailable.",
		);
	}

	// The job carries ids only; the bases live in object storage. Read them here
	// so the service receives the sequence text it requires.
	const content = await resolve(job.sequenceId);

	// Resolved before the request so an unservable type fails immediately instead
	// of after a round trip, and as unrecoverable so BullMQ does not retry it
	// three times. `blast` will never start working through this path.
	let tools: readonly string[];

	try {
		tools = bioToolsFor(job.analysisType);
	} catch (error) {
		throw new UnrecoverableError(
			error instanceof Error ? error.message : String(error),
		);
	}

	const response = await fetch(`${baseUrl}/analyze`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			sequence: content.sequence,
			// The two vocabularies differ; the map is what keeps a valid analysis
			// type from becoming a `400 unknown_tools`.
			tools,
		}),
		signal: AbortSignal.timeout(Number(process.env.BIO_SERVICE_TIMEOUT_MS ?? 60000)),
	});

	if (!response.ok) {
		throw new Error(
			`Bio service responded with ${response.status}: ${(await response.text()).slice(0, 500)}`,
		);
	}

	const text = await response.text();
	let payload: Record<string, unknown>;

	try {
		payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
	} catch {
		throw new Error(
			`Bio service returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
		);
	}

	return normaliseBioResponse(payload);
};
