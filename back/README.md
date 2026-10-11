# back

The API for **Gene Pilot**. Elysia + Drizzle ORM + PostgreSQL, running on Bun
next to Redis and MinIO on a single VPS (or against the local Docker stack,
see **Local stack**).

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

## Executors

An analysis runs through one of two executors; whichever one answered, the result lands in
`result_json` in the same flat shape (see **Result normalisation**):

- **Langflow** (primary). The worker POSTs to `<LANGFLOW_URL>/api/v1/run/<LANGFLOW_MAIN_FLOW_ID>`
  with `x-api-key: LANGFLOW_API_KEY` and the sequence + analysis type delivered through the
  `tweaks` of the flow's custom `BioAnalysisConnector`. `/run` is synchronous: it executes the
  graph and returns `{ outputs, session_id }`. The connector's report
  `{ user_question, analysis_results }` is extracted from the outputs.
- **Bio Service** (deterministic fallback). `POST <BIO_SERVICE_URL>/analyze` with
  `{ sequence, tools }`. Used when Langflow is disabled, unreachable, times out, or is
  misconfigured — a fallback that is deliberately broad, because a deterministic GC count is
  more useful than an error about a flow the user cannot see. Every fallback is logged.

When `LANGFLOW_INSIGHT_FLOW_ID` is set, the worker makes a second, best-effort call with the
connector's report and attaches the model's reply as `insight`. A failure there never fails
the analysis. See `langflow/README.md` for the two flows and the custom components.

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
- The frontend calls the API hostname from `NEXT_PUBLIC_API_URL` in `front/.env.local`.
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

The same trap has a local form, and it is easy to fall into. A browser treats `localhost` and
`127.0.0.1` as two **different sites**, not one host on two ports. So a page on
`http://localhost:3000` pointing at `http://127.0.0.1:4000` loses the cookie on every request even
though it looks like a loopback call to the same machine. Keep the hostname identical on both
sides — `http://localhost:4000`.

This failure is especially nasty in development, because `ALLOW_DEV_AUTH` catches the missing
cookie and signs the caller in as the shared dev user. Registration returns `201`, and every
later read comes back as `developer@local.test`, so it looks like sign-in works while all your
data lands on one shared account. On the VPS, where dev auth is off, the identical configuration
produces a `401` on every request instead. If sign-up appears to do nothing, compare the two
hostnames before anything else.

There is no serverless or edge deployment target. The database client speaks TCP through
`postgres.js`, and a TCP connection cannot be held by a request-scoped runtime, so the API
must be a long-lived process behind a hostname.

## Local stack

`docker-compose.local.yml` at the repo root starts Postgres, Redis, MinIO (with its bucket)
and the Bio Service on localhost — no `.env` file needed for the stack itself:

```bash
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml ps
docker compose -f docker-compose.local.yml down           # stop, keep data
docker compose -f docker-compose.local.yml down -v        # stop and delete data
```

Credentials are baked in and must match the local `back/.env` block:

| Service             | Endpoint                  | Credentials  |
| ------------------- | ------------------------- | ------------ |
| PostgreSQL          | `127.0.0.1:5432`          | `genepilot` / `genepilot`, db `gene_pilot` |
| Redis               | `127.0.0.1:6379`          | —            |
| MinIO               | `127.0.0.1:9000`, console `:9001` | `minioadmin` / `minioadmin` |
| Bio Service         | `127.0.0.1:8001`          | —            |

Then:

```bash
cp .env.example .env        # the example carries the ready-made local block
bun install
bun run db:migrate          # create the schema in the local Postgres
bun run dev                 # API
bun run worker:analysis     # worker, separate terminal
```

Langflow is optional locally (`LANGFLOW_ENABLED` defaults on, but an incomplete config falls
back to the Bio Service cleanly). Leave the `LANGFLOW_*` variables unset for a local run with
no AI interpretation.

## Environment

