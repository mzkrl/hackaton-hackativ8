import { eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { getDb } from "../db/client";
import { sequences } from "../db/schema";
import { ApiError, errorBody } from "../lib/api-error";
import { requirePrincipal, resolvePrincipal } from "../lib/current-user";
import {
	assertProjectOwner,
	findOwnedSequenceByObjectKey,
} from "../lib/ownership";
import {
	MAX_BACKEND_UPLOAD_BYTES,
	MAX_OBJECT_BYTES,
	PRESIGN_TTL_SECONDS,
	assertAllowedFilename,
	assertBucketReachable,
	assertDeclaredSize,
	buildObjectKey,
	deleteObject,
	formatFromFilename,
	getObjectStream,
	presignGet,
	presignPut,
	putObject,
	storageIdentity,
} from "../lib/storage";
import { enforce, RATE_LIMITS } from "../lib/rate-limit";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

const presignBody = t.Object({
	projectId: t.String({ format: "uuid" }),
	filename: t.String({ minLength: 1, maxLength: 255 }),
	contentType: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
	sizeBytes: t.Optional(t.Integer({ minimum: 1 })),
	description: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
}, { additionalProperties: false });

const requireFormString = (form: FormData, field: string) => {
	const value = form.get(field);
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new ApiError(
			422,
			"VALIDATION_ERROR",
			`Field "${field}" is required.`,
		);
	}
	return value.trim();
};

export const storageRoutes = new Elysia()
	.get("/storage/health", async ({ request, set }) => {
		// Unauthenticated on purpose: a health check needs to work before anyone
		// signs in, and it is what a load balancer or `minio-init` polls. The
		// bucket name and region are withheld from anonymous callers though —
		// together they hand an outsider the exact layout of private
		// infrastructure, which is reconnaissance for no useful reason.
		const isAuthenticated = (await resolvePrincipal(request)) !== null;

		try {
			await assertBucketReachable();
			return isAuthenticated
				? { status: "ok", ...storageIdentity() }
				: { status: "ok" };
		} catch (error) {
			if (error instanceof ApiError) {
				set.status = error.statusCode;
				return errorBody(error.code, error.message);
			}

			set.status = 503;
			return errorBody("STORAGE_UNAVAILABLE", "Object storage is unreachable.");
		}
	})
	.post(
		"/storage/presign",
		async ({ request, body, status }) => {
			const principal = await requirePrincipal(request);
			await assertProjectOwner(body.projectId, principal);

			// Presign writes a `sequences` row before the client has uploaded
			// anything, so this endpoint is an unbounded row writer. Capped per
			// session-derived principal id.
			await enforce(RATE_LIMITS.storagePresign(), principal.id);

			assertAllowedFilename(body.filename);

			if (body.sizeBytes !== undefined) {
				assertDeclaredSize(body.sizeBytes, MAX_OBJECT_BYTES);
			}

			const objectKey = buildObjectKey(body.projectId, body.filename);
			const contentType = body.contentType ?? DEFAULT_CONTENT_TYPE;

			const [sequence] = await getDb()
				.insert(sequences)
				.values({
					projectId: body.projectId,
					description: body.description ?? null,
					format: formatFromFilename(body.filename),
					objectKey,
					originalFilename: body.filename,
				})
				.returning();

			const uploadUrl = await presignPut(objectKey, contentType);

			return status(201, {
				data: {
					sequenceId: sequence.id,
					objectKey,
					method: "PUT",
					uploadUrl,
					expiresIn: PRESIGN_TTL_SECONDS,
				},
			});
		},
		{ body: presignBody },
	)
	.post(
		"/storage/upload",
		async ({ request, status }) => {
			const principal = await requirePrincipal(request);

			// Before `request.formData()`, which buffers the whole body. The body
			// size itself is already capped in `app.ts` on Content-Length; this
			// stops a caller making many separate uploads.
			await enforce(RATE_LIMITS.storageUpload(), principal.id);

			const form = await request.formData();
			const projectId = requireFormString(form, "projectId");
			const filename = requireFormString(form, "filename");

			await assertProjectOwner(projectId, principal);
			assertAllowedFilename(filename);

			// Optional, and previously dropped on this path: the direct-to-storage
			// flow carried a description but the proxy did not, so an upload that
			// went through the API silently lost it.
			const rawDescription = form.get("description");
			const description =
				typeof rawDescription === "string" && rawDescription.trim().length > 0
					? rawDescription.trim().slice(0, 2000)
					: null;

			const file = form.get("file");
			if (!(file instanceof File)) {
				throw new ApiError(422, "VALIDATION_ERROR", 'Field "file" is required.');
			}

			assertDeclaredSize(file.size, MAX_BACKEND_UPLOAD_BYTES);

			const objectKey = buildObjectKey(projectId, filename);
			const contentType = file.type || DEFAULT_CONTENT_TYPE;

			await putObject(
				objectKey,
				contentType,
				new Uint8Array(await file.arrayBuffer()),
			);

			const [sequence] = await getDb()
				.insert(sequences)
				.values({
					projectId,
					description,
					format: formatFromFilename(filename),
					objectKey,
					originalFilename: filename,
				})
				.returning();

			return status(201, {
				data: {
					sequenceId: sequence.id,
					objectKey,
					method: "PUT",
					sizeBytes: file.size,
				},
			});
		},
	)
	.get("/storage/download/*", async ({ request, params }) => {
		const principal = await requirePrincipal(request);
		const objectKey = params["*"];
		await findOwnedSequenceByObjectKey(objectKey, principal);

		// Relayed server-side. The response is a stream, not the JSON envelope
		// the rest of the API uses, because the client here is the browser's
		// download handler rather than `apiFetch`.
		const object = await getObjectStream(objectKey);

		const headers = new Headers({
			"content-type": object.contentType,
			"content-disposition": `attachment; filename="${encodeURIComponent(
				objectKey.split("/").pop() ?? "download",
			)}"`,
		});
		if (object.contentLength !== undefined) {
			headers.set("content-length", String(object.contentLength));
		}

		return new Response(object.body, { headers });
	})
	.get("/storage/*", async ({ request, params }) => {
		const principal = await requirePrincipal(request);
		const objectKey = params["*"];
		const sequence = await findOwnedSequenceByObjectKey(objectKey, principal);
		const downloadUrl = await presignGet(objectKey);

		return {
			data: {
				objectKey,
				downloadUrl,
				expiresIn: PRESIGN_TTL_SECONDS,
				sequence,
			},
		};
	})
	.delete("/storage/*", async ({ request, params }) => {
		const principal = await requirePrincipal(request);
		await enforce(RATE_LIMITS.storageMutate(), principal.id);

		const objectKey = params["*"];
		const sequence = await findOwnedSequenceByObjectKey(objectKey, principal);

		await deleteObject(objectKey);
		await getDb()
			.update(sequences)
			.set({ objectKey: null })
			.where(eq(sequences.id, sequence.id));

		return { data: { objectKey, deleted: true } };
	});
