# Hanover Catalog & Schedule Visualizer

A set of independently deployable static Vue 3 apps that browse Hanover
College's academic programs, review/edit schedules, and plan majors/minors.
Catalog data is scraped from [catalog.hanover.edu](https://catalog.hanover.edu),
codified, and shipped as static JSON. The whole system — apps, catalog API,
backend API — deploys as a single container (see "How it's deployed").

## Layout

```
packages/                    shared, build-free packages (npm workspaces)
  catalog-contract/          the data contract: JSON Schemas + validator + schema docs
  catalog-client/            browser catalog data layer (loadCatalog, refs, filters)
  app-config/                browser service + auth configuration (loadConfig, isEnabled)
  degree-audit/              pure requirements evaluator
  schedule-core/             pure schedule domain model + generator
apps/                        the three user-facing apps (each a Vite root, wired by vite.apps.mjs)
  browse/                    program & course catalog
  schedule/                  schedule review/editing
  planner/                   degree planner + audit
server/                      Node backend: Express + built-in node:sqlite; serves the built apps, the catalog API, and the schedules/suggestions API
tools/catalog-pipeline/      Python: scrape, codify, extract core, audit, merge, report
```

Every package and app ships a README that is its contract — inputs, outputs,
persistence shapes, and cross-app links — so any piece can be lifted onto its
own host or reimplemented elsewhere. `AGENTS.md` orients an agent to the repo;
these READMEs are the per-piece contracts. For newcomers:
`docs/ARCHITECTURE.md` (how the pieces fit + reading order) and
`docs/GLOSSARY.md` (the terminology).

## Quick start

The apps are built with **Vite + TypeScript**: each app is an independent Vite
root (`apps/<name>`) with hot-reload development, and `npm run build` bundles
all three into self-contained `dist/<name>/` directories (SCSS is compiled by
Vite from `style/`; nothing compiled lives in version control). The backend,
the built apps, and the catalog all run together in a single container.

```sh
npm install        # tooling + workspace packages
npm run dev        # schedule app dev server at http://localhost:5173
npm run dev:browse # browse app
npm run dev:planner# planner app
```

### Local development: `dev` vs `serve`

Two ways run the apps, and they show different things:

- **`npm run dev` (Vite, hot-reload)** — the fastest loop for working on an app's
  UI. Changes appear without a build. Vite doesn't proxy the backend API, so the
  app runs in its **offline/localStorage mode** (no sign-in, suggestions, or
  ownership) — fine for layout, styling, and pure-client flows.
- **`npm run serve` (Express, port 8080)** — serves the _built_ bundles from
  `dist/` (the same output the container and the E2E suite consume), with the
  backend API enabled. It doesn't watch sources: run `npm run build` after any
  change and reload the browser (no restart needed). Use it — or
  `npm run dev:serve`, which builds then serves — when you need the
  server-backed flows (sign-in, suggested changes).

`npm run build` is also what a deployment needs; `dist/` is gitignored and is
rebuilt on demand, so you never commit bundles.

To exercise the **admin flows** locally (the user directory that carries each
user's display name and departments), name the admins with the
`ADMIN_USERNAMES` env var — a comma-separated list of canonical usernames
(`AUTH_DOMAIN` canonicalizes bare names, so `haris` may become
`haris@your.domain`):

```sh
ADMIN_USERNAMES=haris npm run dev:serve   # or prefix `npm run serve`
```

Sign in with that username: a **Directory** link appears in the header (at
`#/admin`), while everyone else is a regular user. The directory is what gives
a user their **departments**, which scope the add-course picker and non-owner
suggest edits. Unset means no admins and the directory API is inert. The full
env contract is in `server/README.md`.

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

Requirements: **Node ≥ 24** (the server uses the built-in `node:sqlite` module)
and Python 3.

```sh
npm install              # tooling + workspace packages (incl. the server)
npm test                 # unit tests (degree-audit, schedule-core, catalog-contract, server)
npm run typecheck        # tsc checkJs across apps/packages/server
npm run build            # Vite bundles the three apps into dist/<name>/
npm run dev              # schedule app dev server at http://localhost:5173
npm run serve            # run the backend (Express + SQLite) at http://localhost:8080
npm run test:e2e         # Playwright E2E (bundled Chromium; one-time `npx playwright install chromium`)
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

GitHub Actions runs lint/format/tests/typecheck/build/schema-validation on
every push (`.github/workflows/ci.yml`, Node 26 / Python 3.12); the slower
Playwright E2E suite runs as its own main-only workflow
(`.github/workflows/e2e.yml`); pushes to `main` and `v*` tags build the
container and publish it to GHCR (`.github/workflows/publish.yml`).

On top of the container, `.github/workflows/pages.yml` publishes the built
apps to **GitHub Pages** (repo Settings → Pages must use the "GitHub Actions"
source): the same bundles served from the repo-root layout, with the committed
`config.json` keeping it **schedule-only**. This is the offline/static variant
of the deployment — the app runs fully serverless (localStorage persistence,
sample schedule seeded on first boot; no login, ownership, or suggested-edit
approval, which need the backend). The relative seams (`../../`) resolve
identically in both layouts, so no app code differs between the two.

The deployment is a **single container** (`Dockerfile`): a build stage
installs the toolchain and builds the apps (`npm ci && npm run build`), a
deps stage installs only production dependencies (`npm ci --omit=dev` —
~17 MB vs the ~130 MB full tree), and the runtime stage runs the Express
server on **Alpine** (musl — `node:26-alpine`), which serves the assembled
layout from one process. The built image is ~64 MB compressed / ~207 MB on
disk; runtime dependencies must stay pure JS (no glibc-only native
modules), and `node:sqlite` is compiled into the official Alpine Node
build:

- the root `index.html` **launcher** — resolves which services are enabled
  (`/api/config`, else `config.json`, else all) and redirects to the first
  enabled app under `/apps/<name>/`;
- the **catalog API** — the three artifacts (`/majors.json`,
  `/requirements_parsed.json`, `/core_requirements.json`) plus a
  `/catalog.json` manifest, always public;
- the **backend API** (`/api/*`: auth — username self-identify or OIDC SSO —
  yearly schedules/terms, suggested changes) backed by SQLite via the built-in
  `node:sqlite` module — no native dependencies.

To run it on a server, copy `compose.yaml` anywhere on the box and start the
stack — Compose creates the `major-vis-data` named volume (the SQLite DB lives
there via `DB_PATH=/data/major-vis.db`), maps port `8080` (override with
`PUBLIC_PORT`), and sets `restart: unless-stopped` plus a `512m` memory cap:

```sh
docker compose up -d
```

Set `SERVICES` to a comma-separated list of `program | schedule | planner` to
choose which apps are exposed (default `schedule`); `PORT`/`HOST` cover the
listen socket. See `server/README.md`. The hostname-split seams (each app on
its own host, the catalog API served elsewhere) exist but are not used yet.

For the hosted setup — a Lightsail (or any VPS) deployment with TLS and login
delegated to an external OpenID Connect issuer (e.g. the `otc-oidc` SSO) —
`compose.yaml` carries an optional `proxy` profile (Caddy, TLS on 80/443) and
the environment contract lives in `deploy/.env.example`; the full runbook is
`docs/DEPLOY_LIGHTSAIL.md`.

**Auto-updates**: `deploy/update.sh` refreshes the repo-owned deploy files
(`compose.yaml`, `deploy/Caddyfile`), pulls the latest image from GHCR and — if
the image actually changed — recreates the stack without touching the volume
or `.env`. Run it from cron:

```sh
0 3 * * * /opt/major-vis/deploy/update.sh >> /var/log/major-vis-update.log 2>&1
```

(cron has a minimal `PATH`; set one in the crontab or use absolute docker
paths, and note `IMAGE_TAG`/`PUBLIC_PORT`/`SERVICES` are honored by both files.)
