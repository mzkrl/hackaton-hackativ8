# GenePilot

Development lives on Git branches (currently `baca`). The production
deployment and the env docs live in the per-service READMEs
(`back/README.md`, `front/README.md`, `langflow/README.md`).

## Run locally

Everything below runs against local containers on this machine. You need
**Bun** (1.1+) and **Docker** with Compose.

```bash
git clone <repo> && cd hackaton-hackativ8
git checkout baca
```

### 1. Start the local datastores

```bash
docker compose -f docker-compose.local.yml up -d
```

This starts Postgres, Redis, MinIO (with its bucket) and the Bio analysis
service on localhost. Verify: `docker compose -f docker-compose.local.yml ps`
should show everything healthy/up. Stop later with `down`, wipe with `down -v`.

### 2. Backend API + analysis worker

```bash
cd back
cp .env.example .env     # active local block; replace AUTH_SECRET with a fresh one:
openssl rand -base64 64  # -> paste into AUTH_SECRET in back/.env
bun install
bun run db:migrate       # create the schema in the local Postgres
bun run dev              # API on http://localhost:4000
```

The worker is a separate process; run it in its own terminal:

```bash
cd back
bun run worker:analysis
```

### 3. Frontend

```bash
cd front
cp .env.example .env.local
bun install
bun run dev              # http://localhost:3000
```

Open `http://localhost:3000` and continue as guest (or register).

## Environment

Use `localhost`, **not** `127.0.0.1`, on both sides — a browser treats them as
two different sites and silently drops the session cookie.

### `back/.env` (from `back/.env.example`)

| Variable                 | Local value                                            |
| ------------------------ | ------------------------------------------------------ |
| `DATABASE_URL`           | `postgresql://genepilot:genepilot@127.0.0.1:5432/gene_pilot` |
| `REDIS_URL`              | `redis://127.0.0.1:6379`                               |
| `ANALYSIS_QUEUE_NAME`    | `genomic-analysis-local` (isolates your local worker from a remote one sharing Redis) |
| `S3_ENDPOINT`            | `http://127.0.0.1:9000`                                |
| `S3_BUCKET`              | `genepilot`                                            |
| `S3_ACCESS_KEY_ID`       | `minioadmin`                                           |
| `S3_SECRET_ACCESS_KEY`   | `minioadmin`                                           |
| `BIO_SERVICE_URL`        | `http://127.0.0.1:8001`                                |
| `CORS_ORIGINS`           | `http://localhost:3000`                                |
| `RATE_LIMIT_FALLBACK_TO_UNKNOWN` | `1` (no proxy header locally)                    |
| `AUTH_SECRET`            | generate: `openssl rand -base64 64`                    |

Langflow is **optional** locally: leave the `LANGFLOW_*` variables unset and
analyses run on the Bio Service alone (no AI interpretation yet). Set them to
the deployed Langflow values to enable the AI layer; the comments in
`back/.env.example` spell out the exact keys.

### `front/.env.local` (from `front/.env.example`)

| Variable              | Local value             |
| --------------------- | ----------------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` |

## Troubleshooting

- **Sign-in appears to do nothing.** The frontend and API hostnames differ
  (`localhost` vs `127.0.0.1`). Keep them identical.
- **Storage unavailable.** `minio-init` only runs once; `docker compose -f
  docker-compose.local.yml up -d` again, or create the bucket by hand with the
  MinIO console at `http://localhost:9001` (minioadmin / minioadmin).
- **Queued analysis that never completes.** The local worker is not running
  (`bun run worker:analysis`), or a stale worker on shared Redis is winning the
  jobs — check `ANALYSIS_QUEUE_NAME` is set to a value no other machine uses.