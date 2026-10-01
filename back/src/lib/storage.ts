import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { ApiError } from "./api-error";

export const PRESIGN_TTL_SECONDS = 900;

export const MAX_BACKEND_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_OBJECT_BYTES = 100 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set([
	".fasta",
	".fa",
	".fna",
	".gb",
	".gbk",
	".genbank",
	".txt",
	".csv",
	".tsv",
	".json",
	".pdf",
]);

type StorageConfig = {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
};

const readConfig = (): StorageConfig => {
	// Trimmed on read. A `.env` saved with Windows line endings yields
	// `S3_REGION="us-east-1\r"`, and the stray carriage return is silently
	// carried into the SDK — where it surfaces much later as an opaque
	// "Region not accepted" validation error rather than a config problem.
	const read = (key: string) => process.env[key]?.trim();

	const endpoint = read("S3_ENDPOINT");
	const bucket = read("S3_BUCKET");
	const accessKeyId = read("S3_ACCESS_KEY_ID");
	const secretAccessKey = read("S3_SECRET_ACCESS_KEY");

	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
		throw new ApiError(
			503,
			"STORAGE_NOT_CONFIGURED",
			"Object storage is not configured.",
		);
	}

	return {
		endpoint,
		bucket,
		accessKeyId,
		secretAccessKey,
		region: read("S3_REGION") || "us-east-1",
	};
};

let cachedClient: S3Client | undefined;
let cachedSignature = "";

const getStorage = () => {
	const config = readConfig();
	const signature = [
		config.endpoint,
		config.bucket,
		config.region,
		config.accessKeyId,
		config.secretAccessKey,
		process.env.S3_FORCE_PATH_STYLE?.trim(),
	].join("|");

	if (!cachedClient || cachedSignature !== signature) {
		cachedClient = new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim() !== "false",
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
		});
		cachedSignature = signature;
	}

	return { client: cachedClient, bucket: config.bucket };
};

export const storageIdentity = () => {
	const config = readConfig();
	return { bucket: config.bucket, region: config.region };
};

export const assertBucketReachable = async () => {
	const { client, bucket } = getStorage();
	await client.send(new HeadBucketCommand({ Bucket: bucket }));
};

const UNSAFE_FILENAME = /[^a-zA-Z0-9._-]+/g;

export const sanitizeFilename = (filename: string) => {
	const base = filename.split(/[\\/]/).pop() ?? "file";
	const cleaned = base.replace(UNSAFE_FILENAME, "-").replace(/^[-.]+|-+$/g, "");
	return cleaned.length > 0 ? cleaned.slice(0, 80) : "file";
};

export const assertAllowedFilename = (filename: string) => {
	const safe = sanitizeFilename(filename);
	const dot = safe.lastIndexOf(".");
	const extension = dot === -1 ? "" : safe.slice(dot).toLowerCase();

	if (!ALLOWED_EXTENSIONS.has(extension)) {
		throw new ApiError(
			422,
			"UNSUPPORTED_FILE_TYPE",
			`Unsupported file type. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
		);
	}
};

export const assertDeclaredSize = (sizeBytes: number, limit: number) => {
	if (sizeBytes > limit) {
		throw new ApiError(
			413,
			"FILE_TOO_LARGE",
			`File exceeds the ${limit} byte limit.`,
		);
	}
};

export const formatFromFilename = (filename: string) => {
	const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();

	if ([".fasta", ".fa", ".fna"].includes(extension)) return "fasta";
	if ([".gb", ".gbk", ".genbank"].includes(extension)) return "genbank";
	return "raw";
};

export const buildObjectKey = (projectId: string, filename: string) =>
	`projects/${projectId}/${crypto.randomUUID()}-${sanitizeFilename(filename)}`;

export const presignPut = async (key: string, contentType: string) => {
	const { client, bucket } = getStorage();
	return getSignedUrl(
		client,
		new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
		{ expiresIn: PRESIGN_TTL_SECONDS },
	);
};

export const presignGet = async (key: string) => {
	const { client, bucket } = getStorage();
	return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
		expiresIn: PRESIGN_TTL_SECONDS,
	});
};

export const putObject = async (
	key: string,
	contentType: string,
	body: Uint8Array,
) => {
	const { client, bucket } = getStorage();
	await client.send(
		new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, Body: body }),
	);
};

export const deleteObject = async (key: string) => {
	const { client, bucket } = getStorage();
	await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
};
