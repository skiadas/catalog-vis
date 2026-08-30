# Major Catalog Visualizer — Agent Guide

Orientation for working in this repo, not a reference vault. Each package and
app ships a README that is its contract (inputs, outputs, persistence shapes,
cross-app links); when a task touches a specific piece, read that piece's README
or the docs listed under "Where to dig in". This file holds only what stays true
no matter which part of the app you tackle.

## What this is

An npm-workspaces monorepo of **independently deployable static Vue 3 apps**
that browse Hanover College's academic programs, review/edit schedules, and plan
majors/minors — plus the Python pipeline that scrapes and codifies
catalog.hanover.edu into JSON, and an optional Node backend. The design goal:
every piece is self-contained behind a documented contract so it can be lifted
onto its own host or reimplemented against a college-hosted catalog API.

For the "how the pieces fit" story and a newcomer reading order, see
`docs/ARCHITECTURE.md`; for terminology (program vs `majors.json`, course code
vs `code`, offerings vs courses, track keys, join keys), see `docs/GLOSSARY.md`.

## Repository map

```
packages/
  catalog-contract/          THE DATA CONTRACT: JSON Schemas + validator + REQUIREMENTS_SCHEMA.md
  catalog-client/            browser catalog data layer (loadCatalog + refs + filters + tracks)
  app-config/                browser service + auth config (loadConfig/isEnabled + launcher contract)
  degree-audit/              pure requirements evaluator (node --test-able)
  schedule-core/             pure schedule domain model + generator (node --test-able)
  router/                    tiny hash-router factory (createRouter)
server/                      Node backend: Express + built-in node:sqlite + auth + schedules/suggestions API; serves the built apps + catalog API + launcher (the container process)
apps/
  browse/                    program & course catalog
  schedule/                  schedule review/editing
  planner/                   degree planner + audit
tools/catalog-pipeline/      Python: scrape, codify, extract_core, audit, md_to_html, test_data
```

## Cross-cutting facts

- **Apps are built with Vite; TypeScript type-checks the JS and the SFCs.**
  Each app is an independent Vite root (`apps/<name>`, wired by
  `vite.apps.mjs`) that builds a self-contained `dist/<name>/` bundle. Bare
  `@major-vis/*` specifiers resolve through the workspace `package.json`
  `exports` fields — there are **no import maps** anymore, so `npm run build`
  and `npm run typecheck` catch bad imports/exports at build time, before a
  browser ever loads an app. Components are `.vue` single-file components
  (Options API + template) compiled by `@vitejs/plugin-vue`; `npm run
  typecheck` runs **vue-tsc**, which type-checks template bindings against
  each component's props/setup scope — a template referencing a binding the
  component never returns is a compile error, not a browser crash. Pure
  packages never import Vue (`schedule-core`, `degree-audit`,
  `catalog-contract`, `app-config`); `catalog-client` and `router` import Vue
  on purpose. CSS is authored as SCSS (`style/`, shared partials in
  `style/partials/`) and compiled by Vite into each app build via an inline
  plugin in `vite.apps.mjs` — the compiled `apps/*/style.css` is **not** in
  version control, and a SCSS error fails the build.
- **The catalog is three root JSON files** (`majors.json`,
  `requirements_parsed.json`, `core_requirements.json`), validated against the
  contract schemas by `npm run validate:catalog` (run in CI). The pipeline is the
  only writer; apps are read-only consumers — swap the producer without touching
  consumers as long as the JSON contract holds.
- **Apps never import each other.** Navigation between them is plain URLs, not
  function calls (examples in `docs/ARCHITECTURE.md`).
- **Persistence is localStorage** — `major-vis.schedules*` (schedule app) and
  `major-vis.planner.*` (planner app); browse persists nothing. The `server/`
  backend is optional, gated by a `SERVICES` env var, and mirrors the schedule
  store when present.

## How to work here

**Formatting** — `npx prettier@3.3.3 --write "**/*.{js,html,css,scss,vue}"` (JSON
and the compiled `apps/*/style.css` are ignored), then `python3 -m black .` and
`python3 -m compileall -q -x "node_modules|/\.git/" .`. **Never hard-code
design tokens**: inherit before you set · token before you repeat · name a
repeated look once.

**Conventions** — naming and style rules beyond tooling live in
`docs/CONVENTIONS.md` (e.g. booleans read as predicates: `isOpen`, not `open`).