| Variable                      | Required | Purpose                                             |
| ----------------------------- | -------- | --------------------------------------------------- |
| `DATABASE_URL`                | yes      | Postgres connection string.                          |
| `AUTH_SECRET`                 | hosted   | HMAC key for session cookies. Min 32 chars.         |
| `S3_ENDPOINT`                 | storage  | S3-compatible endpoint, e.g. `http://127.0.0.1:9000` for MinIO. |
| `S3_BUCKET`                   | storage  | Bucket name for research files.                     |
| `S3_ACCESS_KEY_ID`            | storage  | Access key.                                          |
| `S3_SECRET_ACCESS_KEY`        | storage  | Secret key. Never leaves the server.                |
| `S3_REGION`                   | no       | Defaults to `us-east-1`.                            |
| `S3_FORCE_PATH_STYLE`         | no       | Defaults to path style, which MinIO requires.       |
| `REDIS_URL`                   | queue    | Redis connection string for the BullMQ queue.       |
| `ANALYSIS_QUEUE_NAME`         | no       | BullMQ queue name. **Unset in production.** Set it to a value no other host uses when a remote worker shares the same Redis, so local jobs stay on the local worker. |
| `QUEUE_ATTEMPTS`              | no       | Job retry attempts. Defaults to `3`.                |
| `WORKER_CONCURRENCY`          | no       | Concurrent analysis jobs. Defaults to `2`.           |
| `WORKER_JOB_TIMEOUT_MS`       | no       | How long a run may hold a slot before the worker hands on. Defaults to `30000`. |
| `WORKER_RECHECK_DELAY_MS`     | no       | Delay between re-check jobs. Defaults to `30000`.   |
| `WORKER_MAX_RECHECKS`         | no       | Upper bound on re-checks before a run is failed. Defaults to `10`. |
| `ENQUEUE_PORT`                | no       | Serve `POST /enqueue` from the analysis worker when set. |
| `QUEUE_SECRET`                | see note | Shared secret for the enqueue service (mandatory when `ENQUEUE_PORT` or `QUEUE_ENQUEUE_URL` is set). |
| `QUEUE_ENQUEUE_URL`           | no       | Base URL of a remote enqueue service. Optional split deployment. |
| `BIO_SERVICE_URL`             | no       | Base URL of the Bio Service. Analysis fails without it. |
| `BIO_SERVICE_TIMEOUT_MS`      | no       | Per-request timeout for the Bio Service call. Defaults to `60000`. |
| `LANGFLOW_URL`                | langflow | Base URL of Langflow.                                |
| `LANGFLOW_MAIN_FLOW_ID`       | langflow | Id of the "GenePilot Bio Connector" flow.            |
| `LANGFLOW_COMPONENT_NAME`     | no       | Component receiving the analysis type via tweaks. Defaults to `"Bio Analysis Connector"`. |
| `LANGFLOW_INSIGHT_FLOW_ID`    | no       | Id of the "GenePilot Insight Analyst" flow. Best-effort AI interpretation. |
| `LANGFLOW_API_KEY`            | langflow | Server-side only; never expose it to the browser.    |
| `LANGFLOW_TIMEOUT_MS`         | no       | Per-run timeout. Defaults to `120000`.               |
| `LANGFLOW_ENABLED`            | no       | Kill switch; `"false"` routes every analysis straight to the Bio Service. Defaults to `true`. |
| `LANGFLOW_CALLBACK_ENABLED`   | no       | Deferred: stays `"false"` and the callback endpoint returns `503`. |
| `LANGFLOW_CALLBACK_SECRET`    | no       | Reserved for the same deferred callback model.       |
| `LANGFLOW_FLOW_PROBE`         | no       | `"1"` makes `/health/dependencies` also fetch the configured flow, proving id + key. |
| `PORT` / `HOST`               | no       | API port (default `4000`) and bind address (default `127.0.0.1`). |
| `CORS_ORIGINS`                | hosted   | Comma-separated exact frontend origins. No wildcard. |
| `COOKIE_SAME_SITE`            | no       | `none` when the API is on a different site than the frontend. Defaults to `lax`. |
| `DEPLOY_RUNTIME`              | no       | `vps` forces hosted behaviour without `NODE_ENV`.    |
| `ALLOW_DEV_AUTH`              | no       | Enables the shared local identity outside development. |
| `DEV_USER_EMAIL`              | no       | Email of the local dev identity. Default `developer@local.test`. |
| `SESSION_TTL_SECONDS`         | no       | Session lifetime. Defaults to 7 days.                |
| `PBKDF2_ITERATIONS`           | no       | Password hashing cost, 1000–2000000. Defaults to `210000`. |
| `DISPOSABLE_CHECK_ENABLED`    | no       | `"true"` rejects registration (and guest claims) on known disposable/temp-mail domains. Fail-open when unset. |
| `ANALYSIS_ALLOWED_TYPES`      | no       | Comma-separated allowlist for `POST /analyses`. Defaults to the Bio tool set (see **Analysis types**). |
| `RATE_LIMIT_*`                | no       | One rule per scope; `0` disables. See **Rate limiting**. |
| `TRUSTED_IP_HEADER`           | hosted   | Header carrying the real client address, e.g. `cf-connecting-ip` behind cloudflared. Required by the login/register rules. |
| `RATE_LIMIT_FALLBACK_TO_UNKNOWN` | no    | `"1"` accepts the shared bucket when no client address is available. Convenient locally, wrong in production. |

