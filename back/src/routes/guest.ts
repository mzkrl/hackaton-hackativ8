import { Elysia, t } from "elysia";

import { getDb, getSql } from "../db/client";
import { guestSessions } from "../db/schema";

import { ApiError } from "../lib/api-error";
import { isGuestToken, requireUserId } from "../lib/current-user";

const MAX_PROJECTS = 50;
const MAX_SEQUENCES_PER_PROJECT = 200;
const MAX_ANALYSES_PER_SEQUENCE = 100;
const MAX_CONVERSATIONS_PER_PROJECT = 500;
const MAX_RESULT_BYTES = 64 * 1024;

const optionalUuid = t.Optional(t.String({ format: "uuid" }));
const optionalText = (max: number) => t.Optional(t.String({ maxLength: max }));
const optionalTimestamp = t.Optional(t.String({ format: "date-time" }));

/**
 * Guest records are keyed by the ids the browser already assigned in IndexedDB.
 *
 * Reusing them makes the import idempotent: a retry after a partial failure
 * re-sends the same ids, `on conflict do nothing` skips what already landed, and
 * the client converges without creating duplicates.
 */
const guestAnalysis = t.Object(
	{
		id: optionalUuid,
		sequenceId: t.String({ format: "uuid" }),
		analysisType: t.String({ minLength: 1, maxLength: 64 }),
		status: t.Optional(
			t.Union([t.Literal("completed"), t.Literal("failed")]),
		),
		resultJson: t.Optional(t.Record(t.String(), t.Unknown())),
		errorMessage: optionalText(2000),
		createdAt: optionalTimestamp,

		// Owned by the API and the worker; a guest has no queue and no account.
		queueJobId: t.Optional(t.Never()),
		updatedAt: t.Optional(t.Never()),
	},
	{ additionalProperties: false },
);

const guestSequence = t.Object(
	{
		id: optionalUuid,
		recordId: optionalText(500),
		description: optionalText(2000),
		format: t.String({ minLength: 1, maxLength: 16 }),
		sequenceLength: t.Optional(t.Integer({ min: 0 })),
		sequenceHash: optionalText(128),
		originalFilename: optionalText(255),
		analyses: t.Optional(
			t.Array(guestAnalysis, { maxItems: MAX_ANALYSES_PER_SEQUENCE }),
		),
		createdAt: optionalTimestamp,

		// The guest browser has no object storage, so it can never own an object.
		objectKey: t.Optional(t.Never()),
		projectId: t.Optional(t.Never()),
	},
	{ additionalProperties: false },
);

const guestProject = t.Object(
	{
		id: optionalUuid,
		name: t.String({ minLength: 1, maxLength: 120 }),
		sequences: t.Optional(
			t.Array(guestSequence, { maxItems: MAX_SEQUENCES_PER_PROJECT }),
		),
		conversations: t.Optional(
			t.Array(
				t.Object(
					{
						id: optionalUuid,
						role: t.String({ minLength: 1, maxLength: 32 }),
						content: t.String({ minLength: 1, maxLength: 20_000 }),
						createdAt: optionalTimestamp,
					},
					{ additionalProperties: false },
				),
				{ maxItems: MAX_CONVERSATIONS_PER_PROJECT },
			),
		),
		createdAt: optionalTimestamp,
		userId: t.Optional(t.Never()),
	},
	{ additionalProperties: false },
);

const importBody = t.Object(
	{
		projects: t.Array(guestProject, { minItems: 1, maxItems: MAX_PROJECTS }),
	},
	{ additionalProperties: false },
);

type GuestAnalysis = {
	id?: string;
	sequenceId: string;
	analysisType: string;
	status?: "completed" | "failed";
	resultJson?: Record<string, unknown>;
	errorMessage?: string;
	createdAt?: string;
};

type GuestSequence = {
	id?: string;
	recordId?: string;
	description?: string;
	format: string;
	sequenceLength?: number;
	sequenceHash?: string;
	originalFilename?: string;
	analyses?: GuestAnalysis[];
	createdAt?: string;
};

type GuestProject = {
	id?: string;
	name: string;
	sequences?: GuestSequence[];
	conversations?: { id?: string; role: string; content: string; createdAt?: string }[];
	createdAt?: string;
};

// postgres.js serialises untyped parameters as text, so timestamps go over the
// wire as ISO strings and are cast explicitly rather than passed as Date objects.
const asTimestamp = (value: string | undefined) =>
	value ? new Date(value).toISOString() : new Date().toISOString();

/**
 * Guest analyses were already computed in the browser, so `completed` is the
 * honest default. A record that claims work still in flight lands as `failed`
 * rather than pretending a server-side job exists for it.
 */
const importedStatus = (analysis: GuestAnalysis, hasResult: boolean) => {
	if (analysis.status === "failed") {
		return "failed" as const;
	}
	if (analysis.status === "completed") {
		return "completed" as const;
	}
	return hasResult ? ("completed" as const) : ("failed" as const);
};

