import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { runBioAnalysis } from "../../src/lib/bio-executor";
import { isLangflowEnabled, langflowConfigured, runLangflowAnalysis } from "../../src/lib/langflow-executor";
import { runAnalysis } from "../../src/lib/analysis-executor";
import { checkLangflow, probeLangflowFlow } from "../../src/lib/analysis-dependencies";
import type { AnalysisJob } from "../../src/lib/queue";
import type { SequenceResolver } from "../../src/lib/sequence-content";

/**
 * The executors are unit-tested in isolation from the network and from object
 * storage, because neither can be depended on here: the live Langflow contract is
 * still unconfirmed, and the Bio Service only accepts a running backend on the
 * VPS. What is worth pinning down is the part we own -- the URL, the method, the
 * request body, the auth header, and how each response shape is turned into
 * `result_json`. Those are exactly the details that were wrong before.
 *
 * The sequence resolver is injected rather than mocked with `mock.module`. Bun's
 * module mocks are process-global and persist for the rest of the run, so mocking
 * it here silently swapped the real parser into every other suite and made them
 * fail against the stub's return value.
 */

const SEQUENCE = "ACGTACGTACGTACGTACGT";

const resolveStub: SequenceResolver = async () => ({
	sequenceId: job.sequenceId,
	format: "fasta",
	sequence: SEQUENCE,
	length: SEQUENCE.length,
});

const job: AnalysisJob = {
	analysisId: "11111111-1111-4111-8111-111111111111",
	sequenceId: "22222222-2222-4222-8222-222222222222",
	projectId: "33333333-3333-4333-8333-333333333333",
	analysisType: "gc_content",
};

const envKeys = [
	"BIO_SERVICE_URL",
	"BIO_SERVICE_TIMEOUT_MS",
	"LANGFLOW_URL",
	"LANGFLOW_MAIN_FLOW_ID",
	"LANGFLOW_API_KEY",
	"LANGFLOW_ENABLED",
	"LANGFLOW_TIMEOUT_MS",
	"LANGFLOW_COMPONENT_NAME",
	"LANGFLOW_FLOW_PROBE",
	"LANGFLOW_INSIGHT_FLOW_ID",
] as const;

const saved = new Map<string, string | undefined>();

type Call = { url: string; init: RequestInit | undefined };

let calls: Call[] = [];

/** Captured before any stub is installed, so `afterEach` can put the real one back. */
const realFetch = globalThis.fetch;

/** Installs a fetch stub that records every call and returns one canned response. */
const stubFetch = (
	responder: (url: string) => Response | Promise<Response>,
) => {
	calls = [];
	globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		calls.push({ url, init });
		return responder(url);
	}) as unknown as typeof fetch;
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const bioOk = () => json({ status: "ok", file_metadata: { name: "probe" }, results: { gc: 51 } });
const langflowOk = () =>
	json({
		session_id: "sess-123",
		outputs: [
			{
				inputs: { input_value: SEQUENCE },
				outputs: [
					{
						results: { message: { text: "GC content is 51%." } },
						// Metadata sits alongside the text, as the real endpoint
						// returns it; none of it may leak into the outputs.
						outputs: { message: { message: "GC content is 51%.", type: "text" } },
						messages: [{ message: "GC content is 51%.", sender: "Machine" }],
					},
				],
			},
		],
	});

/** The connector's real output: a JSON `{ user_question, analysis_results }`. */
const structuredReport = {
	user_question: "gc_content",
	analysis_results: {
		calculate_gc_content: { gc_content_percent: 51, gc_count: 20, at_count: 20, total_length: 40 },
		calculate_nucleotide_composition: {
			counts: { A: 10, T: 10, G: 10, C: 10, U: 0, other: 0 },
			total_length: 40,
		},
	},
};

const langflowStructuredOk = () =>
	json({
		session_id: "sess-123",
		outputs: [
			{
				outputs: [{ results: { message: { text: JSON.stringify(structuredReport) } } }],
			},
		],
	});

const insightOk = () =>
	json({ outputs: [{ outputs: [{ results: { message: { text: "The GC content is 51%." } } }] }] });

const bodyOf = (call: Call) => JSON.parse(String(call.init?.body ?? "{}")) as Record<string, unknown>;
const headersOf = (call: Call) => (call.init?.headers ?? {}) as Record<string, string>;