**Committing and verifying** — commit often and without being asked: finish a
coherent slice, run the checks below, and commit before moving on. This repo
wants autonomous small commits; do not wait for explicit permission, but do
inspect `git status`/`git diff` so only intended files are staged. Run the same
checks CI runs, all must pass _before_ you commit:
- `npx prettier@3.3.3 --check "**/*.{js,html,css,scss,vue}"`
- `npm test` (workspaces: degree-audit, schedule-core, catalog-contract)
- `npm run typecheck` (vue-tsc: checkJs across apps/packages/server + SFC template bindings)
- `npm run build` (Vite bundles each app; fails on bad imports/exports)
- `npm run validate:catalog` (contract schemas)
- `npm run test:data` (Python data-integrity)
- `npm run lint` (eslint)
- `python3 -m black .` then `python3 -m compileall -q -x "node_modules|/\.git/" .`

**Definition of done for a change to app/store logic or UI** — passing the
checks above proves the build stays green, not that a feature works:

- **Store/non-DOM logic** (e.g. `apps/schedule/src/scheduleStore.js`) gets
  unit-tested under `node --test` against a real in-process API server when
  the change alters behavior (see `apps/schedule/test/scheduleStore.test.mjs`
  and its helpers — the harness shims localStorage and a cookie-aware fetch;
  `backend.setApiBase` points the store at the test server).
- **UI interactions** are exercised by the local-only smoke test
  (`npm run test:smoke` — requires `npm run build` first and system Chrome /
  `CHROME_PATH`; drives sign-in, creation, and the edit/suggest menus in a
  headless browser and fails on console errors) or, when the smoke test can't
  cover the flow, an explicit manual run of the full stack (`npm run build &&
  npm run serve`).
- **Coverage**: `npm run test:coverage` reports Node-test-file coverage; check
  it when adding suites so untested files don't accumulate silently.

Amend instead of adding fixup commits if the latest commit is unpushed and the
fix is for issues it introduced. **Never push unless asked** — inspect
`git status`/`git diff` before staging.

**Common tasks** — run the Python pipeline from the repo root (scripts anchor
data to the root via `ROOT`): `python3 tools/catalog-pipeline/scrape_catalog.py`
re-scrapes; the full regeneration workflow and the serve command are in
`README.md`. Serve apps locally with `npm run dev` (Vite, per-app) or
`vite preview`; the full stack (built apps + catalog + API) runs in the
container (see `server/README.md`).

## Where to dig in

When a task touches a specific piece, read its README (map above) plus:

| You're touching…                          | Read…                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| scraped-data quirks (double-space codes, name-derived ids, discrepancies) | `tools/catalog-pipeline/scrape_catalog.py` docstring |
| catalog audit classes (CAT1–CAT7)         | `tools/catalog-pipeline/audit_catalog.py` docstring + `catalog_issues.md` |
| requirement model (`any_of`/`electives`/…) | `packages/catalog-contract/REQUIREMENTS_SCHEMA.md` + `requirements_parsed.json` |
| join keys / consumer needs                | `packages/catalog-contract/README.md`                                  |
| requirement evaluation                    | `packages/degree-audit/README.md` (the evaluator sees only code sets, never timing) |
| schedule domain / offering record         | `packages/schedule-core/README.md`                                     |
| catalog loading / tracks / `baseUrl` seam | `packages/catalog-client/README.md`                                    |
| service config / launcher                 | `packages/app-config/README.md`                                        |
| deep-link URL contracts                   | `docs/ARCHITECTURE.md`                                                 |
| backend / API                             | `server/README.md`                                                     |

## Current gotchas

- Deployment is a single container (see `Dockerfile` + the ghcr publish
  workflow): `npm ci && npm run build` in the image, then the Express server
  serves the assembled layout — built apps under `/apps/<name>/`, the catalog
  artifacts + `/catalog.json`, and the backend API — from one process. The
  root `index.html` launcher and the relative app seams (`baseUrl: '../../'`,
  API base `../../api`) are resolved against that layout. The hostname-split
  deployment seams exist but are not used yet.
- Courses a requirement references with no description anywhere are **CAT4** —
  genuine source gaps, not planner bugs.
- Plans and schedules persist only in `localStorage` — no server-side accounts
  yet (the backend DB holds schedules/suggestions when `SERVICES` enables the
  backend and the app detects it). Server-side degree audit is a future step.