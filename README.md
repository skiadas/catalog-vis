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
  degree-audit/              pure requirements evaluator
  schedule-core/             pure schedule domain model + generator
  router/                    tiny hash-router factory
apps/                        the three user-facing apps (each own index.html + import map)
  browse/                    program & course catalog
  schedule/                  schedule review/editing
  planner/                   degree planner + audit
tools/catalog-pipeline/      Python: scrape, codify, extract core, audit, merge, report
```

Every package and app ships a README that is its contract — inputs, outputs,
persistence shapes, and cross-app links — so any piece can be lifted onto its
own host or reimplemented elsewhere. `AGENTS.md` is the piece map. For newcomers:
`docs/ARCHITECTURE.md` (how the pieces fit + reading order) and
`docs/GLOSSARY.md` (the terminology).

## Quick start

The apps are zero-build static sites (Vue loaded from CDN, workspace packages
resolved by per-app import maps). Serve the repo root:

```sh
python3 -m http.server 8080
# http://localhost:8080/apps/browse/   (programs)
# http://localhost:8080/apps/schedule/ (schedule)
# http://localhost:8080/apps/planner/  (planner)
```

## Data pipeline

| Step | Script | Output |
|------|--------|--------|
| Scrape catalog | `tools/catalog-pipeline/scrape_catalog.py` | `majors.json` (54 programs, 1144 courses) |
| Codify requirements (LLM-assisted) | `tools/catalog-pipeline/codify_requirements.py` per `packages/catalog-contract/REQUIREMENTS_SCHEMA.md` | `requirements_parsed.json` |
| Extract core curriculum | `tools/catalog-pipeline/extract_core.py` | `core_requirements.json` |
| Audit cross-references | `tools/catalog-pipeline/audit_catalog.py` | `catalog_issues.{json,md}` |
| Render admin report | `tools/catalog-pipeline/md_to_html.py` (pandoc) | `catalog_issues.html` |

The three JSON artifacts are the **catalog data contract** — validated by
`packages/catalog-contract` (`npm run validate:catalog`). See
`packages/catalog-contract/README.md` for the schemas and consumer-needs
matrix. The sample schedule is generated in the browser from the catalog
(`@major-vis/schedule-core`); schedule collections and plans live in
`localStorage`.

## Development

Requirements: Node ≥ 20 (tooling only; not used by the apps) and Python 3.

```sh
npm install              # tooling + workspace packages
npm test                 # unit tests (degree-audit, schedule-core, catalog-contract)
npm run validate:catalog # committed JSON conforms to the contract schemas
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
(`.github/workflows/ci.yml`). The site is published to GitHub Pages from the
`main` branch (repo root); the root `index.html` redirects to
`apps/browse/`. GitHub Pages sends `Access-Control-Allow-Origin: *`, so the
apps could be lifted onto separate hosts and still fetch the catalog JSON
cross-origin.
