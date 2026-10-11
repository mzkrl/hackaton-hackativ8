# front

Next.js 16 App Router client for **Gene Pilot**. The home screen at `/`, the
interactive workspace at `/workspace`, sign-in/guest gate inside the workspace.

## Running it

```bash
bun install
bun run dev          # http://localhost:3000
```

One environment variable, read at build time:

| Variable              | Required | Purpose                                                  |
| --------------------- | -------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | yes      | Base URL of the `back/` API, e.g. `http://localhost:4000`. |

Copy `.env.example` to `.env.local`. The value is inlined into the client bundle at build
time, so it is a constant for the life of the bundle and changing it needs a rebuild, not a
reload. Left unset, every request throws `API_NOT_CONFIGURED` and says so.

Use `localhost`, not `127.0.0.1` — the API hostname in `NEXT_PUBLIC_API_URL` and the page's
own origin must be the same *site* or the `SameSite=Lax` session cookie is silently dropped.
For the API to accept the session cookie, `CORS_ORIGINS` on the backend has to list this
origin exactly (`http://localhost:3000` for the dev server). It cannot be `*`, because the
browser refuses a wildcard on a credentialed request.

## Routes

| Path         | Rendering       | What it is                                                        |
| ------------ | --------------- | ----------------------------------------------------------------- |
| `/`          | Static          | Home screen. Prerendered; ships one small client component.      |
| `/workspace` | Client, runtime | Session/guest gate and the workspace. Resolves the session on the client. |
| `/icon`      | Generated       | The mark, drawn in `app/icon.tsx` via `next/og`.                  |
| `404`        | Static          | `app/not-found.tsx`, inside the root layout.                      |

`/` is a Server Component whose only client leaf is `HomeMain` — client for two reasons,
both about owning a control's own state (the typed text, and the router the drop zone
needs), neither about data. `/workspace` cannot be a Server Component at all: the session is
an `HttpOnly` cookie, so "am I signed in" is not answerable during a server render and has
to be asked of the API from the browser.

## Layout

```
app/
  layout.tsx        html shell, Nunito wiring, metadata, cream themeColor
  page.tsx          home screen (Server Component): sidebar slots + the column
  icon.tsx          generated favicon, same helix drawing as brand.tsx
  not-found.tsx     404, rendered inside the root layout
  workspace/page.tsx the client half
components/
  app-shell.tsx       the 274px sidebar / mobile top bar, wraps every page
  home-screen.tsx     home screen shell (session-aware greeting)
  home-main.tsx       the home column: headline, drop zone, composer (client)
  brand.tsx           ring-and-helix mark, stacked wordmark lockup, the icon set
  chat-bar.tsx        the ask input, filled and plain variants
  upload-target.tsx   the drop zone; hands over a FileList, never reads it
  workspace.tsx       session gate, project picker, and the owner of all server state
  auth-view.tsx       sign in / sign up / continue as guest
  sequence-import.tsx two import routes: proxied file upload, pasted text
  sequence-board.tsx  sequence rows, delete, and analysis submission
  analysis-board.tsx  queued and finished analyses, delete/retry
  analysis-result.tsx renders a finished result
  insight-markdown.tsx model prose rendered as Markdown (no raw ** markers)
  composition-chart.tsx Recharts, client-only
  notes-panel.tsx      per-project message log
  primitives.tsx       Panel, Empty, Notice, Button, Field, StatusBadge, Skeleton
lib/
  api.ts            transport, ApiRequestError, error classification
  genomics.ts       one typed wrapper per endpoint
  sequence.ts       format, length and hash for metadata-only sequence registration
  result.ts         tolerant reader for analyses.result_json
  insight.ts        block parser for the AI interpretation's Markdown subset
scripts/
  check-result.ts   parser + insight checks, see below
```

`lib/` is layered on purpose. `api.ts` owns transport and knows nothing about genomics;
`genomics.ts` owns endpoint contracts and knows nothing about React; `sequence.ts`,
`result.ts` and `insight.ts` own pure derivations. A component imports the layer it needs and
no deeper.

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
the bug it exists to prevent. Dark mode is retired; the `dark:` classes the components carry
are dead weight and can be stripped in a separate pass, but removing the variant first would
just re-open the bug.

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
  edge instead of wrapping.

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
subset. `weight` also makes the brief's hierarchy greppable: if a weight is not in
`layout.tsx`, it is not available.

No mono family is loaded. A sequence, a count and an accession are the one place the OS
monospace is already the right answer, so `--font-mono` is a plain system stack. Nunito is
applied on `<body>` and handed to Tailwind as `sans`.

`--font-display` is still defined, as an alias for the sans stack rather than a second
family.

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
  `rounded-xl border border-line bg-paper`.
- **No gradient heroes, no blurred orbs, no glassmorphism, no grid backdrops.** The home
  screen is one centred column, because that is what the design specifies.
- **Nothing on the home screen is absolutely positioned.**
- **Every SVG carries explicit `width` and `height` attributes and `shrink-0`.**
- **Motion only where state is genuinely moving.** A queued or processing analysis gets a
  pulsing dot. Nothing loops, and `prefers-reduced-motion` collapses all of it.
- **Two layouts from one shell.** `app-shell.tsx` is a 274px sidebar above `md` (768px) and
  a full-bleed single column with a compact top bar below it.
- **A control that cannot work says so.** Settings is in the design and has no route, so it
  renders as a `<span>` with `aria-disabled` and a hover note.

