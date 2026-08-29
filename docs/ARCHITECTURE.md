# Architecture

How the pieces fit together: a data pipeline produces a JSON contract, a shared
browser library loads it, and three independent apps consume it. Read
`README.md` for the layout overview and `GLOSSARY.md` for the terminology
before or alongside this.

## Data flow

```
catalog.hanover.edu  (the public catalog)
        │
        │  tools/catalog-pipeline/
        │    scrape_catalog.py            → majors.json               (raw programs, courses, faculty)
        │    codify_requirements.py       → requirements_parsed.json  (structured requirement nodes)
        │    extract_core.py              → core_requirements.json    (CCR/ACE areas)
        │    audit_catalog.py             → catalog_issues.{json,md}  (admin report — NOT runtime)
        ▼
   ┌────────────────────────────────────────────────────────────────┐
   │  The three JSON files at the repo root are the CATALOG DATA    │
   │  CONTRACT — validated against packages/catalog-contract        │
   │  schemas by `npm run validate:catalog` (run in CI).            │
   └────────────────────────────────────────────────────────────────┘
        │
        │  packages/catalog-client — loadCatalog({ baseUrl })
        │    fetches the three JSON files into reactive refs:
        │    programs · allCourses · parsedRequirements · coreRequirements
        ▼
   ┌──────────────┐     ┌────────────────┐     ┌───────────────────┐
   │ apps/browse  │     │ apps/schedule  │     │ apps/planner      │
   │ program &    │     │ schedule       │     │ degree planner +  │
   │ course       │     │ review/editing │     │ requirements      │
   │ catalog      │     │                │     │ audit             │
   └──────────────┘     └────────────────┘     └───────────────────┘
        └────────────── cross-app links are plain URLs ──────────────┘
```

Each app is an independent Vite root (`apps/<name>`, wired by the shared
`appConfig` factory in `vite.apps.mjs`) that builds a self-contained
`dist/<name>/` bundle. The pipeline is the only writer of the contract; apps
are read-only consumers. The pipeline's producer can be swapped (scrape → a
college feed/API) without touching consumers, as long as the JSON contract
holds.

## The four mechanisms a newcomer can't guess

### 1. Apps only run as Vite bundles; SCSS is compiled by the build

There is no CDN and no import maps: each app's `index.html` loads a single
`main.js` module entry, and bare `@major-vis/*` specifiers inside the app
resolve through the workspace `package.json` `exports` fields at build time
(`npm run build`, or the `npm run dev`/`dev:browse`/`dev:planner` dev servers).
That is why `catalog-client` and the app stores are "browser-only" while the
pure packages never import Vue. The only preprocessing step is **CSS**:
authored in SCSS under `style/` and compiled by an inline Vite plugin (`scss`
in `vite.apps.mjs`) — in dev (served fresh, invalidated on SCSS change) and in
build (bundled into `dist/<name>/`). The compiled `apps/<name>/style.css` is
**not** in version control, and a SCSS error fails the build.

### 2. Workspace resolution replaces per-app import maps

Because every app builds through Vite, each app's `index.html` is trivial — a
root-relative `/main.js` and `./style.css` link. Packages expose `exports`
maps (with a separate `types` condition for tsc `checkJs`), and the Vite build
emits **relative** asset URLs (`base: './'` in `vite.apps.mjs`), so a built
app is location-independent: it runs from `/apps/<name>/` in the container
layout, any subpath, or its own host.

### 3. The `baseUrl` seam

`loadCatalog({ baseUrl })` is the single configuration seam between the apps and
the catalog source. Today each app passes `baseUrl: '../../'` to reach the
repo-root JSON when co-deployed. Pointing an app at a college-hosted catalog API
(or a separate host) means changing that one value.

### 3b. Service config: `config.json` + the root launcher

A deployment decides which of `program` / `schedule` / `planner` appear by
serving a services list: the backend exposes it at `/api/config` (driven by
the `SERVICES` env var), with a static `config.json` at the deployment root as
the serverless fallback. The root `index.html` is a **launcher** that resolves
that list (backend first, then `config.json`, then all) and redirects to the
first enabled app under `/apps/<name>/` (or shows a chooser when several are
enabled). The apps themselves are standalone: they carry no cross-app chrome,
and `@major-vis/app-config` is the library equivalent of this same resolution
for anything that needs it.

### 4. Cross-app navigation is URLs, not calls

The three apps are separate module instances — they cannot import each other's
state. They talk through deep links (see `docs/GLOSSARY.md` → "join keys"):

- `browse → planner`: `../planner/#/?program=<id>&track=<trackKey>`
- `planner → browse`: `../browse/#/program/<id>` and `../browse/#/course/<code>`

`trackKey` is a stable slug of a parsed requirement's label.

## What each piece needs from the contract

See the consumer-needs matrix in `packages/catalog-contract/README.md`. In short:
browse renders programs/courses/requirements; the planner evaluates
requirements (`degree-audit`) against the user's plan; the schedule app uses
course names + faculty pools and the registrar-shaped offering record
(`schedule-core`).

## Reading order (first contribution)

1. `README.md` — overview + quick start.
2. `docs/ARCHITECTURE.md` — this file.
3. `docs/GLOSSARY.md` — the terminology.
4. `packages/catalog-contract/README.md` — the data contract + schemas.
5. Pick the app you're changing and read its `main.js` → `router.js` →
   `src/*Store.js` → `components/`.
6. For logic-level changes: `packages/degree-audit` (requirements evaluation) or
   `packages/schedule-core` (schedule domain) — both `node --test`-able in isolation.
7. For data changes: `tools/catalog-pipeline/` (run from the repo root).