beforeEach(() => {
	for (const key of envKeys) saved.set(key, process.env[key]);
	for (const key of envKeys) delete process.env[key];
});

afterEach(() => {
	for (const key of envKeys) {
		const value = saved.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}

	// `stubFetch` replaces a global, and Bun runs every test file in one process,
	// so leaving it installed would hand the next file a canned response for any
	// real request it makes. Restoring here keeps the leak contained to this file.
	globalThis.fetch = realFetch;
});

describe("Bio Service executor", () => {
	beforeEach(() => {
		process.env.BIO_SERVICE_URL = "http://bio.test:8001";
	});

	test("posts the sequence and tools to /analyze", async () => {
		stubFetch(() => bioOk());

		await runBioAnalysis(job, resolveStub);

		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe("http://bio.test:8001/analyze");
		expect(calls[0]!.init?.method).toBe("POST");
		// The old contract sent ids, which the service cannot use: it has no
		// database access of its own. And the tool name is NOT the analysis type --
		// the service's vocabulary is `calculate_gc_content`, not `gc_content`.
		expect(bodyOf(calls[0]!)).toEqual({
			sequence: SEQUENCE,
			tools: ["calculate_gc_content"],
		});
	});

	test("stores only results, so result_json has one source of truth", async () => {
		stubFetch(() => bioOk());

		const outcome = await runBioAnalysis(job, resolveStub);

		expect(outcome).toEqual({ source: "bio_service", results: { gc: 51 } });
	});

	test("strips a path from the configured base URL", async () => {
		process.env.BIO_SERVICE_URL = "http://bio.test:8001/some/nested/path";
		stubFetch(() => bioOk());

		await runBioAnalysis(job, resolveStub);

		expect(calls[0]!.url).toBe("http://bio.test:8001/analyze");
	});

	test("rejects a response whose results are not an object", async () => {
		stubFetch(() => json({ status: "ok", results: "51% GC" }));

		await expect(runBioAnalysis(job, resolveStub)).rejects.toThrow(/results.*expected an object/i);
	});

	test("rejects a response with no results field", async () => {
		stubFetch(() => json({ status: "ok" }));

		await expect(runBioAnalysis(job, resolveStub)).rejects.toThrow(/did not contain a "results" field/);
	});

	test("reports a non-JSON body instead of a parse error", async () => {
		stubFetch(() => new Response("<html>gateway</html>", { status: 200 }));

		await expect(runBioAnalysis(job, resolveStub)).rejects.toThrow(/non-JSON response/);
	});

	test("fails unrecoverably when the URL is missing or unusable", async () => {
		// A commented-out env line like `BIO_SERVICE_URL=   # note` is a non-empty
		// string, so a truthiness check would let it through.
		process.env.BIO_SERVICE_URL = "   # langflow lives here";
		stubFetch(() => bioOk());

		await expect(runBioAnalysis(job, resolveStub)).rejects.toThrow(/not an absolute http\(s\) URL/);
		expect(calls).toHaveLength(0);
	});

	test("does not call the network when the URL is absent", async () => {
		delete process.env.BIO_SERVICE_URL;
		stubFetch(() => bioOk());

		await expect(runBioAnalysis(job, resolveStub)).rejects.toThrow(/BIO_SERVICE_URL is not configured/);
		expect(calls).toHaveLength(0);
	});

	test("surfaces an upstream error status", async () => {
		stubFetch(() => new Response("upstream exploded", { status: 502 }));

		await expect(runBioAnalysis(job, resolveStub)).rejects.toThrow(/responded with 502/);
	});

	test("refuses a type with no Bio tool, without calling it", async () => {
		// `reverse_complement` is not a Bio Service tool (and is no longer an
		// allowed analysis type). Posting a placeholder name would return 400, so
		// the request is never made.
		stubFetch(() => bioOk());

		await expect(
			runBioAnalysis({ ...job, analysisType: "reverse_complement" }, resolveStub),
		).rejects.toThrow(/Unknown analysis type/);
		expect(calls).toHaveLength(0);
	});

	test("maps derived types to the tool that supplies their inputs", async () => {
		// There is no dedicated AT tool, so AT% comes out of the composition
		// tool's A% and T%.
		stubFetch(() => bioOk());

		await runBioAnalysis({ ...job, analysisType: "at_content" }, resolveStub);

		expect(bodyOf(calls[0]!).tools).toEqual(["calculate_nucleotide_composition"]);
	});
});

