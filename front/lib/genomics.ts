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
  /**
   * Exactly one of these identifies the owner, so for a guest project `userId`
   * is null and `guestId` is set. Typed honestly rather than as `userId: string`
   * because that version compiles fine and then hands a null into any code that
   * reads it — the failure would surface at runtime, in a guest's session, as
   * an unrelated-looking crash.
   */
  userId: string | null;
  guestId: string | null;
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

/**
 * Who the API says is calling.
 *
 * A guest is a real principal with its own data, not a degraded user. The `kind`
 * is what the workspace uses to decide what to render and what to offer — a
 * guest gets a "sign up to save" banner, a user does not.
 */
export type Principal =
	| { kind: "user"; user: User }
	| GuestSession;

/** What `POST /auth/guest` issues and what `/auth/me` reports for a guest. */
export type GuestSession = {
	kind: "guest";
	id: string;
	expiresAt: string;
};

export const getMe = () => apiFetch<Principal>("/auth/me");

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

/**
 * Starts a guest session.
 *
 * The token is returned in the body because the cookie is HttpOnly and cannot be
 * read from JavaScript. The frontend stores it so that, if the visitor later
 * signs up, the guest's data can be claimed by the new account.
 */
export const startGuest = () =>
	apiFetch<GuestSession>("/auth/guest", {
		method: "POST",
	});

/**
 * Moves a guest's projects, sequences, analyses, conversations and reports into a
 * real account, then deletes the guest session.
 *
 * Idempotent: a second call is a no-op, so a retry after a partial failure is safe.
 */
export const claimGuest = (guestId: string) =>
	apiFetch<{ claimed: boolean }>("/guest/claim", {
		method: "POST",
		body: JSON.stringify({ guestId }),
	});

/* ------------------------------------------------------- guest token --- */

const GUEST_TOKEN_KEY = "gia.guest-token";

export const storeGuestToken = (token: string) => {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(GUEST_TOKEN_KEY, token);
};

export const readGuestToken = (): string | null => {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem(GUEST_TOKEN_KEY);
};

export const clearGuestToken = () => {
	if (typeof window === "undefined") return;
	window.localStorage.removeItem(GUEST_TOKEN_KEY);
};

/* ------------------------------------------------------------ projects --- */

export const listProjects = () => apiFetch<Project[]>("/projects");

export const createProject = (name: string) =>
	apiFetch<Project>("/projects", { method: "POST", body: JSON.stringify({ name }) });

/* ----------------------------------------------------------- sequences --- */

export const listSequences = (projectId: string) =>
	apiFetch<Sequence[]>(`/projects/${projectId}/sequences`);

/** Removes a sequence and its stored object (if any), cascading its analyses. */
export const deleteSequence = (projectId: string, sequenceId: string) =>
	apiFetch<{ id: string; deleted: boolean }>(
		`/projects/${projectId}/sequences/${sequenceId}`,
		{ method: "DELETE" },
	);

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

export const deleteAnalysis = (id: string) =>
	apiFetch<{ id: string; deleted: boolean }>(`/analyses/${id}`, {
		method: "DELETE",
	});

/* -------------------------------------------------------- conversations --- */

export const listConversations = (projectId: string) =>
	apiFetch<Conversation[]>(`/conversations/${projectId}`);

export const appendConversation = (body: {
	projectId: string;
	role: string;
	content: string;
}) =>
	apiFetch<Conversation>("/conversations", { method: "POST", body: JSON.stringify(body) });
