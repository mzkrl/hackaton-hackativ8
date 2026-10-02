import { UnrecoverableError } from "bullmq";

import type { AnalysisJob } from "./queue";

export type AnalysisOutcome = Record<string, unknown>;

/**
 * Returns a usable origin, or an empty string when the value is not one.
 *
 * Only absolute http(s) URLs are accepted, and any path or query is discarded:
 * the endpoint appended by the caller is a fixed suffix, so a base carrying a
 * path would silently produce a wrong URL like `http://langflow/v1/sequence/analyze`.
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

const readJson = async (response: Response) => {
	const text = await response.text();
	if (!text) return {};

	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error(`Bio service returned a non-JSON response (${response.status}).`);
	}
};

export const runAnalysis = async (
	job: AnalysisJob,
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
				: "BIO_SERVICE_URL is not configured, so no analysis executor is available yet.",
		);
	}

	const response = await fetch(`${baseUrl}/sequence/analyze`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			analysisType: job.analysisType,
			sequenceId: job.sequenceId,
			projectId: job.projectId,
		}),
		signal: AbortSignal.timeout(Number(process.env.BIO_SERVICE_TIMEOUT_MS ?? 60000)),
	});

	if (!response.ok) {
		throw new Error(
			`Bio service responded with ${response.status}: ${(await response.text()).slice(0, 500)}`,
		);
	}

	return readJson(response);
};
