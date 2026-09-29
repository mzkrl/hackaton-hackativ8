# back

Application API for Genomic Insight Agent. Elysia + Drizzle ORM + PostgreSQL, running on Bun
next to Redis and MinIO on a single VPS.

## Runtime entrypoints

| Process         | Entrypoint               | Notes                                                        |
| --------------- | ------------------------ | ------------------------------------------------------------ |
| API             | `src/index.ts`           | HTTP listener. Always long-lived; never a serverless function. |
| Analysis worker | `src/worker/analysis.ts` | Long-lived BullMQ consumer.                                  |

Both processes run on the same host as PostgreSQL, Redis and MinIO, so they talk to those
services over `127.0.0.1`. `bun run dev` serves on `PORT` (default `4000`) and binds
`127.0.0.1` by default.

Routes live in `src/routes/` and `src/app.ts` builds the Elysia instance once so the API and
the worker share the same route definitions.

## Deployment topology

Nothing in this service is meant to be reachable from the internet except the API, and only
through a tunnel:

```text
browser
  |
  |  https
  v
cloudflared  (terminates TLS, owns the public hostname)
  |
  |  http://127.0.0.1:4000          <- only this
  v
back API  ---- localhost ---->  PostgreSQL   :5432
                              >  Redis       :6379
                              >  MinIO       :9000
```

Consequences that the code depends on:

- The API binds `127.0.0.1`, so nothing bypasses the tunnel. `HOST` overrides this if a host
  needs a different bind address; there is no reason to set it to `0.0.0.0` here.
- PostgreSQL, Redis and MinIO stay on loopback too. No ports are published.
- The frontend calls the API hostname from `NEXT_PUBLIC_API_URL` in `front/.env.example`.
- Production cookies are `Secure`, which the tunnel's TLS provides.
- `CORS_ORIGINS` must list the frontend origin exactly. It cannot be `*`, because the browser
  refuses a wildcard on a credentialed request and the session cookie is the whole point.

### Same-site versus cross-site

`SameSite` is about the *site* (registrable domain), not the origin, so this distinction decides
whether the session cookie survives at all:

| Frontend              | API                        | `COOKIE_SAME_SITE` | Result                                       |
| --------------------- | -------------------------- | ------------------ | -------------------------------------------- |
| `app.example.com`     | `api.example.com`          | `lax` (default)    | Works. Same site, cookie is sent.            |
| `anything.vercel.app` | `api.example.com`          | `none`             | Works, and the cookie is sent.               |
| `anything.vercel.app` | `api.example.com` + `lax`  | —                  | Silently logged out on every request.        |

The middle row is the one to check before a demo. `SameSite=Lax` with an unrelated site is not
an error the browser reports — the cookie is simply never attached, and the app behaves as if
the session expired on every single call. `COOKIE_SAME_SITE=none` implies `Secure` automatically,
because browsers reject `SameSite=None` without it.

There is no serverless or edge deployment target. The database client speaks TCP through
`postgres.js`, and a TCP connection cannot be held by a request-scoped runtime, so the API
must be a long-lived process behind a hostname.

## Local stack

The repo root has a `docker-compose.yml` with Postgres, Redis, and MinIO:

```bash
docker compose up -d          # start postgres, redis, minio, and create the bucket
docker compose ps
docker compose down           # stop, keep data
docker compose down -v        # stop and delete data
```

To point the API at the local containers instead of the VPS, set
`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/gene_pilot`,
`REDIS_URL=redis://127.0.0.1:6379`, `S3_ENDPOINT=http://127.0.0.1:9000`, and run
`bun run db:migrate`.

## Environment

