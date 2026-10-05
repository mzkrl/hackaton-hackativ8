/**
 * Reachability checks for the analysis pipeline's external dependencies.
 *
 * This exists because the pipeline spans services that live outside this
 * process: the Sequence Analysis API (Biopython) and Langflow. A misconfigured
 * webhook or a wrong host in either of them fails only when an analysis runs,
 * which means the failure surfaces to a user as a queued job that never
 * finishes, with nothing in the logs saying which service was unreachable.
 *
 * `GET /health/dependencies` calls this so the wiring can be verified directly,
 * without submitting an analysis and waiting for it to fail.
 *
 * Two rules for everything in this module:
 *
 *   - It never throws. A diagnostic that can crash is useless as a diagnostic.
 *   - It never returns a secret. Only whether one is present, never its value.
 */

import { isQueueConfigured, ANALYSIS_QUEUE, workerConnection } from "./queue";

export type DependencyStatus = {
	name: string;
	configured: boolean;
	/** `null` when there is nothing configured to reach. */
	reachable: boolean | null;
	detail?: string;
};

const trimmed = (value: string | undefined) => value?.trim() || "";

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Probes an HTTP endpoint, reporting reachability instead of throwing.
 *
 * Any non-2xx counts as reachable-but-wrong, which is the distinction that
 * matters most in practice: a 404 means the host is up and the path is
 * misconfigured, while a connection error means the host itself is wrong.
 */
