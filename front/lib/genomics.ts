/**
 * Domain types and endpoint wrappers for the backend.
 *
 * Every field here mirrors `back/src/db/schema.ts` or the response shape built
 * in the matching file under `back/src/routes/`. The backend returns row
 * objects directly, so these are flat and carry the same names — no mapping
 * layer, because a mapping layer is one more place for the two sides to drift.
 */

import { apiFetch } from "./api";

export type User = {
	id: string;
	email: string;
	name: string;
	createdAt: string;
};

export type Project = {
	id: string;
	userId: string;
	name: string;
	createdAt: string;
	updatedAt: string;
};

export type Sequence = {
	id: string;
	projectId: string;
	recordId: string | null;
	description: string | null;
	format: string;
	sequenceLength: number | null;
	sequenceHash: string | null;
	objectKey: string | null;
	originalFilename: string | null;
	createdAt: string;
};

export type AnalysisStatus = "queued" | "processing" | "completed" | "failed";

export type Analysis = {
	id: string;
	sequenceId: string;
	analysisType: string;
	status: AnalysisStatus;
	queueJobId: string | null;
	resultJson: Record<string, unknown> | null;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
};

/** What `GET /analyses/:id/status` returns — a deliberate subset, not the full row. */
export type AnalysisProgress = Pick<
	Analysis,
	"id" | "status" | "queueJobId" | "errorMessage" | "updatedAt"
>;

export type Conversation = {
	id: string;
	projectId: string;
	role: string;
	content: string;
	createdAt: string;
};

export type PresignedUpload = {
	sequenceId: string;
	objectKey: string;
	method: "PUT";
	uploadUrl: string;
	expiresIn: number;
};

export type ProxiedUpload = {
	sequenceId: string;
	objectKey: string;
	method: "PUT";
	sizeBytes: number;
};

export type ObjectDownload = {
	objectKey: string;
	downloadUrl: string;
	expiresIn: number;
	sequence: Sequence | null;
};

/* ---------------------------------------------------------------- auth --- */

export const getMe = () => apiFetch<{ user: User }>("/auth/me").then((d) => d.user);

export const register = (body: { name: string; email: string; password: string }) =>
	apiFetch<{ user: User }>("/auth/register", { method: "POST", body: JSON.stringify(body) }).then(
		(d) => d.user,
	);

export const login = (body: { email: string; password: string }) =>
	apiFetch<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify(body) }).then(
		(d) => d.user,
	);

export const logout = () =>
	apiFetch<{ success: boolean }>("/auth/logout", { method: "POST" }).then(() => undefined);

/* ------------------------------------------------------------ projects --- */

export const listProjects = () => apiFetch<Project[]>("/projects");

export const createProject = (name: string) =>
	apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) });

/* ----------------------------------------------------------- sequences --- */

export const listSequences = (projectId: string) =>
	apiFetch<Sequence[]>(`/projects/${projectId}/sequences`);

/**
 * Registers a sequence that has no file behind it — a pasted string.
 *
 * `objectKey`, `projectId` and `userId` are `t.Optional(t.Never())` on the
 * backend, so sending them is a 422 rather than a silent strip. Only the
 * fields below are accepted.
 */
export const createPastedSequence = (
	projectId: string,
	body: {
		recordId?: string;
		description?: string | null;
		format: string;
		sequenceLength: number;
		sequenceHash: string;
	},
) =>
	apiFetch<Sequence>(`/projects/${projectId}/sequences`, {
		method: "POST",
		body: JSON.stringify(body),
	});

/**
 * Canonical upload path: ask the backend to register the row and mint a
 * presigned PUT, then send the bytes straight to object storage.
 *
 * The backend already recorded `object_key` before this returns, so the row
 * exists even if the PUT below never happens.
 */
export const presignUpload = (body: {
	projectId: string;
	filename: string;
	contentType?: string;
	sizeBytes?: number;
	description?: string | null;
}) =>
	apiFetch<PresignedUpload>("/storage/presign", {
		method: "POST",
		body: JSON.stringify(body),
	});

/** Proxy path for small files: multipart goes through the backend, capped at 5 MiB. */
export const proxyUpload = (form: FormData) =>
	apiFetch<ProxiedUpload>("/storage/upload", { method: "POST", body: form });

/**
 * Object keys contain slashes, so they are appended to the path rather than
 * encoded — the backend matches the raw `*` segment against its own key.
 */
export const getObjectDownload = (objectKey: string) =>
	apiFetch<ObjectDownload>(`/storage/${objectKey}`);

export const deleteObject = (objectKey: string) =>
	apiFetch<{ objectKey: string; deleted: boolean }>(`/storage/${objectKey}`, {
		method: "DELETE",
	});

/* ----------------------------------------------------------- analyses --- */

/** Returns 202 with a `queued` row. Execution happens in the worker, never here. */
export const queueAnalysis = (body: { sequenceId: string; analysisType: string }) =>
	apiFetch<Analysis>("/analyses", { method: "POST", body: JSON.stringify(body) });

export const getAnalysis = (id: string) => apiFetch<Analysis>(`/analyses/${id}`);

export const getAnalysisStatus = (id: string) =>
	apiFetch<AnalysisProgress>(`/analyses/${id}/status`);

/* -------------------------------------------------------- conversations --- */

export const listConversations = (projectId: string) =>
	apiFetch<Conversation[]>(`/conversations/${projectId}`);

export const appendConversation = (body: {
	projectId: string;
	role: string;
	content: string;
}) =>
	apiFetch<Conversation>("/conversations", { method: "POST", body: JSON.stringify(body) });
