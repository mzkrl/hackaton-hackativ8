# front

Next.js 16 App Router client for **Gene Pilot**. The home screen at `/`, the
interactive workspace at `/workspace`.

> **Naming.** This directory was previously written against "Genomic Insight Agent", and
> `back/README.md` still uses that name. The frontend now ships **Gene Pilot** because the
> design brief specifies it. It has *not* been renamed on the backend — the API envelope,
> routes and job types are untouched. If the rename is only meant to be visual, nothing
> outside `app/` and `components/` needs to change.

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
| `/`          | Static          | Home screen. Prerendered; ships one small client component.      |
| `/workspace` | Client, runtime | Sign-in gate and the workspace. Resolves the session on the client. |
| `/icon`      | Generated       | The mark, drawn in `app/icon.tsx` via `next/og`.                  |

`/` is a Server Component whose only client leaf is `HomeMain` — client for two reasons,
both about owning a control's own state (the typed text, and the router the drop zone
needs), neither about data. `/workspace` cannot be a Server Component at all: the session is
an `HttpOnly` cookie, so "am I signed in" is not answerable during a server render and has
to be asked of the API from the browser. The interactive screen was moved off `/` so a
visitor does not have to sit through that wait before seeing anything.

The split is measurable — the Recharts bundle is only referenced by `/workspace`:

```bash
curl -s http://localhost:3000/          | rg -o '/_next/static/chunks/[^"]+' | sort -u
curl -s http://localhost:3000/workspace | rg -o '/_next/static/chunks/[^"]+' | sort -u
```

## Layout

```
app/
  layout.tsx        html shell, Nunito wiring, metadata, cream themeColor
  page.tsx          home screen (Server Component): sidebar slots + the column
  icon.tsx          generated favicon, same helix drawing as brand.tsx
  not-found.tsx     404, rendered inside the root layout
  workspace/page.tsx the client half
components/
  app-shell.tsx     the 274px sidebar / mobile top bar, wraps every page
  home-main.tsx     the home column: headline, drop zone, composer (client)
  brand.tsx         ring-and-helix mark, stacked wordmark lockup, the icon set
  chat-bar.tsx      the ask input, filled and plain variants
  upload-target.tsx the drop zone; hands over a FileList, never reads it
  workspace.tsx     session gate, project picker, and the owner of all server state
  sequence-import.tsx  three import routes: presigned PUT, proxied upload, pasted text
  sequence-board.tsx   sequence rows and analysis submission
  analysis-board.tsx   queued and finished analyses
  analysis-result.tsx  renders a finished result
  composition-chart.tsx Recharts, client-only
  notes-panel.tsx      per-project message log
  auth-view.tsx        sign in / sign up
  primitives.tsx       Panel, Empty, Notice, Button, Field, StatusBadge, Skeleton
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

## Design system

### The palette

Five colours, verbatim, from the brief. Nothing here was adjusted to make it work:

| Token             | Hex       | Role                                                          |
| ----------------- | --------- | ------------------------------------------------------------- |
| `--color-cream`   | `#FFEBCB` | **the page background**, and text only on maroon or forest     |
| `--color-forest`  | `#023436` | the default text colour, the Login pill                       |
| `--color-maroon`  | `#601700` | the drop zone rule, the composer bar, accent buttons          |
| `--color-teal`    | `#21A179` | fills only: the send circle, the mark's ring                   |
| `--color-dust`    | `#A76660` | secondary rules and icon strokes                              |

Two rules govern the whole app, and they are the reason this page is not full of
special cases:

1. **Cream is the page.** `#023436` is never a page or container background.
2. **Cream text only ever sits on a filled maroon or forest element** — the composer bar,
   the Login pill, the primary buttons, the maroon bubbles. Everywhere else the text is
   forest on cream.

Every pairing the brief asks for was measured against the surface it actually lands on.
WCAG wants 4.5:1 for body text and 3:1 for a UI stroke or an icon:

| Pair                        | Ratio    | Verdict                                       |
| --------------------------- | -------- | --------------------------------------------- |
| forest on `--color-cream`   | 11.63:1  | passes — all body text, the H1               |
| maroon on `--color-cream`   | 11.11:1  | passes — drop zone rule and its caption       |
| cream on `--color-maroon`   | 11.11:1  | passes — composer text, the paperclip        |
| cream on `--color-forest`   | 11.63:1  | passes — Login pill, primary button           |
| `--color-dust` on cream     | 3.82:1   | passes — dashed rules, icon strokes only      |
| teal on `--color-maroon`    | 3.97:1   | passes — the send button's edge (3:1 floor)   |
| white on `--color-teal`     | 3.26:1   | passes — the send arrow (3:1 floor)           |
| `--color-teal` on cream     | 2.80:1   | **fails** — never a border or a focus ring    |
| **cream on `--color-teal`** | **2.80:1** | **fails** — see the one deviation below      |