| Variable               | Required | Purpose                                                          |
| ---------------------- | -------- | ---------------------------------------------------------------- |
| `DATABASE_URL`         | yes      | Postgres connection string.                                       |
| `S3_ENDPOINT`          | storage  | S3-compatible endpoint, e.g. `http://127.0.0.1:9000` for MinIO.  |
| `S3_BUCKET`            | storage  | Bucket name for research files.                                  |
| `S3_ACCESS_KEY_ID`     | storage  | Access key. Safe to appear in a presigned URL credential scope.   |
| `S3_SECRET_ACCESS_KEY` | storage  | Secret key. Never leaves the server.                             |
| `S3_REGION`            | no       | Defaults to `us-east-1`.                                         |
| `S3_FORCE_PATH_STYLE`  | no       | Defaults to path style, which MinIO requires.                    |
| `REDIS_URL`            | queue    | Redis connection string for the BullMQ queue.                    |
| `QUEUE_ATTEMPTS`       | no       | Job retry attempts. Defaults to `3`.                             |
| `WORKER_CONCURRENCY`   | no       | Concurrent analysis jobs. Defaults to `2`.                        |
| `ENQUEUE_PORT`         | no       | Serve `POST /enqueue` from the analysis worker when set.         |
| `QUEUE_SECRET`         | see below| Shared secret for the enqueue service.                           |
| `QUEUE_ENQUEUE_URL`    | no       | Base URL of a remote enqueue service. Optional split deployment. |
| `BIO_SERVICE_URL`      | no       | Base URL of the Bio service. Analysis fails without it.          |
| `PORT`                 | no       | API port. Defaults to `4000`.                                    |
| `HOST`                 | no       | API bind address. Defaults to `127.0.0.1`.                      |
| `CORS_ORIGINS`         | hosted   | Comma-separated exact frontend origins allowed to send the session cookie. No wildcard. |
| `COOKIE_SAME_SITE`     | no       | `none` when the API is on a different site than the frontend. Defaults to `lax`. See the table above. |
| `DEPLOY_RUNTIME`       | no       | Set to `vps` to force hosted behaviour without `NODE_ENV`.       |
| `ALLOW_DEV_AUTH`       | no       | Enables the shared local identity outside development.           |
| `DEV_USER_EMAIL`       | no       | Email of the local development identity. Default `developer@local.test`. |
| `AUTH_SECRET`          | hosted   | HMAC key for session cookies. Min 32 chars, required in production. |
| `SESSION_TTL_SECONDS`  | no       | Session lifetime in seconds. Defaults to 7 days.                 |
| `PBKDF2_ITERATIONS`    | no       | Password hashing cost, 1000–2000000. Defaults to `210000`.       |

Credentials belong in `back/.env` locally and in the process environment on the VPS. They are
not bundled into any build output, because there is no build step.

A production deployment without `AUTH_SECRET` is not "insecurely open" — it fails closed with
`401 UNAUTHENTICATED` on every data route.

`QUEUE_SECRET` is mandatory whenever `ENQUEUE_PORT` or `QUEUE_ENQUEUE_URL` is set; the enqueue
service refuses to start without it.

## Authentication

Register, log in, and the session cookie are implemented. See `PLAN.md` §7 for the full rationale.

- `POST /auth/register` and `POST /auth/login` set a `gia_session` cookie: `HttpOnly`, `SameSite` from `COOKIE_SAME_SITE`, and `Secure` in production. The token is `v1.<payload>.<HMAC-SHA-256>` and is verified statelessly, so no session lookup is needed per request.
- Passwords are hashed with PBKDF2-HMAC-SHA-512 (210k iterations by default) through Web Crypto, so there is no native binding to compile.
- `POST /auth/logout` expires the cookie. `GET /auth/me` reports the current account.
- Login answers `Invalid email or password.` for both an unknown email and a wrong password, and spends the same PBKDF2 work either way, so neither the message nor the timing reveals whether an account exists.
- **Local development:** with `ALLOW_DEV_AUTH=true` (or `bun run dev` without `NODE_ENV=production`), a session is used when present, otherwise the shared `DEV_USER_EMAIL` identity is upserted.
- **Production:** the shared identity is only reachable when `ALLOW_DEV_AUTH` is explicitly enabled. Otherwise every data route returns `401 UNAUTHENTICATED`.

Because production cookies are `Secure`, the API must be reached over HTTPS. Put TLS in front of
it, or expose it through a tunnel that terminates TLS, before pointing a browser at it.

Sessions are stateless, so a successful signature check returns the user id without confirming
the account still exists. Every route then re-reads the owned row, so access stays scoped;
deleting an account should also rotate `AUTH_SECRET` to cut off outstanding cookies.

Ownership is always resolved from a server-side record. The API never accepts a user id, email,
or role from the client, `object_key` can only be set by the storage endpoints, and
`queue_job_id` / analysis `status` are worker-owned. Supplying any of them is rejected with `422`.

## Importing guest history

`POST /guest/import` moves a guest's IndexedDB history into their new account, so registering
does not throw away prior work.

- Requires a session: the payload is only accepted for the authenticated account.
- Send the UUIDs the browser already assigned. Re-running the import is safe: every insert is `on conflict do nothing`, so a retry after a partial failure converges instead of duplicating.
- Nest the payload as projects → sequences → analyses, with conversations alongside sequences:

  ```json
  {
    "projects": [
      {
        "id": "uuid",
        "name": "Mito study",
        "sequences": [
          {
            "id": "uuid",
            "format": "fasta",
            "recordId": "NC_000001",
            "sequenceLength": 16641,
            "analyses": [
              { "id": "uuid", "sequenceId": "uuid", "analysisType": "gc_content", "resultJson": { "gc": 42.5 } }
            ]
          }
        ],
        "conversations": [{ "id": "uuid", "role": "user", "content": "what is the GC content?" }]
      }
    ]
  }
  ```

