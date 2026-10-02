import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { analyses } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { assertAllowedAnalysisType } from "../lib/analysis-types";
import { requireUserId } from "../lib/current-user";
import { findOwnedAnalysis, findOwnedSequence } from "../lib/ownership";
import { assertQueueConfigured, enqueueAnalysis, queueStatus } from "../lib/queue";
import { enforce, RATE_LIMITS } from "../lib/rate-limit";

const analysisParams = t.Object({ id: t.String({ format: "uuid" }) });

const analysisBody = t.Object({
	sequenceId: t.String({ format: "uuid" }),
	analysisType: t.String({ minLength: 1, maxLength: 64 }),

	// Lifecycle fields are owned by the API and the worker.
	status: t.Optional(t.Never()),
	queueJobId: t.Optional(t.Never()),
	resultJson: t.Optional(t.Never()),
	errorMessage: t.Optional(t.Never()),
	userId: t.Optional(t.Never()),
}, { additionalProperties: false });

const failureMessage = (error: unknown) => {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error) return error.message;
	return "Unknown error";
};

export const analysesRoutes = new Elysia()
	.post(
		"/analyses",
		async ({ request, body, status }) => {
			const userId = await requireUserId(request);
			const sequence = await findOwnedSequence(body.sequenceId, userId);

			// Keyed on the session-derived user id, not on anything the caller
			// supplied. Each queued job is a row plus a Redis entry and eventually a
			// Bio Service call, so an unbounded submit loop is what this stops.
			await enforce(RATE_LIMITS.analysisQueue(), userId);

			// Checked before the row is written, so an unknown type never becomes
			// a durable record or reaches the worker.
			const analysisType = assertAllowedAnalysisType(body.analysisType);

			assertQueueConfigured();

			const [created] = await getDb()
				.insert(analyses)
				.values({
					sequenceId: sequence.id,
					analysisType,
					status: "queued",
				})
				.returning();

			try {
				const queueJobId = await enqueueAnalysis({
					analysisId: created.id,
					sequenceId: sequence.id,
					projectId: sequence.projectId,
					analysisType,
				});

				const [queued] = await getDb()
					.update(analyses)
					.set({ queueJobId, updatedAt: new Date() })
					.where(eq(analyses.id, created.id))
					.returning();

				return status(202, { data: queued });
			} catch (error) {
				console.error(`[analyses] enqueue failed for ${created.id}:`, error);

				await getDb()
					.update(analyses)
					.set({
						status: "failed",
						errorMessage: failureMessage(error).slice(0, 2000),
						updatedAt: new Date(),
					})
					.where(eq(analyses.id, created.id));

				throw new ApiError(
					503,
					"QUEUE_UNAVAILABLE",
					"The analysis could not be queued. Please retry later.",
					{ analysisId: created.id, status: "failed" },
				);
			}
		},
		{ body: analysisBody },
	)
	.get(
		"/analyses/:id",
		async ({ request, params }) => {
			const userId = await requireUserId(request);
			const analysis = await findOwnedAnalysis(params.id, userId);
			return { data: analysis };
		},
		{ params: analysisParams },
	)
	.get("/queue/status", async ({ set }) => {
			// Public by design: a monitor needs queue depth before anyone signs in,
			// and the counts expose no user data. Observability only — never a gate.
			const status = await queueStatus();

			// Configured but not answering is a genuine fault, unlike "not
			// configured", which is a valid state for an API-only deployment.
			if (!status.reachable && status.configured) {
				set.status = 503;
			}

			return { data: status };
		})
	.get(
		"/analyses/:id/status",
		async ({ request, params }) => {
			const userId = await requireUserId(request);
			const analysis = await findOwnedAnalysis(params.id, userId);

			return {
				data: {
					id: analysis.id,
					status: analysis.status,
					queueJobId: analysis.queueJobId,
					errorMessage: analysis.errorMessage,
					updatedAt: analysis.updatedAt,
				},
			};
		},
		{ params: analysisParams },
	);
