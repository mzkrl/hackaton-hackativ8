import { UnrecoverableError } from "bullmq";

import type { AnalysisJob } from "./queue";

export type AnalysisOutcome = Record<string, unknown>;

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
	const baseUrl = process.env.BIO_SERVICE_URL?.replace(/\/$/, "");

	if (!baseUrl) {
		// Unrecoverable, so BullMQ fails the job on the first attempt instead of
		// retrying. A missing executor cannot become present by trying again, and
		// retrying it triples the failure log and delays the error surfacing to
		// the user by the backoff schedule.
		throw new UnrecoverableError(
			"BIO_SERVICE_URL is not configured, so no analysis executor is available yet.",
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
