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

const checkLangflow = async (): Promise<DependencyStatus> => {
	const base = trimmed(process.env.LANGFLOW_URL);
	const flowId = trimmed(process.env.LANGFLOW_MAIN_FLOW_ID);

	if (!base) {
		return {
			name: "langflow",
			configured: false,
			reachable: null,
			detail: "LANGFLOW_URL is not set",
		};
	}

	// Health, not the webhook. The webhook returns 404 whenever its node is
	// unconfigured, which is a Langflow-side configuration state rather than a
	// reachability problem, and reporting that here would be misleading.
	const { reachable, detail } = await probe(
		`${base.replace(/\/$/, "")}/health_check`,
	);

	const notes = [detail];

	if (reachable && !flowId) {
		notes.push("LANGFLOW_MAIN_FLOW_ID is not set, so no webhook URL can be built");
	}

	if (!trimmed(process.env.LANGFLOW_API_KEY)) {
		notes.push("LANGFLOW_API_KEY is not set");
	}

	return {
		name: "langflow",
		configured: true,
		reachable,
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