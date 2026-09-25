# Elysia with Bun runtime

## Development

Install dependencies and start the API:

```bash
bun install
bun run dev
```

The local API listens on http://localhost:4000.

## MinIO / AIStor storage

The backend uses Bun's native `S3Client`, so the same storage configuration works with MinIO, MinIO AIStor, AWS S3, and other S3-compatible providers.

### 1. Start local MinIO

From the repository root:

```bash
cp .env.example .env
docker compose up -d minio minio-init
```

MinIO exposes:

- S3 API: http://localhost:9000
- Console: http://localhost:9001

The compose file creates the configured bucket automatically.

### 2. Configure the Bun API

Copy `back/.env.example` to `back/.env` and make sure the credentials match the MinIO container.

For local development:

```env
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=genomic-insight
S3_ACCESS_KEY_ID=genomic-insight
S3_SECRET_ACCESS_KEY=change-this-password
S3_PRESIGN_EXPIRES=900
```

For AIStor, point `S3_ENDPOINT`, credentials, region, and bucket at the AIStor deployment.

### Storage endpoints

- `GET /storage/health` checks the configured S3-compatible bucket.
- `POST /storage/upload` accepts `multipart/form-data` with a `file` field and stores the object under `uploads/`.
- `POST /storage/presign` returns a short-lived `PUT` URL so the browser can upload directly to object storage without receiving storage credentials.

Example presign request:

```json
{
  "filename": "sample.fasta",
  "contentType": "text/plain"
}
```

Keep the bucket private. The API returns short-lived presigned URLs instead of exposing storage credentials to the frontend.