describe("Langflow executor", () => {
	beforeEach(() => {
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.LANGFLOW_MAIN_FLOW_ID = "flow-abc";
		process.env.LANGFLOW_API_KEY = "test-key";
	});

	test("posts to the synchronous run path with the api key header", async () => {
		stubFetch(() => langflowOk());

		await runLangflowAnalysis(job, resolveStub);

		expect(calls[0]!.url).toBe("https://langflow.example/api/v1/run/flow-abc");
		expect(headersOf(calls[0]!)["x-api-key"]).toBe("test-key");
	});

	test("sends the resolved sequence as the run input, not a sequence id", async () => {
		stubFetch(() => langflowOk());

		await runLangflowAnalysis(job, resolveStub);

		expect(bodyOf(calls[0]!).input_value).toBe(SEQUENCE);
		expect(bodyOf(calls[0]!).session_id).toBe(job.sequenceId);
	});

	test("carries the analysis type in a tweak, not in the sequence", async () => {
		stubFetch(() => langflowOk());

		await runLangflowAnalysis(job, resolveStub);

		// The connector maps the GenePilot analysis type to a Bio tool name, so
		// it needs the type as a component parameter. Concatenating it into the
		// sequence text would corrupt the bases.
		expect(bodyOf(calls[0]!).tweaks).toEqual({
			"Bio Analysis Connector": { analysis_type: "gc_content" },
		});
	});

	test("allows the tweak component name to be overridden", async () => {
		process.env.LANGFLOW_COMPONENT_NAME = "Custom Connector";
		stubFetch(() => langflowOk());

		await runLangflowAnalysis(job, resolveStub);

		expect(bodyOf(calls[0]!).tweaks).toEqual({
			"Custom Connector": { analysis_type: "gc_content" },
		});
	});

	test("percent-encodes the flow id so it cannot alter the path", async () => {
		process.env.LANGFLOW_MAIN_FLOW_ID = "../other-flow";
		stubFetch(() => langflowOk());

		await runLangflowAnalysis(job, resolveStub);

		expect(calls[0]!.url).toBe("https://langflow.example/api/v1/run/..%2Fother-flow");
	});

	test("normalises nested flow outputs and keeps the session id", async () => {
		stubFetch(() => langflowOk());

		const outcome = await runLangflowAnalysis(job, resolveStub);

		expect(outcome).toEqual({
			source: "langflow",
			flow_id: "flow-abc",
			session_id: "sess-123",
			outputs: ["GC content is 51%."],
		});
	});

	test("rejects a response with no outputs field", async () => {
		stubFetch(() => json({ message: "done" }));

		await expect(runLangflowAnalysis(job, resolveStub)).rejects.toThrow(/no "outputs" field/);
	});

	test("rejects outputs that carry no text", async () => {
		stubFetch(() => json({ outputs: [{ outputs: [{ results: { message: {} } }] }] }));

		await expect(runLangflowAnalysis(job, resolveStub)).rejects.toThrow(/no text was found/);
	});

	test("rejects an empty body", async () => {
		stubFetch(() => new Response("", { status: 200 }));

		await expect(runLangflowAnalysis(job, resolveStub)).rejects.toThrow(/empty body/);
	});

	test("fails unrecoverably when the api key is missing", async () => {
		delete process.env.LANGFLOW_API_KEY;
		stubFetch(() => langflowOk());

		await expect(runLangflowAnalysis(job, resolveStub)).rejects.toThrow(/LANGFLOW_API_KEY is not configured/);
		expect(calls).toHaveLength(0);
	});

	test("fails unrecoverably when the flow id is missing", async () => {
		delete process.env.LANGFLOW_MAIN_FLOW_ID;
		stubFetch(() => langflowOk());

		await expect(runLangflowAnalysis(job, resolveStub)).rejects.toThrow(
			/LANGFLOW_MAIN_FLOW_ID is not configured/,
		);
	});

	test("treats LANGFLOW_ENABLED as an explicit opt-in", () => {
		expect(isLangflowEnabled()).toBe(false);

		process.env.LANGFLOW_ENABLED = "true";
		expect(isLangflowEnabled()).toBe(true);
		expect(langflowConfigured()).toBe(true);

		// Anything else, including "1" or "yes", is not an opt-in. Reading a
		// truthy-looking string as true would silently route production traffic
		// through a flow whose contract is still unconfirmed.
		process.env.LANGFLOW_ENABLED = "1";
		expect(isLangflowEnabled()).toBe(false);
	});

	test("reports incomplete configuration as unconfigured", async () => {
		process.env.LANGFLOW_ENABLED = "true";
		delete process.env.LANGFLOW_MAIN_FLOW_ID;

		// The health probe needs this: a `true` flag with a missing id must not
		// report as healthy.
		expect(langflowConfigured()).toBe(false);
	});
});

