const MAX_KEY_LENGTH = 512;
const DEFAULT_PRESIGN_EXPIRES = 900;

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  presignExpires: number;
};

export function getStorageConfig(): StorageConfig | null {
  if (typeof Bun === "undefined") {
    return null;
  }

  const endpoint = Bun.env.S3_ENDPOINT;
  const region = Bun.env.S3_REGION ?? "us-east-1";
  const bucket = Bun.env.S3_BUCKET;
  const accessKeyId = Bun.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = Bun.env.S3_SECRET_ACCESS_KEY;
  const presignExpires = Number.parseInt(
    Bun.env.S3_PRESIGN_EXPIRES ?? String(DEFAULT_PRESIGN_EXPIRES),
    10,
  );

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    presignExpires:
      Number.isFinite(presignExpires) && presignExpires > 0
        ? presignExpires
        : DEFAULT_PRESIGN_EXPIRES,
  };
}

export function createStorageClient() {
  const config = getStorageConfig();
  if (!config) {
    return null;
  }

  return new Bun.S3Client({
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
}

export function sanitizeObjectName(input: string): string {
  const basename = input
    .normalize("NFKC")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .at(-1);

  const safeName = (basename ?? "upload.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(0, 180);

  return safeName || "upload.bin";
}

export function validateObjectKey(input: unknown): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const key = input.trim().replace(/^\/+/, "");
  if (!key || key.length > MAX_KEY_LENGTH) {
    return null;
  }

  // S3 object keys can contain slashes, but reject traversal-like paths
  // because keys originate from public HTTP requests.
  if (
    key.includes("\\") ||
    key.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return null;
  }

  return key;
}
