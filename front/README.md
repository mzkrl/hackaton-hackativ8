# front

Next.js 16 App Router client for Genomic Insight Agent. Static landing page at `/`, the
interactive workspace at `/workspace`.

## Running it

```bash
bun install
bun run dev          # http://localhost:3000
```

One environment variable, read at build time:

| Variable             | Required | Purpose                                                        |
| -------------------- | -------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | yes      | Base URL of the `back/` API, e.g. `http://127.0.0.1:4000`. |

Copy `.env.example` to `.env.local`. The value is inlined into the client bundle at build
time, so it is a constant for the life of the bundle and changing it needs a rebuild, not a
reload. Left unset, every request throws `API_NOT_CONFIGURED` and says so.

For the API to accept the session cookie, `CORS_ORIGINS` on the backend has to list this
origin exactly — `http://localhost:3000` for the dev server. It cannot be `*`, because the
browser refuses a wildcard on a credentialed request.

## Routes

| Path         | Rendering       | What it is                                                        |
| ------------ | --------------- | ----------------------------------------------------------------- |
| `/`          | Static          | Landing page. Prerendered, ships no component JavaScript.          |
| `/workspace` | Client, runtime | Sign-in gate and the workspace. Resolves the session on the client. |

`/` is a Server Component with no client component in its tree, which is why it can be
prerendered. `/workspace` cannot be: the session is an `HttpOnly` cookie, so "am I signed in"
is not answerable during a server render and has to be asked of the API from the browser.
The landing page was moved off `/` so a visitor does not have to sit through that wait
before seeing anything.

The split is measurable — the Recharts bundle is only referenced by `/workspace`:

```bash
curl -s http://localhost:3000/          | rg -o '/_next/static/chunks/[^"]+' | sort -u
curl -s http://localhost:3000/workspace | rg -o '/_next/static/chunks/[^"]+' | sort -u
```

## Layout

```
app/
  layout.tsx        html shell, title template, light/dark tokens
  page.tsx          landing page (Server Component)
  workspace/page.tsx the client half
components/
  workspace.tsx     session gate, project picker, and the owner of all server state
  sequence-import.tsx  three import routes: presigned PUT, proxied upload, pasted text
  sequence-board.tsx   sequence rows and analysis submission
  analysis-board.tsx   queued and finished analyses
  analysis-result.tsx  renders a finished result
  composition-chart.tsx Recharts, client-only
  notes-panel.tsx      per-project message log
  auth-view.tsx        sign in / sign up
  primitives.tsx       shared layout, buttons, fields, status badges
lib/
  api.ts            transport, ApiRequestError, error classification
  genomics.ts       one typed wrapper per endpoint
  sequence.ts       format, length and hash for metadata-only sequence registration
  result.ts         tolerant reader for analyses.result_json
scripts/
  check-result.ts   parser checks, see below
```

`lib/` is layered on purpose. `api.ts` owns transport and knows nothing about genomics;
`genomics.ts` owns endpoint contracts and knows nothing about React; `sequence.ts` and
`result.ts` own pure derivations. A component imports the layer it needs and no deeper.

## Server state

`workspace.tsx` is the only owner of server state. Children receive data as props and report
back through callbacks, so there is one `useEffect` per concern instead of a fetch inside
every panel. In particular the analysis board cannot register a new tracked id itself — it
does not know which project is selected — so it reports the id upward.

Project selection is derived rather than stored:

```ts
const activeId = selectedId ?? projects[0]?.id ?? null;
```

The alternative, a "pick the first project" effect, cascades an extra render on mount.

## Reading analysis results

`analyses.result_json` is an untyped `jsonb` column written by a Bio service that does not
exist yet, so `lib/result.ts` reads it field by field instead of casting it to an interface.
Every field is optional, wrong types are dropped rather than thrown on, and unrecognised keys
are still shown under "Other fields" — a payload from a service that has not shipped yet
should degrade to "here is the raw data", not to a blank panel.

Keys are accepted in both `camelCase` and `snake_case`. The snake_case aliases are not
guesswork: the Bio service is FastAPI, and a Python service emits snake_case by convention.
The plan's own BLAST example writes `e_value` and `bit_score`.

One distinction the code keeps: if the payload omits `gc_content` but carries a composition,
the percentage is derived client-side and labelled as derived. A number the client computed
must not be presented as one the tool reported.

## Checks

```bash
bun run lint           # eslint
bunx tsc --noEmit      # types
bun run check:result   # lib/result.ts against the documented payloads
```

`check:result` is a plain script, not a test framework — this project has no JS test runner,
and adding one for a single pure module is not worth the dependency. It exits non-zero so CI
can call it later. It earns its place because the payload shape is still a contract on paper:
when the Bio service lands with a different shape, this is what says so.

## Deployment

`bun run deploy` is **currently broken** and should not be run. It calls `next-on-pages`, whose
peer range is `next: ">=14.3.0 && <=15.5.2"` while this project is on `16.3.6`; the tool has
also been deprecated by Cloudflare. The working replacement is `@opennextjs/cloudflare`, which
matches how `back/` is actually deployed: a long-lived process behind a hostname, never a
serverless function. Migrating the script is a separate change.

Deploying the frontend separately from the API is fine. It is a static site plus one client
bundle; all the stateful work is in `back/`, which stays on its own host.

## Notes for reviewers

- Nothing in this directory talks to anything but the `back/` API, and it does so only through
  `lib/api.ts`.
- The workspace has been written against the route handlers in `back/src/routes/` but has never
  been run against a live API, because the backend cannot start on the development machine
  (no Docker). The signed-out and error paths are the only ones actually executed. The
  fragile parts are the presigned upload preflight, status polling, `SameSite` cookie
  behaviour across sites, and rendering a finished result.
- The result charts, the composition table and the notes panel are research and education
  surfaces. Nothing here is a clinical or diagnostic tool, and the UI says so wherever a
  result is displayed.