Credentials belong in `back/.env` locally and in the process environment on the VPS. They are
not bundled into any build output, because there is no build step.

A production deployment without `AUTH_SECRET` is not "insecurely open" — it fails closed with
`401 UNAUTHENTICATED` on every data route.

## Authentication

The API issues `gia_session` cookies; there are also guest sessions and a guest-to-account
claim:

- `POST /auth/register` and `POST /auth/login` set a `gia_session` cookie: `HttpOnly`, `SameSite`
  from `COOKIE_SAME_SITE`, and `Secure` in production. The token is `v1.<payload>.<HMAC-SHA-256>`
  and is verified statelessly.
- `POST /auth/guest` creates a guest principal and its own cookie; the guest's work is kept
  keyed to a client-held guest token, and `POST /guest/claim` moves it into a new account.
- Passwords are hashed with PBKDF2-HMAC-SHA-512 (210k iterations by default) through Web Crypto.
- `POST /auth/logout` expires the cookie. `GET /auth/me` reports the current account.
- Login answers `Invalid email or password.` for both an unknown email and a wrong password,
  and spends the same PBKDF2 work either way.
- **Local development:** with `ALLOW_DEV_AUTH=true` (or dev without `NODE_ENV=production`), a
  session is used when present, otherwise the shared `DEV_USER_EMAIL` identity is upserted.
- **Production:** the shared identity is only reachable when `ALLOW_DEV_AUTH` is explicitly
  enabled. Otherwise every data route returns `401 UNAUTHENTICATED`.

Because production cookies are `Secure`, the API must be reached over HTTPS. Put TLS in front of
it, or expose it through a tunnel that terminates TLS, before pointing a browser at it.

Sessions are stateless, so a successful signature check returns the user id without confirming
the account still exists. Every route then re-reads the owned row, so access stays scoped;
deleting an account should also rotate `AUTH_SECRET` to cut off outstanding cookies.

Ownership is always resolved from a server-side record. The API never accepts a user id, email,
or role from the client, `object_key` can only be set by the storage endpoints, and
`queue_job_id` / analysis `status` are worker-owned. Supplying any of them is rejected with `422`.

## Rate limiting

Fixed-window counters held in Redis, shared by every API process so the limit is the configured
one rather than that times the number of instances. The limiter fails closed: if Redis is
unreachable it answers `503 RATE_LIMIT_UNAVAILABLE` instead of waving traffic through.