describe("optional insight flow", () => {
	beforeEach(() => {
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.LANGFLOW_MAIN_FLOW_ID = "flow-abc";
		process.env.LANGFLOW_API_KEY = "test-key";
	});

	test("runs the insight flow with the report and appends its prose", async () => {
		process.env.LANGFLOW_INSIGHT_FLOW_ID = "insight-abc";
		stubFetch((url) => (url.includes("insight-abc") ? insightOk() : langflowStructuredOk()));

		const outcome = await runLangflowAnalysis(job, resolveStub);

		expect(calls).toHaveLength(2);
		expect(calls[1]!.url).toBe("https://langflow.example/api/v1/run/insight-abc");
		// The insight flow's Chat Input expects exactly `{user_question, analysis_results}`.
		expect(bodyOf(calls[1]!).input_value).toBe(JSON.stringify(structuredReport));
		expect(outcome.outputs).toEqual([JSON.stringify(structuredReport), "The GC content is 51%."]);
	});

	test("never calls the insight flow when it is unconfigured", async () => {
		stubFetch(() => langflowStructuredOk());

		await runLangflowAnalysis(job, resolveStub);

		expect(calls).toHaveLength(1);
	});

	test("keeps the structured result when the insight flow fails", async () => {
		process.env.LANGFLOW_INSIGHT_FLOW_ID = "insight-abc";
		stubFetch((url) => (url.includes("insight-abc") ? json({}, 500) : langflowStructuredOk()));

		const outcome = await runLangflowAnalysis(job, resolveStub);

		// The numbers are already correct; a broken reasoning layer must not
		// take them down with it.
		expect(outcome.outputs).toEqual([JSON.stringify(structuredReport)]);
	});
});

describe("executor dispatch", () => {
	test("uses Langflow when it is enabled and configured", async () => {
		process.env.LANGFLOW_ENABLED = "true";
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.LANGFLOW_MAIN_FLOW_ID = "flow-abc";
		process.env.LANGFLOW_API_KEY = "test-key";
		process.env.BIO_SERVICE_URL = "http://bio.test:8001";
		stubFetch(() => langflowOk());

		const outcome = await runAnalysis(job, resolveStub);

		expect(outcome.source).toBe("langflow");
		expect(calls).toHaveLength(1);
	});

	test("normalises the outcome so result_json is flat regardless of executor", async () => {
		process.env.LANGFLOW_ENABLED = "true";
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.LANGFLOW_MAIN_FLOW_ID = "flow-abc";
		process.env.LANGFLOW_API_KEY = "test-key";
		stubFetch(() => langflowStructuredOk());

		const outcome = await runAnalysis(job, resolveStub);

		// The frontend reads flat fields; the wrapped executor shape must not
		// reach `result_json`.
		expect(outcome.source).toBe("langflow");
		expect(outcome.gc_content).toBe(51);
		expect(outcome.composition).toEqual({ A: 10, T: 10, G: 10, C: 10 });
	});

	test("uses the Bio Service when Langflow is disabled", async () => {
		process.env.BIO_SERVICE_URL = "http://bio.test:8001";
		stubFetch(() => bioOk());

		const outcome = await runAnalysis(job, resolveStub);

		expect(outcome.source).toBe("bio_service");
		expect(calls[0]!.url).toBe("http://bio.test:8001/analyze");
	});

	test("falls back to the Bio Service when Langflow times out", async () => {
		process.env.LANGFLOW_ENABLED = "true";
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.LANGFLOW_MAIN_FLOW_ID = "flow-abc";
		process.env.LANGFLOW_API_KEY = "test-key";
		process.env.BIO_SERVICE_URL = "http://bio.test:8001";
		stubFetch((url) => (url.includes("langflow") ? json({}, 504) : bioOk()));

		const outcome = await runAnalysis(job, resolveStub);

		// Real numbers beat an error about a flow the user cannot inspect.
		expect(outcome.source).toBe("bio_service");
		expect(calls).toHaveLength(2);
	});

	test("falls back to the Bio Service when Langflow is enabled but misconfigured", async () => {
		process.env.LANGFLOW_ENABLED = "true";
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.BIO_SERVICE_URL = "http://bio.test:8001";
		stubFetch(() => bioOk());

		const outcome = await runAnalysis(job, resolveStub);

		expect(outcome.source).toBe("bio_service");
		expect(calls).toHaveLength(1);
	});
});

