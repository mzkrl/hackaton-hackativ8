import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { analyses } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { assertAllowedAnalysisType } from "../lib/analysis-types";
import { requirePrincipal } from "../lib/current-user";
import { findOwnedAnalysis, findOwnedSequence } from "../lib/ownership";
import { assertQueueConfigured, enqueueAnalysis, queueStatus } from "../lib/queue";
import { enforce, RATE_LIMITS } from "../lib/rate-limit";
import { readCachedStatus, writeCachedStatus } from "../lib/analysis-status-cache";

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
			const principal = await requirePrincipal(request);
			const sequence = await findOwnedSequence(body.sequenceId, principal);

			// Keyed on the session-derived principal id, not on anything the caller
			// supplied. Each queued job is a row plus a Redis entry and eventually a
			// Bio Service call, so an unbounded submit loop is what this stops.
			await enforce(RATE_LIMITS.analysisQueue(), principal.id);

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
			const principal = await requirePrincipal(request);
			const analysis = await findOwnedAnalysis(params.id, principal);
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
			const principal = await requirePrincipal(request);

			// Charged per authenticated principal rather than per analysis id, so one
			// runaway poller cannot exhaust a shared bucket for everyone else, and a
			// user watching several runs gets one budget rather than one each.
			await enforce(RATE_LIMITS.analysisStatusPoll(), principal.id);

			// The cache key is scoped to `principal.id`, so a hit is only ever returned
			// to the principal that wrote it. Ownership is not re-checked on a hit
			// because the session that owns the key is the authorisation.
			const cached = await readCachedStatus(principal.id, params.id);
			if (cached) return { data: cached };

			const analysis = await findOwnedAnalysis(params.id, principal);

			const view = {
				id: analysis.id,
				status: analysis.status,
				queueJobId: analysis.queueJobId,
				errorMessage: analysis.errorMessage,
				updatedAt: analysis.updatedAt,
			};

			await writeCachedStatus(principal.id, view);

			return { data: view };
		},
		{ params: analysisParams },
	);
