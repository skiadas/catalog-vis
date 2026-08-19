# @major-vis/server

Backend for the major-vis apps: Express + the built-in **`node:sqlite`**
database (Node ≥ 22.5). Serves the static apps + catalog JSON, provides
username-based auth, and exposes the yearly schedule / term / suggested-change
APIs. Reuses the pure `@major-vis/schedule-core` domain logic directly (no
duplicate scheduling code).

## Run

```sh
npm run serve
# env: PORT (8080), HOST (0.0.0.0), DB_PATH (server/data/major-vis.db),
#      SERVICES (comma list: program|schedule|planner; default schedule),
#      STATIC_DIR (repo root by default)
```

Serves at `http://localhost:8080/` (the root launcher redirects to the first
enabled service) with the API under `/api`.

## Storage

SQLite via `node:sqlite` (`DatabaseSync`). Schema (migrated at boot in `src/db.js`):

- `users(id, username, created_at)`
- `sessions(id, user_id, token_hash, created_at, expires_at)`
- `schedules(id, name, year, owner_user_id, status, version, created_at, updated_at)`
- `schedule_terms(id, schedule_id, term, payload, version)` — one row per
  (schedule, term); `payload` is the JSON offerings array
- `schedule_changes(id, schedule_id, term, proposer_user_id, status,
base_version, operations, note, created_at, resolved_at)` — suggested changes

`server/data/` is gitignored (dev DB).

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
POST   /api/schedules/:id/suggestions       -> { suggestion }    (auth, version-guarded)
GET    /api/schedules/:id/suggestions       -> { suggestions }   (owner sees all; others see own)
POST   /api/suggestions/:id/approve         -> { term }           (owner; applies diff ops)
POST   /api/suggestions/:id/reject          -> { ok }             (owner)
GET    /api/schedules/:id/suggestions/export?fmt=json|md|csv
```

**Auth**: opaque session token in an `mjv_sid` httpOnly cookie. Today the
provider is `username` (self-identify); the provider seam leaves room for SSO /
one-time-code later without changing the route contract.

**Suggestions**: a non-owner (or owner) can propose a change to a term as a list
of diff operations (`add` / `remove` / `update`). The server stores it against
the term's current version and does **not** mutate the canonical term until the
owner **approves** it; approval checks the base version still matches (a stale
base is `409`) and applies the operations. Diff produce/apply/describe live in
`@major-vis/schedule-core/diff` (`diffOfferings`, `applyOperations`,
`describeChange`, `renderChanges`).

## Reuse

The server imports `@major-vis/schedule-core` for the offering record and can
use any pure domain function (parsing, conflicts) — the same modules the
browser uses. `src/app.js` is a factory (`createApp`) so tests build it against
an in-memory DB and exercise the API over real HTTP (`server/test/`).
