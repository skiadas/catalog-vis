# @major-vis/server

Backend for the major-vis apps: Express + the built-in **`node:sqlite`**
database (Node ≥ 24). Serves the built apps + the catalog API, provides
username-based auth, and exposes the yearly schedule / term / suggested-change
APIs. Reuses the pure `@major-vis/schedule-core` domain logic directly (no
duplicate scheduling code). It is also the **container process** — the
deployment is a single container (see the root README "How it's deployed" and
the `Dockerfile`).

## Run

```sh
npm run build && npm run serve
# env: PORT (8080), HOST (0.0.0.0), DB_PATH (server/data/major-vis.db),
#      SERVICES (comma list: program|schedule|planner; default schedule),
#      STATIC_DIR (built static layout; defaults to the repo root)
```

The container sets `STATIC_DIR=/srv/static` to an **assembled layout**: the
root launcher (`index.html`, `config.json`), the three catalog artifacts, and
the built apps under `apps/<name>/` (copied from `dist/<name>/`). Locally
(`STATIC_DIR` unset = repo root), the same layout is mirrored: the built
bundles under `dist/<name>/` are mounted at `/apps/<name>/` automatically, so
run `npm run build` first — the source tree's dev-only `apps/<name>/index.html`
is never served. (`npm run dev` is the Vite UI-iteration path: apps only,
offline — no `/api`, so no ownership/suggestions.)
The apps'
relative seams (`loadCatalog`'s `baseUrl: '../../'`, the schedule API base
`../../api`) resolve against that root — the source-tree `apps/` is never
served. Serves at `http://localhost:8080/` (the root launcher redirects to the
first enabled service) with the API under `/api`.

## Storage

SQLite via `node:sqlite` (`DatabaseSync`). Schema (migrated at boot in `src/db.js`):

- `users(id, username, created_at)`
- `sessions(id, user_id, token_hash, created_at, expires_at)`
- `schedules(id, name, year, owner_user_id, status, version, created_at, updated_at)`
- `schedule_terms(id, schedule_id, term, payload, version)` — one row per
  (schedule, term); `payload` is the JSON offerings array
- `schedule_changes(id, schedule_id, term, proposer_user_id, status,
base_version, operations, note, created_at, resolved_at)` — suggested changes

`server/data/` is gitignored (dev DB); the container persists `/data` as a
volume.

## Catalog API (always public — no auth, no DB)

The catalog is the **pipeline JSON as source of truth**, served from
`staticDir` (see `src/catalog.js`):

```
GET  /majors.json, /requirements_parsed.json, /core_requirements.json
     -> the artifacts, with Cache-Control: no-store + ETag/Last-Modified
GET  /catalog.json -> { catalog_year, updated_at, schema_version, artifacts }
```

`no-store` keeps the data contract from ever going stale in a consumer's
browser. The relative `baseUrl` seam in `@major-vis/catalog-client` means a
future college-hosted catalog API can replace these routes without touching
the apps (CORS needed only when hosted off-origin).

## API

```
GET    /api/config                          -> { services, auth }
GET    /api/auth/session                    -> { user } | 401
POST   /api/auth/login { username }         -> { user }          (self-identify)
POST   /api/auth/logout
GET    /api/schedules?year=                 -> { schedules }     (auth)
POST   /api/schedules { name, year }        -> { schedule }      (creates 3 empty term parts)
GET    /api/schedules/:id                   -> { schedule: { ..., terms } }
PATCH  /api/schedules/:id { name?, status? }-> { schedule }      (owner)
DELETE /api/schedules/:id                                          (owner)
GET    /api/schedules/:id/terms/:term       -> { term: { offerings, version } }
PUT    /api/schedules/:id/terms/:term       -> { term }           (owner, full replace)
POST   /api/schedules/:id/suggestions       -> { suggestion }    (auth; base_version informational)
GET    /api/schedules/:id/suggestions       -> { suggestions }   (everyone sees pending; own history + owner sees all)
PATCH  /api/suggestions/:id                 -> { suggestion }    (proposer, pending only)
DELETE /api/suggestions/:id                 -> { suggestion }    (proposer, pending only; soft 'withdrawn')
POST   /api/suggestions/:id/approve         -> { term, suggestion } (owner; applies ops to current state)
POST   /api/suggestions/:id/reject          -> { ok }             (owner)
GET    /api/schedules/:id/suggestions/export?fmt=json|md|csv
```

**Auth**: opaque session token in an `mjv_sid` httpOnly cookie. Today the
provider is `username` (self-identify); the provider seam leaves room for SSO /
one-time-code later without changing the route contract.

**Suggestions**: anyone can propose a change to a term as a list of diff
operations (`add` / `remove` / `update` with absolute field values). Many
suggestions from many proposers stay live **concurrently**: approval applies
the operations to whatever the term's current state is (no base-version guard),
so approving one proposal never invalidates others. Unmatched ops no-op,
duplicate adds dedupe, and an approval that changes nothing is recorded as
**`moot`**. Proposers can edit (`PATCH`) or withdraw (`DELETE`, soft
`withdrawn`) their own pending suggestions. The recorded `base_version` is
informational only — the paper trail keeps every row with proposer, note,
operations, and resolution status. Diff produce/apply/describe live in
`@major-vis/schedule-core/diff` (`diffOfferings`, `applyOperations`,
`describeChange`, `renderChanges`). `GET /api/schedules` returns full term
payloads (offerings + versions) so the app renders directly from the list.

## Reuse

The server imports `@major-vis/schedule-core` for the offering record and can
use any pure domain function (parsing, conflicts) — the same modules the
browser uses. `src/app.js` is a factory (`createApp`) so tests build it against
an in-memory DB and exercise the API over real HTTP (`server/test/`).
