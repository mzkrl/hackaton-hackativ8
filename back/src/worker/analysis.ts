import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import { Worker } from "bullmq";

import { runAnalysis } from "../lib/analysis-executor";
import { getDb } from "../db/client";
import { analyses } from "../db/schema";
import {
	ANALYSIS_QUEUE,
	type AnalysisJob,
	enqueueAnalysis,
	scheduleRecheck,
	workerConnection,
	workerConcurrency,
	workerJobTimeoutMs,
	workerMaxRechecks,
} from "../lib/queue";
import { isTimeout, withTimeout } from "../lib/timeout";

const markProcessing = (analysisId: string) =>
	getDb()
		.update(analyses)
		.set({ status: "processing", errorMessage: null, updatedAt: new Date() })
		.where(eq(analyses.id, analysisId));

const markCompleted = (analysisId: string, result: Record<string, unknown>) =>
	getDb()
		.update(analyses)
		.set({ status: "completed", resultJson: result, errorMessage: null, updatedAt: new Date() })
		.where(eq(analyses.id, analysisId));

const markFailed = (analysisId: string, message: string) =>
	getDb()
		.update(analyses)
		.set({ status: "failed", errorMessage: message.slice(0, 2000), updatedAt: new Date() })
		.where(eq(analyses.id, analysisId));

const enqueueSecret = process.env.QUEUE_SECRET?.trim();
const enqueuePort = process.env.ENQUEUE_PORT?.trim()
	? Number(process.env.ENQUEUE_PORT.trim())
	: null;

if (enqueuePort && !enqueueSecret) {
	throw new Error(
		"QUEUE_SECRET is required when ENQUEUE_PORT is set, so the enqueue endpoint can authenticate callers.",
	);
}

const worker = new Worker<AnalysisJob>(
	ANALYSIS_QUEUE,
	async (job) => {
		const { analysisId, recheckCount = 0 } = job.data;

		// A re-check does not run the analysis. It looks at the row and decides
		// what, if anything, is left to do.
		if (recheckCount > 0) {
			const analysis = await getDb()
				.select()
				.from(analyses)
				.where(eq(analyses.id, analysisId))
				.limit(1);

			if (analysis.length === 0) {
				// The analysis was deleted while a re-check was scheduled. Nothing
				// left to look at, so leave the queue quietly instead of failing a
				// job for a row the user already removed.
				return;
			}

			const status = analysis[0].status;

			if (status === "completed" || status === "failed") {
				return;
			}

			if (status === "processing") {
				if (recheckCount < workerMaxRechecks()) {
					await scheduleRecheck(job.data, recheckCount + 1);
				} else {
					await markFailed(analysisId, "Analysis timed out after maximum re-checks.");
				}
				return;
			}

			// Status is "pending": the run never started. Fall through and run it.
		}

		await markProcessing(analysisId);

		try {
			const result = await withTimeout(runAnalysis(job.data), workerJobTimeoutMs());
			await markCompleted(analysisId, result);
			return result;
		} catch (error) {
			if (isTimeout(error)) {
				// The run may still land. Release the slot and let a delayed job
				// pick up the result.
				await scheduleRecheck(job.data, 1);
				return;
			}

			const message =
				error instanceof Error ? error.message : "Analysis failed for an unknown reason.";
			await markFailed(analysisId, message);
			throw error;
		}
	},
	{ connection: workerConnection(), concurrency: workerConcurrency() },
);

worker.on("completed", (job) => {
	console.log(`[analysis-worker] completed ${job.id} (attempt ${job.attemptsMade})`);
});

worker.on("failed", (job, error) => {
	console.error(
		`[analysis-worker] failed ${job?.id ?? "unknown"} (attempt ${job?.attemptsMade ?? 0}): ${error.message}`,
	);
});

worker.on("error", (error) => {
	console.error(`[analysis-worker] error: ${error.message}`);
});

if (enqueuePort && enqueueSecret) {
	const expectedSecret = Buffer.from(enqueueSecret);
	const secretMatches = (provided: string | null) => {
		if (!provided) return false;
		const received = Buffer.from(provided);
		return (
			received.length === expectedSecret.length &&
			timingSafeEqual(received, expectedSecret)
		);
	};

	Bun.serve({
		port: enqueuePort,
		fetch: async (request) => {
			if (new URL(request.url).pathname !== "/enqueue") {
				return new Response("Not found", { status: 404 });
			}

			if (request.method !== "POST") {
				return new Response("Method not allowed", { status: 405 });
			}

			if (!secretMatches(request.headers.get("x-queue-secret"))) {
				return new Response("Unauthorized", { status: 401 });
			}

			let job: AnalysisJob;
			try {
				job = (await request.json()) as AnalysisJob;
			} catch {
				return new Response("Invalid JSON body", { status: 400 });
			}

			if (!job?.analysisId || !job?.sequenceId || !job?.analysisType) {
				return new Response("Invalid job payload", { status: 422 });
			}

			try {
				const jobId = await enqueueAnalysis(job);
				return Response.json({ jobId });
			} catch (error) {
				console.error("[analysis-worker] enqueue request failed:", error);
				return Response.json(
					{ error: { code: "QUEUE_UNAVAILABLE", message: "Could not enqueue job." } },
					{ status: 503 },
				);
			}
		},
	});

	console.log(`[analysis-worker] enqueue endpoint listening on :${enqueuePort}`);
}

console.log(
	`[analysis-worker] consuming ${ANALYSIS_QUEUE} with concurrency ${workerConcurrency()}`,
);

const shutdown = async (signal: string) => {
	console.log(`[analysis-worker] ${signal} received, closing`);
	await worker.close();
	process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
