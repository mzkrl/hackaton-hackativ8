import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { analyses } from "../db/schema";
import { ApiError } from "../lib/api-error";

/**
 * Callback endpoint for Langflow → backend result delivery.
 *
 * ⚠️ SKELETON — NOT YET ACTIVE ⚠️
 *
 * This endpoint is gated behind `LANGFLOW_CALLBACK_ENABLED=true` and will
 * return 503 until then. It exists so that:
 *   1. The route structure is defined and testable.
 *   2. The HMAC validation logic is in place.
 *   3. The status check (only `processing` → `completed`) is enforced.
 *   4. Activation is a single env var flip once the owner answers the
 *      three blockers in PLAN.md §3.3.
 *
 * The three blockers (from PLAN.md §3.3):
 *   1. **Correlation ID**: This skeleton uses `POST /analyses/:id/callback`
 *      (id in URL). Alternative: body carries `analysisId`.
 *   2. **Authentication**: HMAC-SHA256 signature in `x-callback-signature`
 *      header, computed over the raw request body using a shared secret
 *      (`LANGFLOW_CALLBACK_SECRET`). Rejects if missing or invalid.
 *   3. **Timeout/lease**: This skeleton does NOT implement lease expiry.
 *      The owner must decide: does the worker's `withTimeout` + re-check
 *      remain the primary mechanism, with this callback as a secondary
 *      path? Or does the callback replace the worker wait entirely?
 *
 * Until all three are answered, this endpoint is inert.
 */

const callbackBody = t.Object({
	// The analysis this callback is for. Must match the URL param.
	analysisId: t.String({ format: "uuid" }),
	// The result payload from Langflow. Shape TBD by owner.
	result: t.Optional(t.Record(t.String(), t.Unknown())),
	// Optional error message if the analysis failed.
	error: t.Optional(t.String({ maxLength: 2000 })),
}, { additionalProperties: false });

const callbackParams = t.Object({ id: t.String({ format: "uuid" }) });

/**
 * Validates the HMAC-SHA256 signature of the request body.
 *
 * The signature is computed as: HMAC-SHA256(secret, rawBody)
 * and sent as a hex string in the `x-callback-signature` header.
 *
 * Uses `timingSafeEqual` to prevent timing attacks.
 */
const validateSignature = (
	rawBody: string,
	signature: string | undefined,
	secret: string,
): boolean => {
	if (!signature) return false;

	const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

	// `timingSafeEqual` requires equal-length buffers.
	if (signature.length !== expected.length) return false;

	return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
};

export const analysisCallbackRoutes = new Elysia({ prefix: "/analyses" })
	.post(
		"/:id/callback",
		async ({ request, params, body, status }) => {
			// Gate: only active when explicitly enabled.
			if (process.env.LANGFLOW_CALLBACK_ENABLED !== "true") {
				throw new ApiError(
					503,
					"CALLBACK_DISABLED",
					"Analysis callback is not enabled. Set LANGFLOW_CALLBACK_ENABLED=true to activate.",
				);
			}

			const secret = process.env.LANGFLOW_CALLBACK_SECRET?.trim();
			if (!secret) {
				throw new ApiError(
					500,
					"CALLBACK_MISCONFIGURED",
					"LANGFLOW_CALLBACK_SECRET is not set. Cannot validate callback authenticity.",
				);
			}

			// Read the raw body for signature validation.
			const rawBody = await request.text();

			// Validate HMAC signature.
			const signature = request.headers.get("x-callback-signature") ?? undefined;
			if (!validateSignature(rawBody, signature, secret)) {
				throw new ApiError(
					401,
					"CALLBACK_UNAUTHORIZED",
					"Invalid or missing callback signature.",
				);
			}

			// Correlation ID: must match URL param.
			if (body.analysisId !== params.id) {
				throw new ApiError(
					422,
					"CALLBACK_ID_MISMATCH",
					"Body analysisId does not match URL parameter.",
				);
			}

			// Fetch the analysis row.
			const [analysis] = await getDb()
				.select()
				.from(analyses)
				.where(eq(analyses.id, params.id))
				.limit(1);

			if (!analysis) {
				throw new ApiError(404, "NOT_FOUND", "Analysis not found.");
			}

			// Status check: only accept if still `processing`.
			// This prevents a late callback from overwriting a `completed` or
			// `failed` status that was set by the worker's timeout mechanism.
			if (analysis.status !== "processing") {
				throw new ApiError(
					409,
					"CALLBACK_STATUS_CONFLICT",
					`Analysis is not in "processing" state (current: ${analysis.status}). Callback rejected.`,
				);
			}

			// Write the result.
			const isError = Boolean(body.error);
			const [updated] = await getDb()
				.update(analyses)
				.set({
					status: isError ? "failed" : "completed",
					resultJson: body.result ?? null,
					errorMessage: body.error ?? null,
					updatedAt: new Date(),
				})
				.where(eq(analyses.id, params.id))
				.returning();

			return status(200, { data: updated });
		},
		{ body: callbackBody, params: callbackParams },
	);