type ImportedCounts = {
	sequences: number;
	analyses: number;
	conversations: number;
};

const importProject = async (
	project: GuestProject,
	userId: string,
): Promise<{ projectId: string; counts: ImportedCounts }> => {
	const projectId = project.id ?? crypto.randomUUID();
	let analysisCount = 0;

	// One interactive transaction per project: either the whole tree lands or
	// none of it does, so a failure can never leave a project half-imported.
	await getSql().begin(async (tx) => {
		await tx`
			insert into projects (id, user_id, name, created_at)
			values (${projectId}, ${userId}, ${project.name.trim()}, ${asTimestamp(project.createdAt)}::timestamptz)
			on conflict do nothing
		`;

		for (const sequence of project.sequences ?? []) {
			const sequenceId = sequence.id ?? crypto.randomUUID();

			await tx`
				insert into sequences (id, project_id, record_id, description, format, sequence_length, sequence_hash, original_filename, created_at)
				values (${sequenceId}, ${projectId}, ${sequence.recordId ?? null}, ${sequence.description ?? null}, ${sequence.format}, ${sequence.sequenceLength ?? null}, ${sequence.sequenceHash ?? null}, ${sequence.originalFilename ?? null}, ${asTimestamp(sequence.createdAt)}::timestamptz)
				on conflict do nothing
			`;

			for (const analysis of sequence.analyses ?? []) {
				const resultJson = analysis.resultJson ?? null;
				const serialized = resultJson ? JSON.stringify(resultJson) : "";

				if (serialized.length > MAX_RESULT_BYTES) {
					throw new ApiError(
						413,
						"RESULT_TOO_LARGE",
						`Analysis result exceeds ${MAX_RESULT_BYTES} bytes.`,
						{ analysisId: analysis.id ?? null },
					);
				}

				await tx`
					insert into analyses (id, sequence_id, analysis_type, status, queue_job_id, result_json, error_message, created_at)
					values (
						${analysis.id ?? crypto.randomUUID()},
						${analysis.sequenceId},
						${analysis.analysisType},
						${importedStatus(analysis, serialized.length > 0)},
						null,
						${serialized.length > 0 ? serialized : null}::jsonb,
						${analysis.errorMessage ?? null},
						${asTimestamp(analysis.createdAt)}::timestamptz
					)
					on conflict do nothing
				`;

				analysisCount += 1;
			}
		}

		for (const conversation of project.conversations ?? []) {
			await tx`
				insert into conversations (id, project_id, role, content, created_at)
				values (${conversation.id ?? crypto.randomUUID()}, ${projectId}, ${conversation.role}, ${conversation.content}, ${asTimestamp(conversation.createdAt)}::timestamptz)
				on conflict do nothing
			`;
		}
	});

	return {
		projectId,
		counts: {
			sequences: project.sequences?.length ?? 0,
			analyses: analysisCount,
			conversations: project.conversations?.length ?? 0,
		},
	};
};

export const guestRoutes = new Elysia()
	.post(
		"/guest/claim",
		async ({ request, body, status }) => {
			const userId = await requireUserId(request);
			const guestId = body.guestId.trim();

			// The whole shape, not just the prefix: this string is the only thing
			// that grants ownership of the rows below, so a caller must not be able
			// to name a session with a malformed token and get a silent no-op that
			// looks like a successful claim.
			if (!isGuestToken(guestId)) {
				throw new ApiError(422, "VALIDATION_ERROR", "Invalid guest session token.");
			}

			// Idempotent: the UPDATE matches nothing on a second call (projects
			// already moved), and the DELETE matches nothing (session already gone).
			// The end state is identical either way, so a retry is safe.
			await getSql().begin(async (tx) => {
				await tx`
					UPDATE projects
					SET user_id = ${userId}, guest_id = NULL, updated_at = NOW()
					WHERE guest_id = ${guestId}
				`;
				await tx`DELETE FROM guest_sessions WHERE id = ${guestId}`;
			});

			return status(200, { data: { claimed: true } });
		},
		{
			body: t.Object(
				{ guestId: t.String({ minLength: 1, maxLength: 128 }) },
				{ additionalProperties: false },
			),
		},
	)
	.post(
		"/guest/import",
	async ({ body, request, status }) => {
		const userId = await requireUserId(request);

		const imported = [];
		for (const [index, project] of body.projects.entries()) {
			try {
				imported.push(await importProject(project, userId));
			} catch (error) {
				if (error instanceof ApiError) {
					throw error;
				}

				console.error(`[guest] import failed at project ${index}:`, error);
				throw new ApiError(
					500,
					"GUEST_IMPORT_FAILED",
					"Guest import failed. Retry to finish; imported projects are kept.",
					{ importedProjects: imported.length, failedProjectIndex: index },
				);
			}
		}

		return status(201, { data: { projects: imported } });
	},
	{ body: importBody },
);
