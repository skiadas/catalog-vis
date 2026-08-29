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

Each app is an independent static page (`index.html` + `main.js`). The pipeline
is the only writer of the contract; apps are read-only consumers. The pipeline's
producer can be swapped (scrape → a college feed/API) without touching consumers,
as long as the JSON contract holds.

## The four mechanisms a newcomer can't guess

### 1. No runtime build; Vue is a CDN global

There is no bundler and no server-side compilation at runtime. Each `index.html`
loads Vue from unpkg as a global (`<script src="...vue.global.prod.js">`), and
app code uses it via `const { ref, computed } = Vue`. That is why
`catalog-client` and the app stores are "browser-only" while the pure packages
never import Vue.

The one preprocessing step is **CSS**: it is authored in SCSS under `style/`
and compiled to committed `apps/<name>/style.css` via `npm run build:css` —
a developer-time step, never something the deployed apps run.

### 2. Per-app import maps

Each app's `index.html` declares a `<script type="importmap">` that maps bare
`@major-vis/*` specifiers to package files. Because an app lives at
`apps/<name>/`, two levels below the repo root, the paths are `../../packages/...`:

```html
<script type="importmap">
  {
    "imports": {
      "@major-vis/app-config": "../../packages/app-config/index.js",
      "@major-vis/catalog-client": "../../packages/catalog-client/index.js",
      "@major-vis/degree-audit": "../../packages/degree-audit/planner.js",
      ...
    }
  }
</script>
```

Relative (not root-absolute) paths keep the apps location-independent — they work
under any GitHub Pages subpath or local server root.

### 3. The `baseUrl` seam

`loadCatalog({ baseUrl })` is the single configuration seam between the apps and
the catalog source. Today each app passes `baseUrl: '../../'` to reach the
repo-root JSON when co-deployed. Pointing an app at a college-hosted catalog API
(or a separate host) means changing that one value.

### 3b. Service config: `loadConfig` + the root launcher

A deployment decides which of `program` / `schedule` / `planner` appear by
serving a services list (`@major-vis/app-config`). Each app's `main.js` calls
`loadConfig({ endpoint: '../../api/config', staticPath: '../../config.json' })`
and renders the nav from `SERVICE_DEFS` filtered by `isEnabled(key)`. The root
`index.html` is a launcher that resolves the same list (backend `/api/config`,
else `config.json`, else all) and redirects to the first enabled service — so
for a schedule-only deployment, visiting `/` lands directly in `apps/schedule`.

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