The rule names come from the `RATE_LIMITS` table in `src/lib/rate-limit.ts`; set any
`RATE_LIMIT_*` to `0` to disable that rule and tune with the matching
`RATE_LIMIT_*_WINDOW_SECONDS`. Authenticated scopes are keyed on the **session-derived user id**,
never on anything the caller supplied. The client-address scopes (login, register, guest) key on
`TRUSTED_IP_HEADER` when set, and return `503` for an unattributable caller otherwise — unless
`RATE_LIMIT_FALLBACK_TO_UNKNOWN=1` collapses everyone into one shared bucket, which is convenient
locally and wrong in production.

| Scope | Keyed by | Default | Why |
| ----- | -------- | ------- | --- |
| `auth.login` | client | 10 / 15m | Each attempt costs a 210k-iteration hash. |
| `auth.register` | client | 5 / 1h | One address creating many accounts. |
| `auth.guest` | client | 10 / 1h | Each guest costs a row and a cookie. |
| `analysis.queue` | session user | 30 / 1h | Each is a row, a Redis entry, and a job. |
| `analysis.status_poll` | session user | 240 / 1m | The frontend polls status every ~2s while a run is active; this is the ceiling, the short-TTL Redis cache is the real flood defence. |
| `storage.presign` | session user | 60 / 1h | Writes a `sequences` row before upload. |
| `storage.upload` | session user | 30 / 1h | Real bytes to object storage. |
| `storage.mutate` | session user | 60 / 1h | Deletes, and the objects behind them. |

`429` responses carry a `Retry-After` header and `details.retryAfter` in the body. The window is
fixed, not sliding: retries inside a window do not extend it.

## Analysis types

`POST /analyses` validates `analysisType` against a closed set — an unknown type is a `422`,
raised before any row is written. The value is lowercased, so `GC_Content` and `gc_content` are
one analysis.

Defaults live in `src/lib/analysis-types.ts` and mirror the Bio Service's `available_tools`:

```
gc_content                  sequence_statistics
at_content                  detect_sequence_type
composition                 extract_sequence_features
orfs                        validate_sequence
translate                   parse_fasta
```

`at_content` is derived (AT% = A% + T%) off `calculate_nucleotide_composition`. Override with
`ANALYSIS_ALLOWED_TYPES=gc_content,orfs,translate`. An empty or malformed value falls back to
the defaults rather than rejecting everything, so a missing config cannot end up wide open.

## Result normalisation

Both executors return differently wrapped payloads, so `src/lib/normalize-result.ts` rewrites
either into one flat shape before it is stored as `result_json`:

- Bio Service `{ source, results: { <tool>: {...} } }` is flattened per tool.
- Langflow outputs are scanned for the connector's `{ user_question, analysis_results }` report;
  anything that is not JSON becomes `insight`.

Known tools are lifted to named fields (`gc_content`, `composition`, `orfs`, `translation`,
`sequence_statistics`, `sequence_type`, `sequence_features`, `validation`, `fasta`);
`parse_fasta` records keep only `id`, `length` and `description` — the echoed residue text is
dropped so a parsed genome does not inline megabytes into the row. Unrecognised tools pass
through under their service names. `source` is preserved so logs and tests can tell which
executor ran. See `front/lib/result.ts` for the reader that consumes this contract, and
`bun test __tests__/lib/normalize-result.test.ts` for the pinned shapes.

## Importing guest history

`POST /guest/import` moves a guest's IndexedDB history (sent from the client by guest token id)
into the authenticated account, so registering does not throw away prior guest work.

- Requires a session: the payload is only accepted for the authenticated account.
- Send the UUIDs the browser already assigned. Re-running the import is safe: every insert is
  `on conflict do nothing`.
- Each project commits in its own transaction, so one bad record cannot leave a half-imported
  project; the error names the failing index, which makes a targeted retry safe.
- `userId`, `objectKey`, and `queueJobId` are rejected with `422`. An imported analysis can only
  be `completed` or `failed`; anything else lands as `failed`.
