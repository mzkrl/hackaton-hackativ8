import { Elysia } from "elysia";
import {
  createStorageClient,
  getStorageConfig,
  sanitizeObjectName,
  validateObjectKey,
} from "./storage";

// aot: false is required for Cloudflare Workers — the runtime forbids
// code generation from strings (new Function / eval) which Elysia's
// ahead-of-time compiler uses.
const storage = createStorageClient();
const storageConfig = getStorageConfig();

const app = new Elysia({ aot: false })
  .get("/", () => "Hello Elysia")
  .get("/storage/health", async ({ set }) => {
    if (!storage || !storageConfig) {
      set.status = 503;
      return {
        enabled: false,
        provider: "s3-compatible",
        message: "S3 storage is not configured for this runtime.",
      };
    }

    try {
      await storage.list({ maxKeys: 1 });

      return {
        enabled: true,
        provider: "s3-compatible",
        endpoint: storageConfig.endpoint,
        bucket: storageConfig.bucket,
        region: storageConfig.region,
      };
    } catch (error) {
      set.status = 503;
      return {
        enabled: true,
        provider: "s3-compatible",
        bucket: storageConfig.bucket,
        healthy: false,
        error: error instanceof Error ? error.message : "Storage healthcheck failed",
      };
    }
  })
  .post("/storage/presign", async ({ request, set }) => {
    if (!storage || !storageConfig) {
      set.status = 503;
      return { error: "S3 storage is not configured." };
    }

    try {
      const body = (await request.json()) as {
        filename?: unknown;
        contentType?: unknown;
        key?: unknown;
      };

      const contentType =
        typeof body.contentType === "string" && body.contentType.trim()
          ? body.contentType.trim().slice(0, 200)
          : "application/octet-stream";

      const requestedKey = validateObjectKey(body.key);
      const filename =
        typeof body.filename === "string"
          ? sanitizeObjectName(body.filename)
          : "upload.bin";

      const key = requestedKey ?? `uploads/${crypto.randomUUID()}-${filename}`;
      const uploadUrl = storage.file(key).presign({
        method: "PUT",
        expiresIn: storageConfig.presignExpires,
        type: contentType,
      });

      return {
        key,
        method: "PUT",
        contentType,
        expiresIn: storageConfig.presignExpires,
        uploadUrl,
      };
    } catch (error) {
      set.status = 400;
      return {
        error: error instanceof Error ? error.message : "Invalid presign request",
      };
    }
  })
  .post("/storage/upload", async ({ request, set }) => {
    if (!storage || !storageConfig) {
      set.status = 503;
      return { error: "S3 storage is not configured." };
    }

    try {
      const form = await request.formData();
      const entry = form.get("file");

      if (!(entry instanceof File)) {
        set.status = 400;
        return { error: 'Expected multipart/form-data field "file".' };
      }

      const requestedKey = validateObjectKey(form.get("key"));
      const key =
        requestedKey ??
        `uploads/${crypto.randomUUID()}-${sanitizeObjectName(entry.name)}`;

      const bytes = await storage.file(key).write(entry, {
        type: entry.type || "application/octet-stream",
      });

      return {
        key,
        bucket: storageConfig.bucket,
        bytes,
        contentType: entry.type || "application/octet-stream",
        downloadUrl: storage.file(key).presign({
          method: "GET",
          expiresIn: storageConfig.presignExpires,
        }),
      };
    } catch (error) {
      set.status = 502;
      return {
        error: error instanceof Error ? error.message : "Object storage upload failed",
      };
    }
  });

// Local dev with Bun
if (typeof Bun !== "undefined" && process.env.WORKER !== "1") {
  app.listen(4000);
  console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );
}

// Cloudflare Worker entry point
export default {
  fetch: app.fetch,
};