- Each project commits in its own transaction, so one bad record cannot leave a half-imported project. Earlier projects stay committed and the error names the failing index, which is what makes a targeted retry safe.
- `userId`, `objectKey`, and `queueJobId` are rejected with `422`. Each is declared on the level it belongs to: `userId` on the project, `objectKey` on the sequence, `queueJobId` on the analysis. A guest has no bucket and no queue, so an imported analysis can only be `completed` or `failed`; anything else lands as `failed` rather than implying a job that does not exist.
- Bounded at 50 projects, 200 sequences per project, 100 analyses per sequence, 500 conversations per project, 64 KB per analysis result.

## Endpoints

| Method | Path                             | Description                                        |
| ------ | -------------------------------- | -------------------------------------------------- |
| GET    | `/health`                        | Liveness plus a database connectivity probe.       |
| POST   | `/auth/register`                 | Create an account and set the session cookie.      |
| POST   | `/auth/login`                    | Set the session cookie.                            |
| POST   | `/auth/logout`                   | Expire the session cookie.                         |
| GET    | `/auth/me`                       | Current account, or `401`.                         |
| POST   | `/guest/import`                  | Import guest IndexedDB history (session required). |
| POST   | `/projects`                      | Create a project.                                   |
| GET    | `/projects`                      | List owned projects.                                |
| GET    | `/projects/:id`                  | Fetch one owned project.                            |
| POST   | `/projects/:id/sequences`        | Register a metadata-only sequence (pasted text).    |
| GET    | `/projects/:id/sequences`        | List sequences in a project.                        |
| POST   | `/analyses`                      | Queue an analysis; returns `202` immediately.       |
| GET    | `/analyses/:id`                  | Fetch one analysis.                                 |
| GET    | `/analyses/:id/status`           | Poll analysis status.                               |
| POST   | `/conversations`                 | Append a conversation message.                      |
| GET    | `/conversations/:projectId`      | List conversation messages for a project.           |
| GET    | `/storage/health`                | Bucket reachability probe.                          |
| POST   | `/storage/presign`               | Mint a presigned `PUT` and register the sequence.   |
| POST   | `/storage/upload`                | Proxy a small multipart upload through the backend. |
| GET    | `/storage/*`                     | Mint a presigned `GET` for an owned object.         |
| DELETE | `/storage/*`                     | Delete an owned object and detach it.               |

Successful responses are `{ "data": ... }`. Errors are `{ "error": { "code", "message", "details"? } }`
with `404` for missing or unowned resources, `413` for oversized files, `422` for validation
failures, `503` when the queue is unavailable, and `401` when auth is required.

## Uploading a research file

`POST /storage/presign` is the canonical path for file-backed sequences. It records the
`object_key` at presign time (the optimistic variant described in `PLAN.md` §5), so the row
exists before the browser uploads. `sequence_length` and `sequence_hash` stay `NULL` until the
Bio service parses the file.

```text
POST /storage/presign  { projectId, filename, contentType?, sizeBytes? }
  -> 201 { sequenceId, objectKey, method: "PUT", uploadUrl, expiresIn: 900 }

PUT <uploadUrl>  (browser uploads the file directly to object storage)

GET /storage/<objectKey>
  -> 200 { objectKey, downloadUrl, expiresIn: 900, sequence }
```

Presigned URLs live 15 minutes. Because the signature covers only the `host` header, the browser
may send whatever `Content-Type` it derives from the `File`.

`POST /storage/upload` takes `multipart/form-data` with `projectId`, `filename`, and `file`, and
is capped at 5 MiB. Direct presigned uploads are capped at 100 MiB. Allowed extensions:
`.fasta`, `.fa`, `.fna`, `.gb`, `.gbk`, `.genbank`, `.txt`, `.csv`, `.tsv`, `.json`, `.pdf`.

Note that a presigned `PUT` is not size-enforced server-side — the declared `sizeBytes` is
validated, but a client can still send a different body. Enforcing a hard limit requires a
bucket policy.

## Analysis queue

Analyses are never executed inside an HTTP request. `POST /analyses` writes a `queued` row,
pushes a BullMQ job onto Redis, stores `queue_job_id`, and returns `202`:

```text
POST /analyses  { sequenceId, analysisType }
  -> 202 { data: { id, status: "queued", queueJobId, ... } }

GET /analyses/:id/status
  -> 200 { data: { id, status, queueJobId, errorMessage, updatedAt } }
```

Status moves `queued -> processing -> completed | failed`. A worker records the failure reason
on every failed attempt, so a job that exhausts its retries still leaves an explanation behind.

If Redis is unreachable, submission returns `503 QUEUE_UNAVAILABLE` and the row is moved to
`failed` rather than being left in `queued`. The response includes `error.details.analysisId` so
the client can surface that failed attempt. If the queue is not configured at all, the request
fails fast with `503 QUEUE_NOT_CONFIGURED` and no row is created.

The consumer is a long-lived process, started the same way as the API:

```bash
bun run worker:analysis
```

The API writes to Redis directly, because both processes run on the same host. If they are ever
split across machines, the worker can host a small enqueue service and the API posts to it
instead:

```bash
# on the worker
REDIS_URL=redis://127.0.0.1:6379 QUEUE_SECRET=... ENQUEUE_PORT=4010 bun run worker:analysis

# on the API
QUEUE_ENQUEUE_URL=http://127.0.0.1:4010 QUEUE_SECRET=... bun run src/index.ts
```

```text
API     -> POST <QUEUE_ENQUEUE_URL>/enqueue   (x-queue-secret: QUEUE_SECRET)
Service -> BullMQ enqueue -> Redis
Worker  -> BullMQ consumer -> Bio Service
```

## Tests

Tests run against a real, already-running API plus the real database, Redis and MinIO. Start the
API in production mode first, on a port that is not your dev server:

```bash
NODE_ENV=production PORT=4100 bun run src/index.ts
```

Then run the suite:

```bash
TEST_API_URL=http://127.0.0.1:4100 bun test
```

`NODE_ENV=production` matters: it disables the development identity fallback, so the fail-closed
auth tests actually exercise signature rejection instead of silently falling back to the shared
local user.

Layout mirrors the other project in this workspace:

```
__tests__/
  helpers/
    client.ts     cookie jar, request helper, user/project/sequence factories
    db.ts         read-only postgres probes that confirm rows really landed
    fixtures.ts   nested guest-import payload builder
    setup.ts      readiness assertion and database lifecycle
  api/
    auth.test.ts
    guest.test.ts
    projects.test.ts
    storage.test.ts
    queue.test.ts
```

The database probes are deliberately read-only. These tests run against a database that holds
real data, so nothing truncates a table; assertions count rows by their known ids instead.

## Scripts

```bash
bun run dev              # local API with watch mode
bun run start            # run the API once
bun run worker:analysis  # BullMQ analysis worker (long-lived)
bun test                 # integration tests against a running API
bun run typecheck        # tsc --noEmit
bun run db:generate      # generate a migration from the schema
bun run db:migrate       # apply migrations
bun run db:studio        # Drizzle Studio
```

## Running under PM2 on the VPS

`ecosystem.config.cjs` runs both processes as one named set:

```bash
bun install --production
bun run db:migrate
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # then run the command it prints, so it survives a reboot
```

| Command | Effect |
| ------- | ------ |
| `pm2 status` | Both processes and their restart counts. |
| `pm2 logs gia-api` / `pm2 logs gia-worker` | Tail one process. |
| `pm2 reload gia-api` | Graceful handover; the API is stateless. |
| `pm2 restart gia-worker` | Sends SIGTERM so in-flight jobs drain first. |
| `pm2 monit` | CPU and memory against the restart thresholds. |

Logs land in `logs/`, which is gitignored.

Two settings in that file are load-bearing rather than cosmetic:

- **`kill_timeout: 120000` on the worker.** `SIGTERM` triggers `await worker.close()`, which
  waits for running analyses to finish. PM2's default timeout is 1.6s, and a SIGKILL at that
  point leaves the analysis row in `processing` until BullMQ's stalled-job checker re-queues it
  minutes later. Use `pm2 restart`, not `pm2 stop`, and do not shorten this without a matching
  change to the job timeout.
- **`instances: 1`, no clustering.** Bun does not share a listening socket across PM2 workers, so
  a cluster would start N processes competing for port 4000 with only one actually listening.

Secrets stay in `.env` (chmod 600), not in the ecosystem file. Bun does not overwrite variables
that already exist in `process.env`, so the `env` block there wins for operational settings and
`.env` supplies credentials.

If `pm2 start` reports the process as `errored` with no output, PM2 is not resolving the Bun
interpreter. Check `which bun`, and fall back to running the entrypoint directly with
`script: "bun"` plus `args: "run src/index.ts"`.