const probe = async (
	url: string,
	init?: RequestInit,
): Promise<{ reachable: boolean; detail: string }> => {
	try {
		const response = await fetch(url, {
			...init,
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});

		return {
			reachable: response.ok,
			detail: response.ok
				? "reachable"
				: `HTTP ${response.status} — host is up, path or auth is wrong`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";

		// Names the likely cause, because "fetch failed" alone costs an hour of
		// debugging the wrong layer.
		const cause = /timeout|abort/i.test(message)
			? "no response within timeout"
			: /ECONNREFUSED/i.test(message)
				? "connection refused"
				: /ENOTFOUND|EAI_AGAIN/i.test(message)
					? "host does not resolve"
					: /certificate|SSL|TLS/i.test(message)
						? "TLS failure"
						: message;

		return { reachable: false, detail: cause };
	}
};

const checkSequenceAnalysisApi = async (): Promise<DependencyStatus> => {
	const base = trimmed(process.env.BIO_SERVICE_URL);

	if (!base) {
		return {
			name: "sequence_analysis_api",
			configured: false,
			reachable: null,
			detail: "BIO_SERVICE_URL is not set",
		};
	}

	const { reachable, detail } = await probe(`${base.replace(/\/$/, "")}/`);

	return {
		name: "sequence_analysis_api",
		configured: true,
		reachable,
		detail: reachable ? `${detail} (${base})` : detail,
	};
};

/**
 * Probes the real webhook endpoint, if the operator has opted in.
 *
 * This is opt-in via `LANGFLOW_WEBHOOK_PROBE=1` because a POST to a Langflow
 * webhook **runs the flow**: it invokes the model, spends tokens, and burns a
 * worker slot. A health endpoint polled by an uptime monitor must not do that
 * repeatedly, so the default probe stays on the cheap `/health_check` route.
 *
 * When it is enabled, an intentionally empty body is sent. The response status
 * is what carries the verdict, and the mapping below is chosen so the probe
 * distinguishes the failure modes that send people to the wrong layer:
 *
 * | Status  | Meaning                                                        |
 * |---------|----------------------------------------------------------------|
 * | 2xx     | Endpoint worked and the flow ran. Costs one run per probe.        |
 * | 400/422 | Rejected the empty payload. Expected: host, path and key are fine |
 * | 401/403 | Host and path fine, **API key rejected** -> pipeline would fail  |
 * | 404     | Flow id wrong, or the path is wrong                              |
 * | 5xx     | Reached the service, but it is erroring                          |
 * | no reply| Cannot reach it at all                                           |
 *
 * Exported so the status-to-verdict mapping can be tested without spending a
 * real flow run on every CI run.
 */
export const probeLangflowWebhook = async (
	base: string,
	flowId: string,
	apiKey: string,
): Promise<{ reachable: boolean; detail: string }> => {
	try {
		const response = await fetch(
			`${base.replace(/\/$/, "")}/api/v1/webhook/${encodeURIComponent(flowId)}`,
			{
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": apiKey },
				body: "{}",
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			},
		);

		if (response.ok) {
			return {
				reachable: true,
				detail: "webhook reachable (the probe body was accepted and the flow ran)",
			};
		}

		if (response.status === 400 || response.status === 422) {
			// The expected outcome: the endpoint is live and authenticated, and it
			// declined an empty payload. That is a healthy wiring.
			return {
				reachable: true,
				detail: `webhook reachable and authenticated; rejected the empty probe body with ${response.status}`,
			};
		}

		if (response.status === 401 || response.status === 403) {
			return {
				reachable: false,
				detail: `webhook found but the API key was rejected (${response.status}) — every analysis will fail until LANGFLOW_API_KEY is replaced`,
			};
		}

		if (response.status === 404) {
			return {
				reachable: false,
				detail: "webhook returned 404 — the flow id does not exist at this host",
			};
		}

		return {
			reachable: false,
			detail: `webhook reachable but erroring: HTTP ${response.status}`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		return {
			reachable: false,
			detail: `webhook unreachable: ${/timeout|abort/i.test(message) ? "no response within timeout" : message}`,
		};
	}
};

export const checkLangflow = async (): Promise<DependencyStatus> => {
	const base = trimmed(process.env.LANGFLOW_URL);
	const flowId = trimmed(process.env.LANGFLOW_MAIN_FLOW_ID);
	const apiKey = trimmed(process.env.LANGFLOW_API_KEY);

	if (!base) {
		return {
			name: "langflow",
			configured: false,
			reachable: null,
			detail: "LANGFLOW_URL is not set",
		};
	}

	// Health, not the webhook by default: the webhook is POST-only, so a GET
	// against it returns 404 even when everything is wired correctly, which would
	// report a healthy deployment as broken.
	const { reachable, detail } = await probe(
		`${base.replace(/\/$/, "")}/health_check`,
	);

	const notes = [detail];

	if (!flowId) {
		notes.push("LANGFLOW_MAIN_FLOW_ID is not set, so no webhook URL can be built");
	}

	if (!apiKey) {
		notes.push("LANGFLOW_API_KEY is not set");
	}

	// `configured` is about whether the pipeline *could* run, which needs all
	// three values, not just the host. Reporting a half-configured Langflow as
	// configured is what let a missing key masquerade as a healthy deployment.
	const fullyConfigured = Boolean(base && flowId && apiKey);

	if (fullyConfigured && trimmed(process.env.LANGFLOW_WEBHOOK_PROBE) === "1") {
		const webhook = await probeLangflowWebhook(base, flowId, apiKey);
		notes.push(webhook.detail);
		return {
			name: "langflow",
			configured: true,
			// The webhook verdict wins: `/health_check` says the process is up,
			// the webhook says the pipeline will actually work.
			reachable: reachable && webhook.reachable,
			detail: notes.join("; "),
		};
	}

	return {
		name: "langflow",
		configured: fullyConfigured,
		reachable: fullyConfigured ? reachable : false,
		detail: notes.join("; "),
	};
};

const checkRedis = async (): Promise<DependencyStatus> => {
	if (!trimmed(process.env.REDIS_URL)) {
		return {
			name: "redis",
			configured: false,
			reachable: null,
			detail: isQueueConfigured()
				? "enqueueing over HTTP via QUEUE_ENQUEUE_URL; no local Redis"
				: "REDIS_URL is not set",
		};
	}

	// Probes through BullMQ rather than a direct `redis` client: BullMQ carries
	// its own ioredis, and reaching for a second Redis client would add a
	// dependency purely to answer "is the queue reachable".
	const { Queue } = await import("bullmq");

	let queue: InstanceType<typeof Queue> | undefined;

	try {
		queue = new Queue(ANALYSIS_QUEUE, { connection: workerConnection() });
		await queue.waitUntilReady();

		return { name: "redis", configured: true, reachable: true, detail: "reachable" };
	} catch (error) {
		return {
			name: "redis",
			configured: true,
			reachable: false,
			detail: error instanceof Error ? error.message : "unknown error",
		};
	} finally {
		// Never let a failed probe keep a socket open, or this endpoint leaks a
		// connection per call.
		await queue?.close().catch(() => undefined);
	}
};

/**
 * Checks every dependency the analysis pipeline needs, in the order a failure
 * would be discovered. Never throws.
 */
export const checkAnalysisDependencies = async (): Promise<DependencyStatus[]> =>
	Promise.all([checkRedis(), checkSequenceAnalysisApi(), checkLangflow()]);

/**
 * True when every configured dependency answered, i.e. the pipeline has a
 * chance of completing. A dependency left unconfigured on purpose (a local dev
 * run without Langflow) does not count as a failure.
 */
export const dependenciesReady = (statuses: DependencyStatus[]) =>
	statuses.every((status) => !status.configured || status.reachable === true);