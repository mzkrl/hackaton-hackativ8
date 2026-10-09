import type { ConnectionOptions, Queue as BullQueue } from "bullmq";

import { ApiError } from "./api-error";

/**
 * The BullMQ queue name, i.e. the Redis key prefix.
 *
 * Overridable so a local run can sit on its own queue while an older worker
 * elsewhere shares the same Redis: BullMQ hands each job to the longest-waiting
 * blocked worker, so a stale remote worker would otherwise win every job. Set
 * `ANALYSIS_QUEUE_NAME` in `back/.env` for local isolation; production leaves it
 * unset and gets the default.
 */
export const ANALYSIS_QUEUE = process.env.ANALYSIS_QUEUE_NAME?.trim() || "genomic-analysis";

export type AnalysisJob = {
	analysisId: string;
	sequenceId: string;
	projectId: string;
	analysisType: string;
	/**
	 * 0 (or absent) means "run the analysis". A positive value means "this is a
	 * re-check: look at the analysis row and decide what, if anything, is left
	 * to do", and counts how many re-checks have already been scheduled.
	 *
	 * The count is what stops a run that never lands from polling forever.
	 */
	recheckCount?: number;
};

const DEFAULT_ATTEMPTS = 3;

export const isQueueConfigured = () =>
	Boolean(process.env.REDIS_URL?.trim()) || Boolean(process.env.QUEUE_ENQUEUE_URL?.trim());

export const assertQueueConfigured = () => {
	if (!isQueueConfigured()) {
		throw new ApiError(
			503,
			"QUEUE_NOT_CONFIGURED",
			"The analysis queue is not configured.",
		);
	}
};

const producerConnection = (): ConnectionOptions => {
	const url = process.env.REDIS_URL?.trim();
	if (!url) {
		throw new ApiError(
			503,
			"QUEUE_NOT_CONFIGURED",
			"The analysis queue is not configured.",
		);
	}

	return {
		url,
		maxRetriesPerRequest: 1,
		enableOfflineQueue: false,
		connectTimeout: 5000,
		retryStrategy: () => null,
	};
};

export const workerConnection = (): ConnectionOptions => {
	const url = process.env.REDIS_URL?.trim();
	if (!url) {
		throw new Error("REDIS_URL is required to run the analysis worker.");
	}

	return { url, maxRetriesPerRequest: null };
};

export const workerConcurrency = () => {
	const parsed = Number(process.env.WORKER_CONCURRENCY?.trim() || 2);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
};

/**
 * How long a single run may hold a worker slot before the worker gives up
 * waiting and hands the rest of the wait to a delayed re-check job.
 *
 * The default is deliberately short. A worker slot is the scarce resource: with
 * concurrency 2, one run that sits for ten minutes blocks a quarter of the
 * queue for that whole time. Releasing the slot after 30s and polling from a
 * delayed job costs one extra Redis round trip per interval and keeps the slot
 * free for work that can actually finish.
 */
export const workerJobTimeoutMs = () => {
	const parsed = Number(process.env.WORKER_JOB_TIMEOUT_MS?.trim() || 30_000);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 30_000;
};

/**
 * Delay between re-check jobs. Long enough that a run which is merely slow has
 * a chance to land before the next poll, short enough that a user watching the
 * board is not left staring at "processing" for long.
 */
export const workerRecheckDelayMs = () => {
	const parsed = Number(process.env.WORKER_RECHECK_DELAY_MS?.trim() || 30_000);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 30_000;
};

/**
 * Upper bound on re-checks, so a run that never lands cannot poll forever.
 *
 * The bound is on *re-checks*, not on total elapsed time: a run that times out
 * and is re-checked ten times at 30s intervals has been running for roughly
 * five minutes before it is failed, which is longer than any executor call
 * should legitimately take.
 */
export const workerMaxRechecks = () => {
	const parsed = Number(process.env.WORKER_MAX_RECHECKS?.trim() || 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 10;
};

const queueAttempts = () => {
	const parsed = Number(process.env.QUEUE_ATTEMPTS?.trim() || DEFAULT_ATTEMPTS);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_ATTEMPTS;
};

const jobOptions = () => ({
	attempts: queueAttempts(),
	backoff: { type: "exponential" as const, delay: 2000 },
	removeOnComplete: { age: 3600, count: 1000 },
	removeOnFail: { age: 86400, count: 5000 },
});

let queuePromise: Promise<BullQueue<AnalysisJob>> | undefined;

/**
 * Drops the cached producer so the next call builds a fresh one.
 *
 * `producerConnection` sets `retryStrategy: () => null`, which is right for a
 * request path — a broken Redis should fail fast rather than pile up
 * reconnects. But it also means a cached `Queue` stays permanently dead once
 * its socket drops. Without this reset the API would stay permanently unable to
 * enqueue, even after Redis came back, until the process was restarted.
 */
const discardProducerQueue = async () => {
	const pending = queuePromise;
	queuePromise = undefined;

	if (!pending) return;

	await pending
		.then((queue) => queue.close())
		.catch(() => {
			// Nothing to close if it never resolved.
		});
};

const getProducerQueue = async () => {
	if (!queuePromise) {
		queuePromise = import("bullmq")
			.then(
				({ Queue }) =>
					new Queue<AnalysisJob>(ANALYSIS_QUEUE, {
						connection: producerConnection(),
					}),
			)
			.catch((error) => {
				// Do not cache a failed import/construct; the next request should retry.
				queuePromise = undefined;
				throw error;
			});
	}

	return queuePromise;
};

const enqueueViaHttp = async (job: AnalysisJob) => {
	const baseUrl = process.env.QUEUE_ENQUEUE_URL?.trim();
	const secret = process.env.QUEUE_SECRET?.trim();

	if (!baseUrl) {
		throw new ApiError(
			503,
			"QUEUE_NOT_CONFIGURED",
			"The analysis queue is not configured.",
		);
	}

	if (!secret) {
		throw new ApiError(
			503,
			"QUEUE_NOT_CONFIGURED",
			"QUEUE_SECRET is required when QUEUE_ENQUEUE_URL is set.",
		);
	}

	const response = await fetch(`${baseUrl.replace(/\/$/, "")}/enqueue`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-queue-secret": secret,
		},
		body: JSON.stringify(job),
	});

	if (!response.ok) {
		throw new ApiError(
			503,
			"QUEUE_UNAVAILABLE",
			`Enqueue service responded with ${response.status}.`,
		);
	}

	const payload = (await response.json()) as { jobId?: string };
	if (!payload.jobId) {
		throw new ApiError(
			503,
			"QUEUE_UNAVAILABLE",
			"Enqueue service did not return a job id.",
		);
	}

	return payload.jobId;
};