### The one place this departs from the brief

The brief asks for **cream** on the teal send button. That measures **2.80:1**, under the
3:1 a non-text glyph owes, so the arrow is **white** at 3.26:1. `teal-ink` on teal is
1.53:1 and is worse than nothing. The bar's own text stays cream — there it has 11.11:1 —
so the two creams in that one component are deliberately different colours. Everything else
in the brief is implemented literally.

One shade is derived, darkened along the *same hue* until it cleared the 3:1 floor. No new
colour was invented:

| Derived            | Hex       | From      | Ratio            | Used for                                     |
| ------------------ | --------- | --------- | ---------------- | -------------------------------------------- |
| `--color-teal-ink` | `#157F5A` | teal      | 4.27:1 cream, 4.87:1 paper | focus rings, active strokes, muted success |
| `--color-muted`    | `#6F6250` | warm grey | 5.09:1 cream    | secondary text                               |
| `--color-rule`     | `rgba(167,109,96,.6)` | dust | 2.04:1 composited | the sidebar's hairline                  |

The rules that follow, which a future change should not quietly undo:

- **`forest` fills the primary button, `maroon` fills the accent.** Never teal. A filled teal
  button lands at 2.80:1 with cream text, which is under even the 3:1 floor an icon owes.
- **Teal is a mark colour and one button.** It is the mark's ring and the composer's send
  circle. It is never a border, a focus ring or a text colour — `teal-ink` is the teal that
  does work.
- **`dust` is the only secondary allowed to draw a line.** `--color-line-strong` is a divider
  between two panels of the same surface, not information, so it only has to be quiet; a
  dashed rule that *is* information has to clear 3:1, and `#D9C6A2` does not at 1.64:1.
- **Maroon draws the drop zone and fills the composer.** Both are the brief's `#601700`, at
  11.11:1 on cream, so nothing had to be substituted.

### Light-only, enforced in one line

The app has one theme. `globals.css` redefines Tailwind's `dark:` variant away from its
default `prefers-color-scheme: dark` media query:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

**Leave that line in.** Without it, `dark:bg-night` on any wrapper wins over the cream on
`html, body` and a visitor whose OS is set to dark gets a dark teal page — which is exactly
the bug it exists to prevent. The `dark:` classes themselves still compile but can never
match; stripping them is a separate mechanical pass, not part of a fix.

### The sidebar is part of the design

The brief describes a 274px sidebar pinned to the viewport, separated from the main area by
one hairline and nothing else — there is no frame and no second surface, because the page
background *is* cream. That lives in `app-shell.tsx`, not in the root layout, because it is
a property of *the app* and both routes share it.

Three things follow from it that are worth knowing before editing:

- **The sidebar is `h-screen` and `<main>` scrolls, not the page.** The `overflow-y-auto` on
  `<main>` is load-bearing: without it a long analysis list scrolls the sidebar's Settings
  row off the bottom of the screen, which is the one thing a sidebar must not do.
- **Dividers are direct children of the `<aside>` with no padding**, while the content they
  separate sits in its own padded block. That is what makes a rule span all 274px instead of
  stopping at the text column.
- **`min-w-0` on every flex child.** A flex item defaults to `min-width: auto` and refuses to
  shrink below its content, so one long unbroken string would push the sidebar off the left
  edge instead of wrapping. This is the class that makes "no horizontal overflow" true
  rather than nearly true.

### Warm neutrals, not grey

There is no grey scale in this palette, and borrowing Tailwind's would be wrong: a neutral
grey next to this cream reads as dirt. So the surfaces are warm neutrals mixed from the
palette — `--color-paper` (raised panels), `--color-shell` (inset areas),
`--color-line` (hairline), `--color-line-strong` (emphasised). The whole app stays one
temperature.

### Base identity is not brand

The A/T/G/C colours in the composition chart are the SnapGene / Benchling / Biopython
convention: A green, T red, G blue, C amber. They are deliberately **not** the brand
palette. Brand teal is itself a green, and a palette-derived "adenine" would be
indistinguishable from a decorative accent. These four are semantics and they sit *beside*
the brand, not inside it.

### Type

One family, self-hosted through `next/font`, at exactly the four weights the brief names:

| Variable      | Family | Weights          | Job                                                                                        |
| ------------- | ------ | ---------------- | ----------------------------------------------------------------------------------------- |
| `--font-sans` | Nunito | 400 600 700 800  | everything. This product has no serif in it and no second family                         |

| Weight | Used for                                     |
| ------ | -------------------------------------------- |
| 400    | body copy                                     |
| 600    | composer placeholder, emphasis inside a paragraph |
| 700    | the sidebar title, the logo, the Login button |
| 800    | the home headline                              |

They are listed explicitly rather than left variable. Nunito ships a full weight axis, and
asking for it wholesale would put every weight the design never uses into the self-hosted
subset — roughly a hundred kilobytes of font for four faces. `weight` also makes the brief's
hierarchy greppable: if a weight is not in `layout.tsx`, it is not available.

No mono family is loaded. A sequence, a count and an accession are the one place the OS
monospace is already the right answer, so `--font-mono` is a plain system stack. Nunito is
applied on `<body>` and handed to Tailwind as `sans`.

`--font-display` is still defined, as an alias for the sans stack rather than a second
family. The call sites were written when the heading *was* a serif, and renaming every one
of them to restate that it is not would be churn for no change in what renders.

The scale, and where each step is used:

| Step           | Treatment                                                        |
| -------------- | ---------------------------------------------------------------- |
| Home H1        | `font-display` 34px, `800`, `text-balance` — the brief's own size |
| Page H2        | `font-display` 15–18px, `600`                                   |
| Panel title    | `font-display` 15px, `600`                                      |
| Body           | `font-sans` `sm`/`base`, `leading-relaxed`                      |
| Sidebar label  | `font-sans` 13px, `600`                                         |
| Caption        | `font-sans` 11–13px, `--color-muted`                            |
| Data           | `font-mono`, tabular figures                                     |
| Wordmark       | all-caps, `700`, `tracking-[0.14em]` — Nunito's rounded counters need the air |

### Where this departs from the brief, and why

There is exactly one deviation, and it is the send arrow's colour (cream → white, because
cream on teal is 2.80:1). Every other number in the brief is implemented as written,
including the sizes that a designer might otherwise talk up:

| Brief            | Used    | Note                                    |
| ---------------- | ------- | --------------------------------------- |
| H1 34px / 800    | as spec |                                         |
| drop zone 500×238 | as spec | fixed, so wrapping text never resizes it |
| composer 558px   | as spec | `max-w-full` below 558 for phones        |
| send circle 34px | as spec | 3.97:1 against the maroon bar            |
| "RESEARCH TOOL" 7px | as spec | 0.35em tracking                          |
| sidebar 274px    | as spec |                                         |
| login pill 41px  | as spec | `w-full`, so it can never be clipped     |

The two fixed widths carry `max-w-full`. At 1440 the main area is 1166px after the sidebar,
so 500 and 558 fit with room to spare and the numbers are exactly the brief's; below that
they give way, which is what keeps a 360px phone from overflowing.

### Everything else

- **Borders, not shadows, carry separation.** Panels are
  `rounded-xl border border-line bg-paper`. The brief rules out excessive shadows, and none
  are needed: the sidebar's `rgba(167,109,96,.6)` hairline is enough to separate two regions
  of the same cream, because it is a rule and not an ambiguous edge.
- **No gradient heroes, no blurred orbs, no glassmorphism, no grid backdrops.** The home
  screen is one centred column, because that is what the design specifies — and a sparse
  screen only works if the one thing on it is unmistakable.
- **Nothing on the home screen is absolutely positioned.** Every gap is a `margin-*` on the
  block below it, so the four blocks cannot overlap and cannot escape their box. That is the
  whole reason the drop zone's caption stays inside it.
- **Every SVG carries explicit `width` and `height` attributes and `shrink-0`.** The size
  prop becomes a literal attribute pair, so a row of labels can never squeeze or stretch an
  icon. This is a house rule across the whole set, not just the two icons the brief names.
- **Motion only where state is genuinely moving.** A queued or processing analysis gets a
  pulsing dot, because that row really is changing underneath the reader. Loading waits and
  drag-over get a state change, not an animation. Nothing loops, and
  `prefers-reduced-motion` collapses all of it.
- **Two layouts from one shell.** `app-shell.tsx` is a 274px sidebar above `md` (768px) and
  a full-bleed single column with a compact top bar below it. It does not collapse into a
  disclosure — every action that appears in one layout appears in the other, including
  Settings and sign-out.
