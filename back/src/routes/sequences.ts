import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { analyses, sequences } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { invalidateCachedStatuses } from "../lib/analysis-status-cache";
import { requirePrincipal } from "../lib/current-user";
import { assertProjectOwner, findOwnedSequence } from "../lib/ownership";
import { discardAnalysisJob } from "../lib/queue";
import { assertCanCreateSequence } from "../lib/quota";
import { deleteObject } from "../lib/storage";

const sequenceParams = t.Object({ id: t.String({ format: "uuid" }) });

const sequenceDeleteParams = t.Object({
	id: t.String({ format: "uuid" }),
	sequenceId: t.String({ format: "uuid" }),
});

const sequenceBody = t.Object({
	recordId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
	description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
	format: t.String({ minLength: 1, maxLength: 32 }),
	sequenceLength: t.Integer({ minimum: 1 }),
	sequenceHash: t.String({ minLength: 1, maxLength: 128 }),

	// Server-controlled. Declared so a client that sends them is rejected with
	// 422 instead of having the value silently stripped.
	objectKey: t.Optional(t.Never()),
	projectId: t.Optional(t.Never()),
	userId: t.Optional(t.Never()),
}, { additionalProperties: false });

export const sequencesRoutes = new Elysia()
	.post(
		"/projects/:id/sequences",
		async ({ request, params, body, status }) => {
			const principal = await requirePrincipal(request);
			await assertProjectOwner(params.id, principal);
			await assertCanCreateSequence(params.id, principal);

			const [sequence] = await getDb()
				.insert(sequences)
				.values({
					projectId: params.id,
					recordId: body.recordId ?? null,
					description: body.description ?? null,
					format: body.format,
					sequenceLength: body.sequenceLength,
					sequenceHash: body.sequenceHash,
				})
				.returning();

			return status(201, { data: sequence });
		},
		{ params: sequenceParams, body: sequenceBody },
	)
	.get(
		"/projects/:id/sequences",
		async ({ request, params }) => {
			const principal = await requirePrincipal(request);
			await assertProjectOwner(params.id, principal);

			const data = await getDb()
				.select()
				.from(sequences)
				.where(eq(sequences.projectId, params.id))
				.orderBy(desc(sequences.createdAt));

			return { data };
		},
		{ params: sequenceParams },
	)
	.delete(
		"/projects/:id/sequences/:sequenceId",
		async ({ request, params }) => {
			const principal = await requirePrincipal(request);
			await assertProjectOwner(params.id, principal);

			const sequence = await findOwnedSequence(params.sequenceId, principal);
			if (sequence.projectId !== params.id) {
				throw new ApiError(404, "SEQUENCE_NOT_FOUND", "Sequence not found.");
			}

			// The analyses rows go with the sequence via the FK cascade, but their
			// Redis jobs do not. Drop the jobs (and any cached status) first so
			// nothing runs or reports against a row that is about to disappear.
			const dependent = await getDb()
				.select({ id: analyses.id })
				.from(analyses)
				.where(eq(analyses.sequenceId, sequence.id));

			const analysisIds = dependent.map((row) => row.id);
			await Promise.all(analysisIds.map((id) => discardAnalysisJob(id)));
			await invalidateCachedStatuses(principal.id, analysisIds);

			if (sequence.objectKey) {
				// Best-effort: a missing object must not block removing the row.
				await deleteObject(sequence.objectKey).catch((error) => {
					console.warn(
						`[sequences] could not delete object ${sequence.objectKey}:`,
						error,
					);
				});
			}

			await getDb().delete(sequences).where(eq(sequences.id, sequence.id));

			return { data: { id: sequence.id, deleted: true } };
		},
		{ params: sequenceDeleteParams },
	);