/**
 * A point-in-time view of the queue, for monitoring and for the frontend.
 *
 * Counts are informational: `waiting` and `delayed` describe work not yet
 * started, `active` is work in progress, and the failed count is the retained
 * failures. None of this is an authorisation input.
 */
export type QueueStatus = {
	configured: boolean;
	queue: string;
	waiting: number;
	active: number;
	delayed: number;
	failed: number;
	completed: number;
	reachable: boolean;
};

export const queueStatus = async (): Promise<QueueStatus> => {
	const base: QueueStatus = {
		configured: isQueueConfigured(),
		queue: ANALYSIS_QUEUE,
		waiting: 0,
		active: 0,
		delayed: 0,
		failed: 0,
		completed: 0,
		reachable: false,
	};

	// The HTTP-only deployment keeps its counters on the worker, so there is
	// nothing to read here.
	if (!isQueueConfigured() || process.env.QUEUE_ENQUEUE_URL?.trim()) {
		return base;
	}

	try {
		const queue = await getProducerQueue();
		const counts = await queue.getJobCounts(
			"waiting",
			"active",
			"delayed",
			"failed",
			"completed",
		);

		return {
			...base,
			waiting: counts.waiting ?? 0,
			active: counts.active ?? 0,
			delayed: counts.delayed ?? 0,
			failed: counts.failed ?? 0,
			completed: counts.completed ?? 0,
			reachable: true,
		};
	} catch (error) {
		console.error("[queue] status probe failed:", error);
		// Reset the cached producer: the connection options never retry, so
		// keeping it would leave the API permanently unable to enqueue even after
		// Redis recovers.
		await discardProducerQueue();
		return base;
	}
};

export const enqueueAnalysis = async (job: AnalysisJob) => {
	if (process.env.QUEUE_ENQUEUE_URL?.trim()) return enqueueViaHttp(job);

	// Same reasoning as the status probe: a dead cached producer is discarded so
	// a transient Redis outage does not permanently disable the queue.
	try {
		const queue = await getProducerQueue();
		const added = await queue.add(ANALYSIS_QUEUE, job, {
			...jobOptions(),
			jobId: job.analysisId,
		});

		return added.id ?? job.analysisId;
	} catch (error) {
		await discardProducerQueue();
		throw error;
	}
};

/**
 * Removes a queued analysis and any re-checks scheduled for it.
 *
 * Best-effort by design: a job the worker has already claimed is `active` and
 * cannot be removed (its lock is held), and a remote worker reached over
 * `QUEUE_ENQUEUE_URL` owns the queue. Deleting the row is what actually stops a
 * run from mattering -- the worker's later write targets a row that is gone.
 *
 * Errors are swallowed: a delete must not fail just because Redis is down.
 */
export const discardAnalysisJob = async (analysisId: string) => {
	if (process.env.QUEUE_ENQUEUE_URL?.trim()) return;

	const jobIds = [analysisId];
	for (let count = 1; count <= workerMaxRechecks(); count += 1) {
		jobIds.push(`${analysisId}:recheck:${count}`);
	}

	try {
		const queue = await getProducerQueue();
		await Promise.all(jobIds.map((jobId) => queue.remove(jobId).catch(() => 0)));
	} catch (error) {
		await discardProducerQueue();
		console.warn(`[queue] could not discard jobs for ${analysisId}:`, error);
	}
};

/**
 * Schedules a delayed re-check for a run that outlived its worker slot.
 *
 * The job id is derived from the analysis id and the re-check count so that
 * every re-check is a distinct job: BullMQ dedupes on `jobId`, and reusing the
 * analysis id would make the second re-check silently replace the first.
 *
 * The re-check is a *new* job rather than a retry of the original. The original
 * job is finished from BullMQ's point of view -- its handler returned, so its
 * lock is released and the slot is free -- while the run it started is still in
 * flight. The re-check's only job is to look at the row and decide what, if
 * anything, remains.
 */
export const scheduleRecheck = async (job: AnalysisJob, recheckCount: number) => {
	const queue = await getProducerQueue();

	await queue.add(
		ANALYSIS_QUEUE,
		{ ...job, recheckCount },
		{
			...jobOptions(),
			jobId: `${job.analysisId}:recheck:${recheckCount}`,
			delay: workerRecheckDelayMs(),
		},
	);
};