- **A control that cannot work says so.** Settings is in the design and has no route, so it
  renders as a `<span>` with `aria-disabled` and a hover note, rather than a live-looking
  button that silently swallows the click. `+ New analysis` is a menu row rather than a
  filled button, because a 226px-wide filled forest button is a wall in a 274px sidebar.

### Extending it

Adding a semantic colour: prefer a token from the table above. If a genuinely new one is
needed, check it against `--color-cream` first, and keep it clear of the six brief colours -
those are load-bearing in every screenshot anyone takes of this app. Status and severity
colours (`STATUS_TONES` in `primitives.tsx`, the `tones` map in `Notice`) are semantics
rather than brand: a failure has to read as a failure to someone who has not learned the
palette, which is why they are amber, red and teal rather than brand hues.

Note that Tailwind only emits a `@theme` variable once something references it. All six
brief colours are live in `globals.css` and each one is currently used, so they all appear
in the compiled CSS - but a token that nothing uses will silently vanish from the build
rather than sitting there waiting.

Adding a loading state: use `Skeleton` or `SkeletonRows` from `primitives.tsx` with the
shape the real content will have. Do not add a `"Loading…"` string — a placeholder that
changes the layout when content arrives is worse than a blank one.

## Division of labour

This directory is the presentation layer, and it is the only part of it that is finished.
The split is deliberate and should stay visible:

| Owned here (frontend)                          | Owned elsewhere                              |
| ---------------------------------------------- | -------------------------------------------- |
| Layout, typography, colour, spacing, light-only enforcement | Endpoint contracts and their enforcement      |
| Responsive behaviour, web and mobile           | Auth, session issuance, ownership checks      |
| Loading, empty, error and pending *presentation* | Which state is real, and when it changes   |
| Rendering whatever shape `result_json` arrives in | Producing that payload (Bio service)      |
| Copy, disclaimers, scientific wording          | The science: Biopython, BLAST, NCBI          |

Two consequences for anyone editing this directory:

- **A component may assume nothing about the backend.** `result_json` is untyped and the
  Bio service has not shipped; the reader is written to degrade, not to throw.
- **Presentation must not decide truth.** The reported/derived distinction on `gc_content`
  is the rule: a number this code computed is never rendered as one a tool reported. That
  applies to any field added later.

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
- **Open mismatch: the spec is guest-first, this workspace is not.** The development plan makes
  login optional — "authentication is not a prerequisite for using the basic tools". The home
  screen's own copy is the honest description ("You need to login first to save your recent
  analysis" implies you can still work), but `workspace.tsx` still
  resolves the session first and renders `AuthView` for anyone anonymous, so a visitor who
  only wants to run one analysis is turned away. This is a logic change, not a display one, so
  it has not been made here. It needs a decision: either the gate is relaxed and guest job ids
  come from the anonymous session identifier instead of a user id, or the copy stops implying
  it.
- **The design has never been seen.** There is no browser attached to the development
  session, so every change was verified by `tsc`, `eslint`, `next build` and by reading the
  served HTML and compiled CSS over HTTP. Contrast ratios were computed and every element
  the brief specifies was confirmed present in the output, but **no one has looked at it.**
  The 274px sidebar at its real width, the vertical centring, the mark's ring at 48px and
  the mobile layout are all unverified by eye.
- **The one deliberate departure from the brief is the send arrow's colour.** It is white,
  not cream, because cream on teal is 2.80:1 and an icon owes 3:1. If judges are shown the
  brief's colour and not this one, that is why.
- **The home screen's headline is cheeky.** "What's cooking, good lookin'?" was in the
  brief. It is worth deciding whether that tone is right in front of IBM judges; it is one
  string in `home-main.tsx`.
- The workspace has been written against the route handlers in `back/src/routes/` but has never
  been run against a live API, because the backend cannot start on the development machine
  (no Docker). The signed-out and error paths are the only ones actually executed. The
  fragile parts are the presigned upload preflight, status polling, `SameSite` cookie
  behaviour across sites, and rendering a finished result.
- **The home screen's two controls are presentational.** The drop zone hands its `FileList` to
  a handler that navigates to `/workspace`, because there is no project yet for the bytes to
  belong to — the real importer is `sequence-import.tsx`. The composer owns the typed text and
  nothing else; it has no `onSubmit`, so sending is inert. Both are one call site away from
  being real.
- Settings has no route. It is rendered `aria-disabled` rather than wired to something
  arbitrary, so nobody clicks it expecting a preferences panel.
- The result charts, the composition table and the notes panel are research and education
  surfaces. Nothing here is a clinical or diagnostic tool, and the UI says so wherever a
  result is displayed.