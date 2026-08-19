# Integration Plan: toward college infrastructure

Status: approved direction; Phase 1 in progress. Tagged snapshot: `v0.2.0`.

This document is the working plan for moving the major-vis project from a
static, browser-only, GitHub-Pages-deployable set of apps toward a deployed
college system: configurable services, year/term schedules, CSV ingestion,
database persistence, login, and ownership with suggested edits.

## Goals

1. Toggle which services (program / schedule / planner) appear in the UI.
   Schedule is the only service initially available to end users.
2. Replace the single-term schedule with a **yearly schedule**: an entry with a
   name + year that inherently has **Fall, Winter, Spring** parts, each holding
   its own set of course offerings. Spring uses different time slots.
3. Support courses that must appear in a schedule but have no time slot
   (independent studies).
4. Support arbitrary start/end times as the exception rather than the norm.
5. Create schedules via CSV upload.
6. Persist and share schedules between users via a database.
7. Let people log in (self-identify by username for now; SSO / one-time-code
   later behind the same seam).
8. Release the GitHub Pages self-deployability constraint — a real backend is
   now the deployment target.
9. Schedules are owned by their creator but visible to all. A non-owner's edit
   becomes a "suggested edit" (a diff, e.g. "CS 220: change instructor from
   Wahl to Skiadas"), exportable, and individually approvable/rejectable by the
   owner.

## Architecture direction

- **Frontend stays static & build-free.** The three apps keep their Vue-CDNG
  global + import-map model. `@major-vis/*` packages keep their contracts.
- **New Node backend** (`server/` workspace package): Node + Express + the
  built-in **`node:sqlite`** (Node ≥ 22.5; no native deps, no node-gyp in CI).
  It reuses `@major-vis/schedule-core` and `@major-vis/degree-audit` directly
  (pure ESM, no Vue). A repository layer keeps Postgres a later swap. Serves the
  static apps, the catalog JSON, and `/api/*` from one origin.
- **The `catalog-client` `baseUrl` seam is unchanged**; apps point it at the
  server, which hosts the pipeline artifacts (or a normalized API later).
- **Identity** is a pluggable provider (`AUTH_PROVIDER`): `username` (no
  password, self-identify) first; one-time-code / SSO later without frontend
  changes.

### Stack decision (revised)

The backend uses Node's built-in **`node:sqlite`** rather than a native SQLite
binding, and the repo floor is bumped from Node 20 to **Node 22.5+** (CI runs
Node 24). This drops the `better-sqlite3` native build entirely (no node-gyp in
CI), keeps tests dependency-free, and matches the modern-Node direction — the
apps stay static/build-free while the backend uses only Express as an external
dependency.

## The schedule model

> Clarified: a **schedule** is created by picking a **name** + **year**. It
> inherently has three parts — **Fall (F), Winter (W), Spring (S)** — created
> empty. You switch into a part to add/edit courses. Multiple schedules may
> share a year (Math's proposals, Bio's, the registrar's official draft), each
> with its own F/W/S parts. The `year` is an attribute used for grouping.

### Offering record (evolution)

```js
{
  id: string,          // NEW: stable identity, app-assigned on import/creation
  prefix: 'CS', number: '220', section: 'A', instructor: 'Wahl',
  days: 'MWF' | 'MTWRF' | '',   // '' = unscheduled (independent study, etc.)
  time: '9:20-10:30' | '',      // '' = unscheduled; otherwise any HH:MM-HH:MM band
}
```

- Registrar-shaped fields (`prefix/number/section/instructor/days/time`) are
  unchanged; `id` is additive (registrar feeds omit it, we assign on import).
- Empty `days`/`time` ⇒ unscheduled: present in the schedule/CSV, absent from
  the calendar grid and conflict detection.

### Term calendar configs (schedule-core)

Replace the hardcoded `SLOT_BLOCKS` (currently `packages/schedule-core/schedule.js:23-42`)
with `TERM_CONFIGS`:

```js
TERM_CONFIGS = {
  F: { key: 'F', label: 'Fall',   dayGroups: [MWF-group(6 slots), TR-group(4 slots)], dayStart: 480, dayEnd: 960, maxConsecutiveSlots: 1 },
  W: { key: 'W', label: 'Winter', dayGroups: [MWF-group(6 slots), TR-group(4 slots)], dayStart: 480, dayEnd: 960, maxConsecutiveSlots: 1 },
  S: { key: 'S', label: 'Spring', dayGroups: [MTWRF-group], dayStart: 480, dayEnd: 1020, maxConsecutiveSlots: 2 },
}
```

- Spring: one `MTWRF` group, 4 base slots `8:00-10:15 / 10:15-12:30 /
12:30-2:45 / 2:45-5:00`, all days identical.
- A helper `termSlotOptions(config, day)` yields assignable bands = single
  slots plus up to `maxConsecutiveSlots` consecutive combinations (Spring:
  4 singles + 3 pairs = 7 options).
- `rescheduleDays` / `moveOfferingSmart` generalize from the hardcoded MWF/TR
  split to the config's day groups (Spring is one group; default day-set for a
  new Spring course is `MTWRF`).
- `makeSchedule` (generation) becomes term-aware (samples from the term's
  bands).
- Calendar vertical range becomes config/computed from actual offerings instead
  of fixed `DAY_START_MIN`/`DAY_END_MIN` (arbitrary times render correctly).

### DB schema

```sql
users(id, username UNIQUE, created_at)
sessions(id, user_id, token_hash, created_at, expires_at)
schedules(id, name, year, owner_user_id, status, version, created_at, updated_at)
  -- status: 'draft' | 'official'  (registrar's canonical draft is 'official')
schedule_terms(id, schedule_id, term 'F'|'W'|'S', payload JSON, version, updated_at)
  -- one row per (schedule, term); created empty when a schedule is created
schedule_changes(id, schedule_id, term, proposer_user_id, status, base_version,
                 change_payload, note, created_at, resolved_at)
  -- status: 'pending' | 'approved' | 'rejected'; change_payload is the diff ops
```

Schedules and term payloads are versioned per term so approvals apply targeted
patches without rewriting a whole year.

### API contract

```
GET    /api/config                       -> { services, auth: { provider, user? } }
GET    /api/auth/session                 -> { user } | 401
POST   /api/auth/login { username }      -> { user }     (provider: username)
POST   /api/auth/logout
GET    /api/schedules?year=2026-27       -> [{ id, name, year, owner, status, ... }]
POST   /api/schedules { name, year }     -> creates entry + 3 empty term parts
GET    /api/schedules/:id                -> { id, name, year, owner, status,
                                             terms: { f: {offerings}, w, s } }
PATCH  /api/schedules/:id                -> rename / mark official (owner)
DELETE /api/schedules/:id                -> (owner)
PUT    /api/schedules/:id/terms/:term    -> replace a term's offerings (owner)
POST   /api/schedules/:id/terms/:term/suggestions
                                         -> { baseVersion, payload } -> pending changes
GET    /api/schedules/:id/changes        -> pending changes (owner sees all; others see own)
POST   /api/changes/:id/approve          -> applies patch, bumps version (owner)
POST   /api/changes/:id/reject           -> discards (owner)
GET    /api/schedules/:id/changes/export?fmt=json|md|csv
```

### Ownership & suggested edits

- Each schedule has one owner (the creating username). Everyone authenticated
  can view and can work on a **draft copy** in the UI.
- A non-owner submitting their work sends `{ baseVersion, payload }`; the server
  diffs against that version and stores `schedule_changes` rows (per term).
- Pure diff/patch module in schedule-core (`diff.js`): `diffTerms(before, after)` →
  ops `add-offering` / `remove-offering` / `update-offering` carrying `term` and
  per-field `{ field, from, to }`; `applyChange(term, change)`; `describeChange`
  ("Winter 2026 · CS 220 — change instructor from Wahl to Skiadas");
  `renderChanges` (JSON / Markdown / CSV).
- Owner sees a "Suggested changes" panel: per-item approve/reject; item review
  also possible via the exported list. Changes reference the `base_version`
  they were built on; stale bases warn / re-ground before apply.

### CSV contract (one round-trip format)

Columns: `dept-prefix, course-number, section, instructor, days, times`
plus an optional `term` column (`F|W|S`). Blank `days`/`times` ⇒ unscheduled.
`parseCsv` gains quoted-field + optional-column handling; new `renderCsv`
matches it. Rows with a `term` value land in that term part; rows without one
land in the actively-open part. This doubles as the registrar-feed format.

## Service configuration (item 1)

- Server reads `SERVICES=schedule` (comma-separated, keys `program|schedule|
planner`; invalid keys rejected) and serves it via `GET /api/config`.
  Default when unset: `schedule` for production behavior; all three for dev.
- New tiny client package `@major-vis/app-config`: `loadConfig({ baseUrl })` →
  cached `{ services, auth }`; `isEnabled('schedule')`. Fetches `/api/config`
  when a server is present; falls back to a static `config.json` for dev/static.
- Root `index.html` becomes a launcher: fetch config, redirect to the first
  enabled service; render a chooser when several are enabled.
- Each app's nav filters `../<app>/` links by `isEnabled`.

## Shared package changes summary

- `schedule-core`: `TERM_CONFIGS`, `termSlotOptions`, generalized
  `rescheduleDays`/`moveOfferingSmart`, `buildIndex` unscheduled support +
  computed day range, `parseCsv`/`renderCsv` round-trip (+ quoted fields),
  new `diff.js` (diff/apply/describe/render), offering `id` support,
  term-aware `generate`.
- new `app-config`: services + auth config client.
- `catalog-client`: unchanged contract (the `baseUrl` seam is reused).
- `schedule-core`/`degree-audit` stay pure and `node --test`-able.

## App changes summary

- `schedule`: year picker + schedule list → Fall/Winter/Spring tabs; Spring
  slot options (incl. consecutive pairs); "Unscheduled" shelf; custom-time
  editing; CSV upload; auth prompt (self-identify); draft-edit workflow;
  owner "Suggested changes" panel.
- all apps: config-driven nav; root launcher.
- Apps remain static/served by the backend from one origin.

## Phases

Each phase ends with the AGENTS.md verification gates: `npx prettier --check`,
`npm test`, `npm run validate:catalog`, `npm run test:data`,
`npm run check:css`, `npm run lint`, `python3 -m black .`,
`python3 -m compileall`.

1. **Foundation — service toggle.** `@major-vis/app-config`, `GET /api/config`,
   root launcher, config-filtered nav. Ship schedule-only.
2. **Schedule model.** `TERM_CONFIGS`, schedule→term-parts, unscheduled,
   custom times, CSV round-trip + upload. New schedule-core tests.
3. **Backend + identity.** Express + `node:sqlite` server, sessions, username
   login, schedules/terms/changes APIs, static + catalog hosting. The schedule
   store's `src/backend.js` mirrors it (list/create/replace + fallback to
   localStorage when no server is present). **Delivered.**
4. **Ownership + suggestions.** Offering ids, diff module, draft workflow,
   change list + approve/reject + export.
5. **College rollout.** OTC/SSO provider if wanted; deployment docs (env vars,
   TLS, CORS, backups); catalog serving via the seam.

## Deferred decisions

- One-time-code / SSO provider specifics (seam exists; not yet built).
- Catalog serving via normalized API vs static JSON artifacts (seam unchanged).
- Deployment runner for the college (VM / Docker / existing infra).
- Whether email/SMTP is available for future OTC delivery.
- Academic year label convention (e.g. `2026-27`).
