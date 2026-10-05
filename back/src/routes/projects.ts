import { and, desc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { projects } from "../db/schema";
import { ApiError } from "../lib/api-error";
import { requirePrincipal } from "../lib/current-user";

const projectParams = t.Object({ id: t.String({ format: "uuid" }) });

const projectBody = t.Object({
	name: t.String({ minLength: 1, maxLength: 120 }),
}, { additionalProperties: false });

export const projectsRoutes = new Elysia()
	.post(
		"/projects",
		async ({ request, body, status }) => {
			const principal = await requirePrincipal(request);
			const name = body.name.trim();

			if (name.length === 0) {
				throw new ApiError(
					422,
					"VALIDATION_ERROR",
					"Project name cannot be blank.",
				);
			}

			const values =
				principal.kind === "guest"
					? { guestId: principal.id, name }
					: { userId: principal.id, name };

			const [project] = await getDb()
				.insert(projects)
				.values(values)
				.returning();

			return status(201, { data: project });
		},
		{ body: projectBody },
	)
	.get("/projects", async ({ request }) => {
		const principal = await requirePrincipal(request);
		const ownerColumn =
			principal.kind === "guest" ? projects.guestId : projects.userId;

		const data = await getDb()
			.select()
			.from(projects)
			.where(eq(ownerColumn, principal.id))
			.orderBy(desc(projects.createdAt));

		return { data };
	})
	.get(
		"/projects/:id",
		async ({ request, params }) => {
			const principal = await requirePrincipal(request);
			const ownerColumn =
				principal.kind === "guest" ? projects.guestId : projects.userId;

			const [project] = await getDb()
				.select()
				.from(projects)
				.where(
					and(eq(projects.id, params.id), eq(ownerColumn, principal.id)),
				)
				.limit(1);

			if (!project) {
				throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found.");
			}

			return { data: project };
		},
		{ params: projectParams },
	);