- Bounded at 50 projects, 200 sequences per project, 100 analyses per sequence, 500
  conversations per project, 64 KB per analysis result.

## Endpoints

| Method | Path                                  | Description                                        |
| ------ | ------------------------------------- | --------------------------------------------------- |
| GET    | `/health`                             | Liveness plus a database connectivity probe.       |
| GET    | `/health/dependencies`                | Executor readiness (Bio, Langflow, queue).         |
| POST   | `/auth/register`                      | Create an account and set the session cookie.      |
| POST   | `/auth/login`                         | Set the session cookie.                            |
| POST   | `/auth/guest`                         | Create a guest principal and set its cookie.       |
| POST   | `/guest/claim`                        | Move guest work into the signed-in account.        |
| POST   | `/auth/logout`                        | Expire the session cookie.                         |
| GET    | `/auth/me`                            | Current account, or `401`.                         |
| POST   | `/guest/import`                       | Import guest IndexedDB history (session required). |
| POST   | `/projects`                           | Create a project.                                  |
| GET    | `/projects`                           | List owned projects.                               |
| GET    | `/projects/:id`                       | Fetch one owned project.                           |
| POST   | `/projects/:id/sequences`             | Register a metadata-only sequence (pasted text).   |
| GET    | `/projects/:id/sequences`             | List sequences in a project.                       |
| DELETE | `/projects/:id/sequences/:sequenceId` | Delete a sequence: drops its jobs, deletes the object best-effort, row delete cascades the analyses. |
| POST   | `/analyses`                           | Queue an analysis; returns `202` immediately.      |
| GET    | `/analyses/:id`                       | Fetch one analysis.                                |
| GET    | `/analyses/:id/status`                | Poll analysis status (cached, short TTL).          |
| DELETE | `/analyses/:id`                       | Delete an analysis, discarding its queued job.     |
| GET    | `/queue/status`                       | Queue depth and worker reachability (public).      |
| POST   | `/conversations`                      | Append a conversation message.                     |
| GET    | `/conversations/:projectId`           | List conversation messages for a project.          |
| GET    | `/storage/health`                     | Bucket reachability probe (bucket name withheld from anonymous callers). |
| POST   | `/storage/upload`                     | Proxy a multipart upload through the backend (≤ 25 MiB). The canonical upload path. |
| GET    | `/storage/download/*`                 | Stream an owned object through the backend for download. The canonical download path. |
| POST   | `/storage/presign`                    | Legacy: mint a presigned `PUT` and register the sequence. |
| GET    | `/storage/*`                          | Legacy: mint a presigned `GET` for an owned object. |
| DELETE | `/storage/*`                          | Legacy: delete an owned object and detach it from its sequence. |

Successful responses are `{ "data": ... }`. Errors are `{ "error": { "code", "message", "details"? } }`
with `404` for missing or unowned resources, `413` for oversized bodies or files, `422` for
validation failures, `429` when a rate limit is hit, `503` when the queue, rate limiter or object
storage is unavailable, and `401` when auth is required.

## Uploading and downloading a research file

The browser never talks to MinIO. Presigned URLs embed the loopback endpoint the backend sees
(`S3_ENDPOINT` is `http://127.0.0.1:9000` inside the host) and SigV4 covers that host, so a URL
minted for the server is useless to a browser — which is why upload and download are both
proxied through the API:

```text
POST /storage/upload            multipart/form-data: projectId, filename, file, description?
  -> 201 { sequenceId, objectKey, sizeBytes }

GET /storage/download/<objectKey>   (session required, ownership checked)
  -> 200 stream, content-disposition: attachment
```

`POST /storage/upload` is capped at 25 MiB (rejected on `Content-Length` before the body is
buffered, with slack for multipart framing). The sequence row is created by the upload itself,
so a failed request leaves no orphan row. Delete a file-backed sequence with
`DELETE /projects/:id/sequences/:sequenceId`, which drops its analyses' jobs, deletes the object
best-effort, and removes the row (analyses cascade).

