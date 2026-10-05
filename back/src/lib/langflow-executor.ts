import { UnrecoverableError } from "bullmq";

import type { AnalysisJob } from "./queue";
import { resolveSequenceContent } from "./sequence-content";
import type { SequenceResolver } from "./sequence-content";

export type AnalysisOutcome = Record<string, unknown>;

/**
 * Runs an analysis through a Langflow flow over its webhook endpoint.
 *
 * Langflow is synchronous: `POST /api/v1/webhook/{flow_id_or_name}` does not
 * return a job handle and cannot be polled. That is fine here because the
 * surrounding BullMQ job already provides the async boundary and the frontend
 * polls our own status endpoint.
 *
 * !! PROVISIONAL CONTRACT -------------------------------------------------
 * The request body below is a best guess and is NOT confirmed against the live
 * flow. It has to be updated once the flow owner states the actual input shape.
 * Keep it confined to `buildPayload` so there is one place to correct.
 * ------------------------------------------------------------------------
 */

const parseBaseUrl = (raw: string): string => {
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
		if (!parsed.hostname) return "";
		return parsed.origin;
	} catch {
		return "";
	}
};

/**
 * Collects every string that sits inside a content-bearing branch of the flow's
 * `outputs`.
 *
 * Langflow nests its output as `outputs[componentId].outputs.message.text`, and
 * the exact depth varies by component and by flow. So the walk descends through
 * *every* key -- otherwise a component id sitting at the top level would block
 * the descent and the function would report "no text" for a flow that returned
 * text perfectly well.
 *
 * Only strings reached under a content-bearing key (`text`, `message`, `result`)
 * are collected. Structural keys are traversed but never collected, so adding or
 * reordering components cannot leak a node name into the analysis result.
 */
const collectText = (
	value: unknown,
	into: string[] = [],
	collect = false,
	depth = 0,
): string[] => {
	// Depth is capped because this walks arbitrary decoded JSON. A hostile or
	// simply unexpected payload should surface as "no text found", not as a
	// stack overflow that takes the worker down.
	if (value === null || value === undefined || depth > 16) return into;

	if (typeof value === "string") {
		if (collect) into.push(value);
		return into;
	}

	if (typeof value !== "object") return into;

	if (Array.isArray(value)) {
		for (const entry of value) collectText(entry, into, collect, depth + 1);
		return into;
	}

	for (const [key, entry] of Object.entries(value)) {
		const next = collect || key === "text" || key === "message" || key === "result";
		collectText(entry, into, next, depth + 1);
	}

	return into;
};

/**
 * Builds the webhook body. This is the one place the unconfirmed input shape
 * lives, so correcting it after the owner replies is a single-function edit.
 */
const buildPayload = (job: AnalysisJob, sequence: string): Record<string, unknown> => ({
	input_value: sequence,
	analysis_type: job.analysisType,
	sequence_id: job.sequenceId,
});

export const isLangflowEnabled = () =>
	(process.env.LANGFLOW_ENABLED ?? "").trim().toLowerCase() === "true";

/**
 * Reports whether Langflow is both enabled and completely configured.
 *
 * Used by the dependency probe so a `true` flag with a missing flow id reports
 * as a misconfiguration rather than as "healthy".
 */
export const langflowConfigured = (): boolean => {
	if (!isLangflowEnabled()) return false;

	const url = process.env.LANGFLOW_URL?.trim() ?? "";
	if (!url || !parseBaseUrl(url)) return false;

	if (!process.env.LANGFLOW_MAIN_FLOW_ID?.trim()) return false;

	return Boolean(process.env.LANGFLOW_API_KEY?.trim());
};

export const runLangflowAnalysis = async (
	job: AnalysisJob,
	resolve: SequenceResolver = resolveSequenceContent,
): Promise<AnalysisOutcome> => {
	const rawUrl = process.env.LANGFLOW_URL?.trim() ?? "";
	const baseUrl = rawUrl ? parseBaseUrl(rawUrl) : "";

	if (!baseUrl) {
		throw new UnrecoverableError(
			rawUrl
				? `LANGFLOW_URL is set to ${JSON.stringify(rawUrl)}, which is not an absolute http(s) URL.`
				: "LANGFLOW_URL is not configured.",
		);
	}

	const flowId = process.env.LANGFLOW_MAIN_FLOW_ID?.trim();

	if (!flowId) {
		throw new UnrecoverableError(
			"LANGFLOW_MAIN_FLOW_ID is not configured, so there is no flow to run.",
		);
	}

	const apiKey = process.env.LANGFLOW_API_KEY?.trim();

	if (!apiKey) {
		throw new UnrecoverableError(
			"LANGFLOW_API_KEY is not configured. The exposed key found in the flow must be revoked and replaced.",
		);
	}

	// Same reason as the Bio path: the job carries ids, the bases live in S3.
	const content = await resolve(job.sequenceId);

	const response = await fetch(`${baseUrl}/api/v1/webhook/${encodeURIComponent(flowId)}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify(buildPayload(job, content.sequence)),
		signal: AbortSignal.timeout(Number(process.env.LANGFLOW_TIMEOUT_MS ?? 120000)),
	});

	if (!response.ok) {
		throw new Error(
			`Langflow responded with ${response.status}: ${(await response.text()).slice(0, 500)}`,
		);
	}

	const text = await response.text();

	if (!text.trim()) {
		throw new Error("Langflow returned an empty body.");
	}

	let payload: Record<string, unknown>;

	try {
		payload = JSON.parse(text) as Record<string, unknown>;
	} catch {
		throw new Error(
			`Langflow returned a non-JSON response (${response.status}): ${text.slice(0, 200)}`,
		);
	}

	const outputs = payload.outputs;

	if (outputs === undefined || outputs === null) {
		throw new Error(
			`Langflow response had no "outputs" field (keys: ${Object.keys(payload).join(", ") || "none"}). The flow may have no output component wired.`,
		);
	}

	const collected = collectText(outputs).filter((entry) => entry.trim().length > 0);

	if (collected.length === 0) {
		throw new Error(
			"Langflow returned outputs but no text was found in them. The flow's output component may not be connected.",
		);
	}

	return {
		source: "langflow",
		flow_id: flowId,
		session_id: payload.session_id ?? null,
		// Multiple nodes can emit text (a component plus its parent). Keeping them
		// ordered and separate preserves provenance; the frontend decides whether
		// to join or show them individually.
		outputs: collected,
	};
};
