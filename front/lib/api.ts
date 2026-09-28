/**
 * Single place that resolves the backend API base URL.
 *
 * The frontend only ever talks to this API. It never reaches PostgreSQL, Redis
 * or MinIO; those stay on the VPS behind the tunnel and are reachable only by
 * the backend, which keeps the storage credentials out of the browser.
 */

const configured = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();

/** Base URL of the backend API, with no trailing slash. */
export const API_URL = configured.replace(/\/+$/, "");

/**
 * True when the API is not configured. Callers should surface this rather than
 * silently issuing requests to a relative path that will hit the Next.js
 * origin and return HTML instead of JSON.
 */
export const isApiConfigured = API_URL.length > 0;

export type ApiErrorBody = {
	error?: { code?: string; message?: string; details?: unknown };
};

/** The backend wraps every success as `{ data: ... }` and every failure as `{ error: ... }`. */
type ApiEnvelope<T> = { data: T } & ApiErrorBody;

/**
 * An error the backend reported, or a failure to reach it at all.
 *
 * The message alone is not enough for the UI to react: `auth` routes need to
 * tell "your session expired" (401) apart from "the queue is down" (503), and
 * the status is the only thing that distinguishes them. The code is also
 * forwarded so callers can branch on a stable identifier instead of on prose.
 */
export class ApiRequestError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: unknown;

	constructor(status: number, code: string, message: string, details?: unknown) {
		super(message);
		this.name = "ApiRequestError";
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

/** True when the request failed because the session cookie was missing or rejected. */
export const isUnauthorized = (error: unknown): boolean =>
	error instanceof ApiRequestError && error.status === 401;

/**
 * True when the analysis queue is not usable.
 *
 * The API exposes no queue status endpoint, so the only signal available is the
 * 503 that `POST /analyses` returns — either because Redis is not configured at
 * all, or because it could not be reached. Both are worth reporting once rather
 * than on every submit.
 */
export const isQueueUnavailable = (error: unknown): boolean =>
	error instanceof ApiRequestError &&
	(error.code === "QUEUE_NOT_CONFIGURED" || error.code === "QUEUE_UNAVAILABLE");

/** Human-readable text for anything thrown by `apiFetch`, safe to render. */
export const describeError = (error: unknown): string => {
	if (error instanceof ApiRequestError) return error.message;
	if (error instanceof Error) return error.message;
	return "Something went wrong.";
};

/**
 * Calls the backend API with the session cookie attached.
 *
 * `credentials: "include"` is required: the session lives in an HttpOnly cookie
 * that JavaScript cannot read, so the browser has to be told to send it. The
 * backend answers with `Access-Control-Allow-Origin` for this exact origin.
 */
export const apiFetch = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
	if (!isApiConfigured) {
		throw new ApiRequestError(
			0,
			"API_NOT_CONFIGURED",
			"NEXT_PUBLIC_API_URL is not set. Copy .env.example to .env.local and point it at the API.",
		);
	}

	const headers = new Headers(init.headers);

	// Never hand-set Content-Type for FormData; the browser has to add the
	// multipart boundary itself or the backend cannot parse the upload.
	if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}

	let response: Response;
	try {
		response = await fetch(`${API_URL}${path}`, {
			...init,
			headers,
			credentials: "include",
		});
	} catch (cause) {
		// A rejected fetch is ambiguous by nature: the API may be down, or the
		// browser may have blocked the response because the backend's
		// CORS_ORIGINS does not list this origin. Both look identical here, so
		// say so instead of guessing wrong in the UI. `location` is only read in
		// the browser; this module is imported by client components, but nothing
		// stops a server component from reaching for it.
		const origin = typeof location === "undefined" ? "this origin" : location.origin;

		throw new ApiRequestError(
			0,
			"API_UNREACHABLE",
			`Could not reach the API at ${API_URL}. Check that it is running, and that its CORS_ORIGINS lists this origin (${origin}).`,
			{ cause: String(cause) },
		);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;

	if (!response.ok) {
		throw new ApiRequestError(
			response.status,
			body.error?.code ?? "REQUEST_FAILED",
			body.error?.message ?? `API request failed with ${response.status}`,
			body.error?.details,
		);
	}

	return body.data;
};
