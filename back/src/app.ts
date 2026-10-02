import { sql } from "drizzle-orm";
import { Elysia } from "elysia";

import { getDb } from "./db/client";
import { ApiError, errorBody } from "./lib/api-error";
import { warnDevIdentityAtStartup } from "./lib/current-user";
import { MAX_BACKEND_UPLOAD_BYTES } from "./lib/storage";
import { analysesRoutes } from "./routes/analyses";
import { authRoutes } from "./routes/auth";
import { conversationsRoutes } from "./routes/conversations";
import { guestRoutes } from "./routes/guest";
import { projectsRoutes } from "./routes/projects";
import { sequencesRoutes } from "./routes/sequences";
import { storageRoutes } from "./routes/storage";
import { isHostedRuntime } from "./lib/runtime";

/**
 * Origins allowed to call the API with a session cookie.
 *
 * The frontend and the API are served from different origins, so CORS is
 * required. It cannot be a wildcard: the browser refuses `Access-Control-
 * Allow-Origin: *` on a credentialed request, and the session cookie is the
 * whole point. So this is an explicit allowlist from `CORS_ORIGINS`, and an
 * empty list means no cross-origin caller is allowed.
 *
 * Note that CORS is not an authorisation control. It stops a *browser* from
 * reading a response; it does not stop anyone from calling the API directly.
 * Everything that matters is enforced after the session is resolved.
 */
const corsOrigins = () =>
	(process.env.CORS_ORIGINS ?? "")
		.split(",")
		// Trimmed per entry so a value loaded from a CRLF `.env`, or written with
		// a stray space, cannot produce an origin string that never matches the
		// browser's and silently blocks every request.
		.map((origin) => origin.trim())
		.filter((origin) => origin.length > 0 && origin !== "*");

/**
 * Largest request body accepted per route, checked before the body is read.
 *
 * This exists because the size check that used to protect uploads ran too late:
 * `POST /storage/upload` called `request.formData()`, which buffers the entire
 * body into memory, and only then compared `file.size` against the 5 MiB cap. The
 * advertised limit was therefore decorative — a single oversized POST could
 * exhaust the API's heap. Rejecting on `Content-Length` in `onRequest` means the
 * body is never materialised.
 *
 * Caveat worth keeping in mind: `Content-Length` is absent for a chunked
 * transfer, so a caller who deliberately uses chunked encoding bypasses this
 * check. Browsers send `Content-Length` for `fetch` with a `File`/`FormData`
 * body, so the browser path is covered; keep a `client_max_body_size` at the
 * reverse proxy as the transport-level backstop.
 */
const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;

const bodyLimitFor = (pathname: string): number => {
	// Multipart framing adds a few hundred bytes per part, so the cap needs slack
	// or a file at exactly the limit is rejected.
	if (pathname === "/storage/upload") {
		return MAX_BACKEND_UPLOAD_BYTES + 64 * 1024;
	}

	// A guest migration can carry a whole local history: up to 50 projects, each
	// with sequences and analyses. Bounded generously, but bounded — the nested
	// caps inside the schema still multiply, so this is the ceiling on the lot.
	if (pathname === "/guest/import") {
		return 16 * 1024 * 1024;
	}

	return DEFAULT_BODY_LIMIT_BYTES;
};

const MIB = 1024 * 1024;

/**
 * Builds the Elysia app once so the API and the analysis worker share routes.
 *
 * The API runs on the VPS next to PostgreSQL, Redis and MinIO, so it uses the
 * default adapter. The database client speaks TCP, which rules out runtimes
 * without raw socket support.
 */
export const createApp = () => {
	const origins = corsOrigins();

	// Announced before the first request so an operator sees it in the log even
	// if nobody is currently misconfigured.
	warnDevIdentityAtStartup();

	return new Elysia()
		.onRequest(({ request, set }) => {
			// Baseline hardening on every response. Cheap, and they stop a stored
			// JSON result from being re-interpreted as something executable if it
			// is ever rendered in a browser context.
			set.headers["x-content-type-options"] = "nosniff";
			set.headers["x-frame-options"] = "DENY";
			set.headers["referrer-policy"] = "no-referrer";
			set.headers["cross-origin-resource-policy"] = "same-site";
			set.headers["permissions-policy"] =
				"camera=(), microphone=(), geolocation=(), interest-cohort=()";

			// Only meaningful once the API is actually served over TLS, which is
			// the case for the tunnel in front of it on a hosted runtime.
			if (isHostedRuntime()) {
				set.headers["strict-transport-security"] =
					"max-age=31536000; includeSubDomains";
			}

			const origin = request.headers.get("origin");

			if (origin && origins.includes(origin)) {
				set.headers["access-control-allow-origin"] = origin;
				set.headers["access-control-allow-credentials"] = "true";
				set.headers["access-control-allow-headers"] = "content-type";
				set.headers["access-control-allow-methods"] = "GET,POST,DELETE,OPTIONS";
				set.headers["vary"] = "Origin";
			}

			if (request.method === "OPTIONS") {
				return;
			}

			// Reject an oversized body before a handler reads it. `413` here is
			// cheap precisely because nothing has been buffered yet.
			const declaredLength = request.headers.get("content-length");
			if (declaredLength === null) {
				return;
			}

			const declared = Number(declaredLength);
			if (!Number.isFinite(declared) || declared < 0) {
				return;
			}

			const limit = bodyLimitFor(new URL(request.url).pathname);

			if (declared > limit) {
				set.status = 413;
				return errorBody(
					"PAYLOAD_TOO_LARGE",
					`Request body exceeds the ${Math.floor(limit / MIB)} MiB limit for this endpoint.`,
				);
			}
		})
		.options("*", () => new Response(null, { status: 204 }))
		.onError(({ code, error, set }) => {
			if (error instanceof ApiError) {
				set.status = error.statusCode;

				// Tell a rate-limited client when it may try again. Browsers ignore
				// this, but scripts and the frontend do not.
				const retryAfter = error.details?.retryAfter;
				if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
					set.headers["retry-after"] = String(Math.ceil(retryAfter));
				}

				return errorBody(error.code, error.message, error.details);
			}

			if (code === "VALIDATION") {
				set.status = 422;
				return errorBody("VALIDATION_ERROR", "Request validation failed.");
			}

			if (code === "NOT_FOUND") {
				set.status = 404;
				return errorBody("ROUTE_NOT_FOUND", "Route not found.");
			}

			// Logged server-side only. The response body never carries internals,
			// so a stack trace cannot leak through a 500.
			console.error(error);
			set.status = 500;
			return errorBody("INTERNAL_ERROR", "Internal server error.");
		})
		.get("/", () => ({ service: "back", status: "ok" }))
		.get("/health", async ({ set }) => {
			try {
				await getDb().execute(sql`select 1`);
				return { status: "ok", database: "connected" };
			} catch {
				set.status = 503;
				return { status: "degraded", database: "unavailable" };
			}
		})
		.use(authRoutes)
		.use(guestRoutes)
		.use(projectsRoutes)
		.use(sequencesRoutes)
		.use(analysesRoutes)
		.use(conversationsRoutes)
		.use(storageRoutes);
};
