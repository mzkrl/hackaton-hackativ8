import { desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { sequences } from "../db/schema";
import { requirePrincipal } from "../lib/current-user";
import { assertProjectOwner } from "../lib/ownership";

const sequenceParams = t.Object({ id: t.String({ format: "uuid" }) });

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
	);
