import { UnrecoverableError } from "bullmq";

import type { AnalysisJob } from "./queue";
import { resolveSequenceContent } from "./sequence-content";
import type { SequenceResolver } from "./sequence-content";

export type AnalysisOutcome = Record<string, unknown>;

/**
 * Runs an analysis through a Langflow flow over its synchronous run endpoint.
 *
 * Langflow exposes two ways to trigger a flow and they are NOT equivalent:
 *
 *   * `POST /api/v1/run/{flow_id}` executes the graph and returns the result
 *     (`{ outputs, session_id }`) in the same response. That is what the worker
 *     uses.
 *   * `POST /api/v1/webhook/{flow_id}` is asynchronous by design: it starts the
 *     flow in the background and answers `202 {"message": "Task started in the
 *     background"}` with no output at all. A job that needs a result can only
 *     ever read "no outputs" from it.
 *
 * The run endpoint injects `input_value` into the flow's Chat Input and applies
 * `tweaks` to components by id or display name, which is how the analysis type
 * reaches the Bio Analysis Connector without being concatenated into the
 * sequence text.
 *
 * The surrounding BullMQ job already provides the async boundary and the
 * frontend polls our own status endpoint, so a synchronous Langflow call is the
 * right shape here.
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
 * The connector component the `analysis_type` tweak addresses.
 *
 * Langflow matches a tweak by component id or display name. The display name is
 * used because it is stable across flow edits that only move nodes around, and
 * it is overridable for the case where the flow owner renames the component.
 */
const connectorName = (): string =>
	process.env.LANGFLOW_COMPONENT_NAME?.trim() || "Bio Analysis Connector";

/**
 * Builds the `/api/v1/run` body.
 *
 * The sequence is the flow's input (a Chat Input wired to the connector) and
 * `analysis_type` is a per-request parameter on the connector. They travel
 * separately so the sequence text is never interpreted as anything else.
 */
const buildRunRequest = (job: AnalysisJob, sequence: string): Record<string, unknown> => ({
	input_value: sequence,
	input_type: "chat",
	output_type: "chat",
	session_id: job.sequenceId,
	tweaks: {
		[connectorName()]: { analysis_type: job.analysisType },
	},
});

/**
 * Collects the analysis text from a `/api/v1/run` response.
 *
 * The documented shape is
 * `{ session_id, outputs: [ { outputs: [ { results: { message: { text } } } ] } ] }`
 * -- one entry per terminal output component, each under `results.message` --
 * so only that field is read.
 *
 * The previous implementation walked every key and collected any string under a
 * `text`/`message`/`result` branch. On this shape that also swept in the sender,
 * session id, run id and timestamps, so a single analysis came back as dozens of
 * "outputs". Reading the documented field keeps provenance (one string per
 * output component) without the noise.
 */
const extractRunOutputs = (outputs: unknown): string[] => {
	const found: string[] = [];

	const visit = (value: unknown, depth = 0): void => {
		// Depth is capped because this walks arbitrary decoded JSON. A hostile or
		// simply unexpected payload should surface as "no text found", not as a
		// stack overflow that takes the worker down.
		if (depth > 16 || value === null || typeof value !== "object") return;

		if (Array.isArray(value)) {
			for (const entry of value) visit(entry, depth + 1);
			return;
		}

		const record = value as Record<string, unknown>;
		const results = record.results;

		if (results !== null && typeof results === "object" && !Array.isArray(results)) {
			const message = (results as Record<string, unknown>).message;

			if (message !== null && typeof message === "object" && !Array.isArray(message)) {
				const text = (message as Record<string, unknown>).text;

				if (typeof text === "string" && text.trim()) found.push(text);
			}
		}

		for (const entry of Object.values(record)) visit(entry, depth + 1);
	};

	visit(outputs);
	return found;
};

/**
 * The optional AI-interpretation flow.
 *
 * The connector's own flow is deterministic (Bio in, structured JSON out) and
 * runs with no model access at all. The written interpretation is a *second*,
 * optional flow — the friend's Insight Analyst (WatsonX granite). Splitting it
 * out means a broken or unconfigured model can never take the structured
 * analysis down with it.
 */
const insightFlowId = (): string | undefined => process.env.LANGFLOW_INSIGHT_FLOW_ID?.trim() || undefined;

/**
 * Calls the insight flow with the connector's `{ user_question, analysis_results }`
 * report and returns its prose, or `undefined` when it is unconfigured or fails.
 *
 * Deliberately best-effort: the insight is a reasoning layer over numbers that
 * are already correct, so a failure here degrades the result, it does not fail
 * the analysis. Every failure is logged.
 */
const runInsightFlow = async (
	baseUrl: string,
	apiKey: string,
	sessionId: string,
	report: string,
): Promise<string | undefined> => {
	const flowId = insightFlowId();
	if (!flowId) return undefined;

	try {
		const response = await fetch(`${baseUrl}/api/v1/run/${encodeURIComponent(flowId)}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": apiKey,
			},
			body: JSON.stringify({
				input_value: report,
				input_type: "chat",
				output_type: "chat",
				session_id: sessionId,
			}),
			signal: AbortSignal.timeout(Number(process.env.LANGFLOW_TIMEOUT_MS ?? 120000)),
		});

		if (!response.ok) {
			console.warn(
				`[analysis] Insight flow responded with ${response.status}; continuing without AI interpretation.`,
			);
			return undefined;
		}

		const payload = JSON.parse(await response.text()) as Record<string, unknown>;
		const [text] = extractRunOutputs(payload.outputs);
		return text && text.trim() ? text : undefined;
	} catch (error) {
		console.warn(
			`[analysis] Insight flow failed; continuing without AI interpretation: ${error instanceof Error ? error.message : String(error)}`,
		);
		return undefined;
	}
};

/** True when a `/run` text is the connector's structured report, not prose. */
const isStructuredReport = (text: string): boolean => {
	try {
		const parsed = JSON.parse(text) as unknown;
		return (
			parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			"analysis_results" in (parsed as Record<string, unknown>)
		);
	} catch {
		return false;
	}
};

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

	const response = await fetch(`${baseUrl}/api/v1/run/${encodeURIComponent(flowId)}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
		},
		body: JSON.stringify(buildRunRequest(job, content.sequence)),
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

	const collected = extractRunOutputs(outputs).filter((entry) => entry.trim().length > 0);

	if (collected.length === 0) {
		throw new Error(
			"Langflow returned outputs but no text was found in them. The flow's output component may not be connected.",
		);
	}

	// Optional AI interpretation, requested after the deterministic report has
	// already been secured. A failure here is swallowed by `runInsightFlow`, so it
	// can never fail an analysis that has real numbers.
	const report = collected.find(isStructuredReport);
	if (report) {
		const insight = await runInsightFlow(baseUrl, apiKey, job.sequenceId, report);
		if (insight) collected.push(insight);
	}

	return {
		source: "langflow",
		flow_id: flowId,
		session_id: payload.session_id ?? null,
		// Multiple terminal components can emit text; keeping them ordered and
		// separate preserves provenance the frontend can rely on.
		outputs: collected,
	};
};