describe("dependency probe", () => {
	beforeEach(() => {
		process.env.LANGFLOW_URL = "https://langflow.example";
		process.env.LANGFLOW_MAIN_FLOW_ID = "flow-abc";
		process.env.LANGFLOW_API_KEY = "test-key";
	});

	test("treats a found flow as a healthy wiring", async () => {
		// 200 means the id exists and the key was accepted -- the whole point of
		// the probe, and something `/health_check` cannot tell us.
		stubFetch(() => new Response("{}", { status: 200 }));

		const result = await probeLangflowFlow("https://langflow.example", "flow-abc", "k");

		expect(result.reachable).toBe(true);
	});

	test("calls a rejected key unreachable, because every analysis would fail", async () => {
		stubFetch(() => new Response("", { status: 401 }));

		const result = await probeLangflowFlow("https://langflow.example", "flow-abc", "bad");

		// The distinction that matters: the host is up, the pipeline is broken.
		expect(result.reachable).toBe(false);
		expect(result.detail).toMatch(/API key was rejected/);
	});

	test("calls a 404 an unknown flow rather than a wiring success", async () => {
		stubFetch(() => new Response("", { status: 404 }));

		const result = await probeLangflowFlow("https://langflow.example", "missing", "k");

		expect(result.reachable).toBe(false);
		expect(result.detail).toMatch(/404/);
	});

	test("does not touch the flow unless the operator opted in", async () => {
		// Default: only /health_check is touched. The flow probe is opt-in so an
		// uptime monitor never depends on a specific flow id.
		stubFetch(() => new Response("", { status: 200 }));

		await checkLangflow();

		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toContain("/health_check");
	});

	test("checks the flow only when the probe is explicitly enabled", async () => {
		process.env.LANGFLOW_FLOW_PROBE = "1";
		// The health route is healthy; the flow exists and the key is accepted.
		// The reported verdict is the conjunction, so both must succeed.
		stubFetch((url) => (url.includes("health_check") ? new Response("", { status: 200 }) : new Response("{}", { status: 200 })));

		const status = await checkLangflow();

		expect(calls).toHaveLength(2);
		expect(calls[1]!.url).toBe("https://langflow.example/api/v1/flows/flow-abc");
		expect(status.reachable).toBe(true);
	});

	test("stays unhealthy when the flow probe fails even though the host is up", async () => {
		process.env.LANGFLOW_FLOW_PROBE = "1";
		stubFetch((url) => (url.includes("health_check") ? new Response("", { status: 200 }) : new Response("", { status: 401 })));

		const status = await checkLangflow();

		// The case this whole change exists for: `/health_check` says green, and
		// every analysis would still fail.
		expect(status.reachable).toBe(false);
	});

	test("reports a half-configured Langflow as not configured", async () => {
		delete process.env.LANGFLOW_API_KEY;
		stubFetch(() => new Response("", { status: 200 }));

		const status = await checkLangflow();

		// A reachable host with no key is not a working pipeline, and reporting it
		// as configured is how a missing key stays invisible.
		expect(status.configured).toBe(false);
		expect(status.reachable).toBe(false);
		expect(status.detail).toMatch(/LANGFLOW_API_KEY is not set/);
	});
});
