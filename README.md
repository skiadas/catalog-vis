# Hanover Catalog & Schedule Visualizer

A set of independently deployable static Vue 3 apps that browse Hanover
College's academic programs, review/edit schedules, and plan majors/minors.
Catalog data is scraped from [catalog.hanover.edu](https://catalog.hanover.edu),
codified, and shipped as static JSON.

Live site: <https://skiadas.github.io/catalog-vis/> (redirects to
`apps/browse/`).

## Layout

```
packages/                    shared, build-free packages (npm workspaces)
  catalog-contract/          the data contract: JSON Schemas + validator + schema docs
  catalog-client/            browser catalog data layer (loadCatalog, refs, filters)
  app-config/                browser service + auth configuration (loadConfig, isEnabled)
  degree-audit/              pure requirements evaluator
  schedule-core/             pure schedule domain model + generator
  router/                    tiny hash-router factory
apps/                        the three user-facing apps (each own index.html + import map)
  browse/                    program & course catalog
  schedule/                  schedule review/editing
  planner/                   degree planner + audit
server/                      Node backend: Express + built-in node:sqlite (auth, schedules, suggestions)
tools/catalog-pipeline/      Python: scrape, codify, extract core, audit, merge, report
```

Every package and app ships a README that is its contract — inputs, outputs,
persistence shapes, and cross-app links — so any piece can be lifted onto its
own host or reimplemented elsewhere. `AGENTS.md` orients an agent to the repo;
these READMEs are the per-piece contracts. For newcomers:
`docs/ARCHITECTURE.md` (how the pieces fit + reading order) and
`docs/GLOSSARY.md` (the terminology).

## Quick start

The apps are static sites with **no runtime build**: Vue loads from a CDN
global, workspace packages resolve via per-app import maps, and each app
styles itself with a compiled `apps/<name>/style.css`. The CSS _source_ is
SCSS in `style/` (compiled to the per-app files via `npm run build:css`).
Serve the repo root:

```sh
python3 -m http.server 8080
# http://localhost:8080/apps/browse/   (programs)
# http://localhost:8080/apps/schedule/ (schedule)
# http://localhost:8080/apps/planner/  (planner)
```

## Data pipeline

| Step                               | Script                                                                                                 | Output                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Scrape catalog                     | `tools/catalog-pipeline/scrape_catalog.py`                                                             | `majors.json` (54 programs, 1144 courses) |
| Codify requirements (LLM-assisted) | `tools/catalog-pipeline/codify_requirements.py` per `packages/catalog-contract/REQUIREMENTS_SCHEMA.md` | `requirements_parsed.json`                |
| Extract core curriculum            | `tools/catalog-pipeline/extract_core.py`                                                               | `core_requirements.json`                  |
| Audit cross-references             | `tools/catalog-pipeline/audit_catalog.py`                                                              | `catalog_issues.{json,md}`                |
| Render admin report                | `tools/catalog-pipeline/md_to_html.py` (pandoc)                                                        | `catalog_issues.html`                     |

The three JSON artifacts are the **catalog data contract** — validated by
`packages/catalog-contract` (`npm run validate:catalog`). See
`packages/catalog-contract/README.md` for the schemas and consumer-needs
matrix. The sample schedule is generated in the browser from the catalog
(`@major-vis/schedule-core`); schedule collections and plans live in
`localStorage`.

## Development

Requirements: **Node ≥ 22.5** (the server uses the built-in `node:sqlite` module;
tooling runs on modern Node) and Python 3.

```sh
npm install              # tooling + workspace packages (incl. the server)
npm test                 # unit tests (degree-audit, schedule-core, catalog-contract, server)
npm run serve            # run the backend (Express + SQLite) at http://localhost:8080
npm run validate:catalog # committed JSON conforms to the contract schemas
npm run build:css        # compile style/*.scss -> apps/<name>/style.css (commit both)
npm run check:css        # rebuild + verify committed CSS is up to date (runs in CI)
npm run lint             # eslint
npm run format           # prettier --write
```

Python tooling (run from the repo root — scripts write/read the root JSON):

```sh
python3 -m pip install -r requirements.txt
python3 -m black .                        # formatting (preserves single quotes)
python3 tools/catalog-pipeline/test_data.py  # data invariants (npm run test:data)
```

## How it's deployed

GitHub Actions runs lint/format/tests/schema-validation on every push
(`.github/workflows/ci.yml`, on Node 24 / Python 3.12). The static pages
publish to GitHub Pages from the `main` branch; the root `index.html` is a
**launcher** that resolves which services are enabled (backend `/api/config`,
else `config.json`, else all) and redirects to the first enabled app.

For the college deployment, the **server** (`server/`) serves the static apps,
the catalog JSON, and the `/api/*` endpoints from one host: auth (username
self-identify for now), yearly schedules/terms, and suggested changes. It reuses
the pure `@major-vis/schedule-core` domain logic and stores data in SQLite via
the built-in `node:sqlite` module — no native dependencies. Set `SERVICES` to
a comma-separated list of `program | schedule | planner` to choose which apps
are exposed (default `schedule`). See `docs/INTEGRATION_PLAN.md` and
`server/README.md`.