The legacy `presign` / `GET /storage/*` / `DELETE /storage/*` routes are still registered — new
code should not use them, and the frontend no longer does.

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
`failed` rather than left in `queued`; the response carries `details.analysisId`. If the queue
is not configured at all, the request fails fast with `503 QUEUE_NOT_CONFIGURED` and no row is
created.

The consumer is a long-lived process, started the same way as the API:

```bash
bun run worker:analysis
```

Queue name: `ANALYSIS_QUEUE` defaults to `genomic-analysis`. Set `ANALYSIS_QUEUE_NAME` to a
different value in local `back/.env` when a remote worker shares the same Redis — BullMQ serves
the longest-waiting blocked worker, so a stale host wins every job. **Never set it in
production.**

A run that outlives `WORKER_JOB_TIMEOUT_MS` stops holding a worker slot and is given back to a
delayed re-check job (`WORKER_RECHECK_DELAY_MS`), bounded by `WORKER_MAX_RECHECKS`, so a dead
Langflow run fails instead of pinning a worker forever.

If the API and worker are ever split across machines, the worker can host a small enqueue
service and the API posts to it instead:

```bash
# on the worker
REDIS_URL=redis://127.0.0.1:6379 QUEUE_SECRET=... ENQUEUE_PORT=4010 bun run worker:analysis

# on the API
QUEUE_ENQUEUE_URL=http://127.0.0.1:4010 QUEUE_SECRET=... bun run src/index.ts
```

```text
API     -> POST <QUEUE_ENQUEUE_URL>/enqueue   (x-queue-secret: QUEUE_SECRET)
Service -> BullMQ enqueue -> Redis
Worker  -> BullMQ consumer -> executor (Langflow, falling back to Bio)
```

## Tests

Unit tests (`__tests__/lib/`) run without any services. The API tests (`__tests__/api/`) run
against a real, already-running API plus the real database, Redis and MinIO. Start the API in
production mode first, on a port that is not your dev server:

```bash
NODE_ENV=production PORT=4100 RATE_LIMIT_AUTH_REGISTER=0 RATE_LIMIT_AUTH_LOGIN=0 \
RATE_LIMIT_AUTH_GUEST=0 RATE_LIMIT_ANALYSIS_QUEUE=0 RATE_LIMIT_ANALYSIS_STATUS_POLL=0 \
RATE_LIMIT_STORAGE_PRESIGN=0 RATE_LIMIT_STORAGE_UPLOAD=0 RATE_LIMIT_STORAGE_MUTATE=0 \
  bun run src/index.ts
```

`NODE_ENV=production` matters: it disables the development identity fallback, so the fail-closed
auth tests actually exercise signature rejection. `RATE_LIMIT_*=0` skips a rule entirely,
including the caller-identity requirement, so the tests do not need `TRUSTED_IP_HEADER` set.

Then run the suite:

```bash
TEST_API_URL=http://127.0.0.1:4100 bun test
```

With the local docker stack up, `bun test __tests__/lib/` is green with no other setup.

## Scripts

```bash
bun run dev              # local API with watch mode
bun run start            # run the API once
bun run worker:analysis  # BullMQ analysis worker (long-lived)
bun test                 # test suites (see Tests)
bun run typecheck        # tsc --noEmit
bun run db:generate      # generate a migration from the schema
bun run db:migrate       # apply migrations
bun run db:studio        # Drizzle Studio
bun run scripts/check-dependencies.ts   # probe Bio/Langflow/queue readiness
bun run scripts/check-poll-budget.ts    # rate-limit budget sanity check
```

There are also read-only operational scripts in `scripts/`: `backfill-normalize-results.ts`
(rewrites existing rows to the flat `result_json` contract), `smoke-bio-executor.ts` /
`smoke-langflow-executor.ts`, `verify-sequence-content.ts`, and `db-backup.ts`.

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
`script: "bun"` plus `args: "run src/index.ts"`. Production env is documented in the gitignored
`.env.production` (values land in the process environment on the VPS).