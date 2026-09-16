# @major-vis/server

Backend for the major-vis apps: Express + the built-in **`node:sqlite`**
database (Node ≥ 24). Serves the built apps + the catalog API, provides auth
(username self-identify or an external OpenID Connect issuer), and exposes the
yearly schedule / term / suggested-change APIs. Reuses the pure
`@major-vis/schedule-core` domain logic directly (no duplicate scheduling
code). It is also the **container process** — the deployment is a single
container (see the root README "How it's deployed", the `Dockerfile`, and
`docs/DEPLOY_LIGHTSAIL.md` for the hosted setup).

## Run

```sh
npm run build && npm run serve
# env: PORT (8080), HOST (0.0.0.0), DB_PATH (server/data/major-vis.db),
#      SERVICES (comma list: program|schedule|planner; default schedule),
#      STATIC_DIR (built static layout; defaults to the repo root),
#      AUTH_PROVIDER (username | oidc; default username)
# oidc provider additionally requires: OIDC_ISSUER, OIDC_CLIENT_ID,
#      OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI, and (recommended) PUBLIC_ORIGIN,
#      COOKIE_SECURE=true — the server refuses to boot with any missing
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

SQLite via `node:sqlite` (`DatabaseSync`). The schema is owned by **versioned
migrations** — `server/migrations/*.sql`, applied in filename order by umzug at
boot inside `openDb` (each file in one transaction, applied names recorded in
the `schema_migrations` table). `0001_baseline` creates:

- `users(id, username, created_at)`
- `sessions(id, user_id, token_hash, created_at, expires_at)` — token_hash indexed
- `schedules(id, name, year, owner_user_id, status, version, created_at,
  updated_at)` — owner FK cascades on user delete
- `schedule_terms(id, schedule_id, term, payload, version)` — one row per
  (schedule, term); `payload` is the JSON offerings array
- `schedule_changes(id, schedule_id, term, proposer_user_id, base_version,
  note, created_at)` — suggested changes
- `suggestion_ops(id, suggestion_id, position, op, status, applied,
  resolved_at)` — one row per change of a suggestion (suggestion_id indexed)
- `oidc_flows(state, nonce, code_verifier, return_to, created_at, expires_at)`
  — single-use state for in-flight OIDC logins (`0002_oidc_flows`; only used by
  the `oidc` provider, pruned lazily on the next login)

Migrations are forward-only and run automatically at container boot, so normal
deploys need no extra step. `npm run migrate up|pending|history` is the manual
ops interface. Deleting a pre-baseline dev DB (`server/data/`) is a one-time
step — the baseline owns the schema now.

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
POST   /api/auth/login { username }         -> { user }          (provider: username only)
GET    /api/auth/login?return_to=           -> 302 to the issuer (provider: oidc only)
GET    /api/auth/callback?code=&state=      -> 302 back to return_to (?auth_error=... on failure)
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
PATCH  /api/suggestions/:id                 -> { suggestion }    (proposer, while no op is owner-resolved)
POST   /api/suggestions/:id/approve  { opId } -> { term, suggestion } (owner; applies that one op)
POST   /api/suggestions/:id/reject   { opId } -> { suggestion }  (owner)
POST   /api/suggestions/:id/withdraw { opId? } -> { suggestion } (proposer; one op, or every remaining pending op)
GET    /api/schedules/:id/suggestions/export?fmt=json|md|csv
```

**Auth**: opaque session token in an `mjv_sid` httpOnly cookie (30 days;
`Secure` when `COOKIE_SECURE=true`). `AUTH_PROVIDER` picks the identity source:

- `username` (default) — self-identify via `POST /api/auth/login { username }`.
  Intended for local dev and tests; anyone can claim any name, so don't expose
  it publicly.
- `oidc` — authorization code + PKCE against `OIDC_ISSUER`
  (`server/src/auth/oidc.js`, `openid-client`). `GET /api/auth/login` redirects
  to the issuer, `/api/auth/callback` consumes the single-use state row
  (`oidc_flows`), validates the ID token, and JIT-provisions the user from the
  lowercased `email` claim (the `users.username` column holds the email). The
  self-identify POST route is not registered in this mode. `return_to` is
  validated to a same-origin path; failures redirect back with
  `?auth_error=<code>`.

Either way the apps see the same contract: `/api/config` advertises the
provider, `/api/auth/session` reports the user (anonymous is `user: null`, not
a 401), and `/api/auth/logout` clears the session.

**Suggestions**: anyone can propose a change to a term as a list of diff
operations (`add` / `remove` / `update` with absolute field values). Many
suggestions from many proposers stay live **concurrently**: approval applies
the operations to whatever the term's current state is (no base-version guard),
so approving one proposal never invalidates others. Unmatched ops no-op,
duplicate adds dedupe, and an approval that changes nothing is recorded as
**`moot`**.

**Ops are first-class**: each operation of a proposal is stored as its own
`suggestion_ops` row (id, position, op payload, status, applied, resolved_at),
so a suggestion's changes are resolved **one at a time** and each carries its
own lifecycle. `approve`/`reject` name an op by `opId` (400 on an unknown id,
409 once that op is decided); a proposer can `withdraw` their own ops while
they're pending — one at a time or every remaining one (the convenience form).
Owner-decided ops can't be withdrawn; withdrawing never un-applies a change
already in the term.

The parent suggestion's `status` is **always derived** from its ops (no stored
column): `pending` while any op is unresolved, then `approved` (some accepted
op applied), `moot` (accepted ops changed nothing), `withdrawn` (the proposer
pulled the rest — outranks `rejected` in mixed rows), or `rejected` (owner
rejected everything); `resolved_at` is the max over the ops'. The proposer can
`PATCH` the proposal (replacing the ops list, which restarts them as pending)
only while no op is **owner-resolved** (409 `in_review`); their own withdrawn
ops don't freeze the list. The md/csv export annotates each op with its status
(`... [accepted]`). `suggestionStatus`/`pureOps` in
`@major-vis/schedule-core/diff` implement the derivation and the pure-payload
unwrapping; `applyOperations`/`proposeOverlay` stay fully stateless. The
recorded `base_version` is informational only — the paper trail keeps every row
with proposer, note, ops with per-op status, and timestamps.
`GET /api/schedules` returns full term payloads (offerings + versions) so the
app renders directly from the list.

## Reuse

The server imports `@major-vis/schedule-core` for the offering record and can
use any pure domain function (parsing, conflicts) — the same modules the
browser uses. `src/app.js` is a factory (`createApp`) so tests build it against
an in-memory DB and exercise the API over real HTTP (`server/test/`).