### Extending it

Adding a semantic colour: prefer a token from the table above. If a genuinely new one is
needed, check it against `--color-cream` first, and keep it clear of the six brief colours.
Status and severity colours (`STATUS_TONES` in `primitives.tsx`, the `tones` map in
`Notice`) are semantics rather than brand: a failure has to read as a failure to someone who
has not learned the palette.

Note that Tailwind only emits a `@theme` variable once something references it. A token that
nothing uses will silently vanish from the build rather than sitting there waiting.

Adding a loading state: use `Skeleton` or `SkeletonRows` from `primitives.tsx` with the
shape the real content will have. Do not add a `"Loading…"` string — a placeholder that
changes the layout when content arrives is worse than a blank one.

## Division of labour

| Owned here (frontend)                          | Owned elsewhere                              |
| ---------------------------------------------- | -------------------------------------------- |
| Layout, typography, colour, spacing            | Endpoint contracts and their enforcement      |
| Responsive behaviour, web and mobile           | Auth, session issuance, ownership checks      |
| Loading, empty, error and pending *presentation* | Which state is real, and when it changes   |
| Rendering whatever flat shape `result_json` arrives in | Normalising the payload (the backend)   |
| Copy, disclaimers, scientific wording          | The science: Biopython, BLAST, NCBI          |

Two consequences for anyone editing this directory:

- **A component may assume nothing about the backend.** `result_json` is read defensively;
  the parser is written to degrade, not to throw.
- **Presentation must not decide truth.** The reported/derived distinction on GC/AT content
  is the rule: a number this code computed is never rendered as one a tool reported.

## Server state

`workspace.tsx` is the only owner of server state. Children receive data as props and report
back through callbacks, so there is one `useEffect` per concern instead of a fetch inside
every panel. In particular the analysis board cannot register a new tracked id itself — it
does not know which project is selected — so it reports the id upward.

Project selection is derived rather than stored:

```ts
const activeId = selectedId ?? projects[0]?.id ?? null;
```

## Reading analysis results

`analyses.result_json` is a `jsonb` column. The backend normalises it into one flat shape
(`back/src/lib/normalize-result.ts`) regardless of which executor produced it, and
`lib/result.ts` reads that shape field by field. Every field is optional, wrong types are
dropped rather than thrown on, and genuinely unrecognised keys are still shown under "Other
fields" — a payload from an older row degrades to "here is the raw data", not to a blank
panel.

Normalised tools each get a card: `record`, `gc_content`/`at_content` (with the meter),
`composition` (the Recharts chart), `orfs` and BLAST tables, `translation`, and dedicated
cards for `sequence_statistics`, `sequence_type`, `sequence_features`, `validation` and
`fasta`. For `at_content` the AT percentage is derived from the composition. Rows written
before the flattening kept the raw tool blob under its service name
(`detect_sequence_type`, `validate_sequence`, `parse_fasta`, …); the readers fall back to
those keys so old rows still render, and the `fasta` card never prints the echoed residue
text.

`source` (executor provenance) is claimed and never rendered as data — the footer's
"Computed by a deterministic tool" note carries that meaning.

The reported/derived distinction is kept everywhere: if the payload omits `gc_content` but
carries a composition, the percentage is derived client-side and labelled as derived.

## AI interpretation

The optional `insight` prose is the only AI-written text. It is rendered by
`insight-markdown.tsx` through `lib/insight.ts`, a deliberately tiny Markdown reader that
handles the model's stable subset — `**bold**`, `-`/`1.` lists, `#` headings, `` `code` ``
— as React elements. There is no Markdown library and no `dangerouslySetInnerHTML`: the text
is model output, so it is turned into elements, never injected markup. Single newlines are
kept as line breaks because the model puts a bold label on its own line above its body.

## Checks

```bash
bun run lint           # eslint
bunx tsc --noEmit      # types
bun run check:result   # lib/result.ts + lib/insight.ts against documented payloads
```

`check:result` is a plain script, not a test framework — this project has no JS test runner,
and adding one for a pair of pure modules is not worth the dependency. It exits non-zero so
CI can call it later. It earns its place because the payload shape is still a contract on
paper: when the Bio Service lands with a different shape, this is what says so.

## Deployment

The frontend deploys to **Vercel** (the live origin is https://n3level.id) and talks to the
API on `https://back.n3level.id` behind a tunnel. `NEXT_PUBLIC_API_URL` must be that HTTPS
hostname at build time.

`bun run deploy` (`next-on-pages` + `wrangler`) is **broken** and should not be run. It calls
`next-on-pages`, whose peer range is `next: ">=14.3.0 && <=15.5.2"` while this project is on
`16.3.6`; the tool has also been deprecated by Cloudflare. The working replacement is
`@opennextjs/cloudflare`; migrating the script is a separate change.

Deploying the frontend separately from the API is fine. It is a static site plus one client
bundle; all the stateful work is in `back/`, which stays on its own host.

## Notes

- Nothing in this directory talks to anything but the `back/` API, and it does so only
  through `lib/api.ts`.
- Uploads go through the API (`POST /storage/upload`), never directly to MinIO — a
  presigned URL minted for the server is unreachable from a browser. Downloads open
  `GET /storage/download/<key>`.
- Result cards, the composition chart and the notes panel are research and education
  surfaces. Nothing here is a clinical or diagnostic tool, and the UI says so wherever a
  result is displayed.