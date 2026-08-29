# @major-vis/catalog-contract

The catalog data contract: what the catalog pipeline emits and what the
consuming apps depend on. Anyone producing catalog data (a re-scrape, the
college's own feed, a new consumer app) should conform to this package's
schemas.

## Artifacts the pipeline emits

| File | Producer | Schema |
|------|----------|--------|
| `majors.json` | `scrape_catalog.py` | `schemas/majors.schema.json` |
| `requirements_parsed.json` | `codify_requirements.py` (LLM-assisted) | `schemas/requirements.schema.json` |
| `core_requirements.json` | `extract_core.py` | `schemas/core.schema.json` |

Plus generated reports that are **not** part of the runtime contract:
`catalog_issues.{json,md,html}` (`audit_catalog.py` + `md_to_html.py`).

## Schemas

Formal JSON Schemas (draft 2020-12) live in `schemas/`. They are a **parallel
artifact** to the human-oriented `REQUIREMENTS_SCHEMA.md` and the imperative
invariants in `tools/catalog-pipeline/test_data.py` — the schema covers
structure and vocabulary; `test_data.py` keeps the derived/relational rules
(program `id` derived from name, track-slug uniqueness, cross-file code
integrity). Keep all three in sync when the contract changes.

The **code projection** of the contract lives in `types.d.ts` — hand-authored
TypeScript types for the three documents, consumed by JS/TS code through
JSDoc `import()`s. Data conformance stays the schemas' job (`validate:catalog`);
type conformance is witnessed by `types.witness.ts` + `test/types.test.js`, both
checked in CI (`npm run typecheck` / `npm test`). When the contract changes,
update `schemas/`, the invariants, **and** `types.d.ts` together — the two
witnesses are the tripwires.

### Validate

```sh
node validate.mjs         # or: npm run validate:catalog (from repo root)
```

This checks the committed data files at the repo root against the schemas.
CI runs it on every push.

## Consumer-needs matrix

Which parts of each artifact each consumer actually uses. Consumers import the
data through `@major-vis/catalog-client` (browser) or fetch the JSON directly.

| Data | browse app | planner app | schedule app | degree-audit | schedule-core |
|------|-----------|-------------|--------------|--------------|---------------|
| `majors.json.programs` (`id`, `name`, `type`, `course_prefix`, `courses`, `faculty`) | ✓ | ✓ (pick tracks) | ✓ (faculty pools for generation) | | |
| `majors.json.catalog` (course index by code) | ✓ | ✓ | ✓ | ✓ (as the universe) | |
| `requirements_parsed.json` (program → structured requirement nodes) | ✓ (render) | ✓ (tracks + audit) | | ✓ (evaluate) | |
| `core_requirements.json` (CCR/ACE areas) | | ✓ (core track) | | ✓ | |
| Course offering records (`prefix/number/section/instructor/days/time`) | | | ✓ (store + index) | | ✓ (domain) |

## Join keys

The contract is keyed by strings that are stable across re-scrapes:

- **Course code**: `PREFIX NNN` (e.g. `BIO 161`). Cross-listed and aliased
  forms appear in requirement text (`ENG/COM 251`, `GNDR 499`) and are resolved
  by `expandCode` in `@major-vis/degree-audit`; the concrete `catalog` keys are
  always plain `PREFIX NNN`.
- **Program id**: derived from the program name (`anthropologycultural`).
- **Track key**: slug of a parsed requirement's `label`, stable per program
  (see `lib` in `@major-vis/catalog-client`/planner store).
- **Requirement area id** (core only): the CCR/ACE code (`LA`, `HS`, `WL`, …).

## Consuming it

- Browser apps resolve `@major-vis/catalog-contract` (and the other
  `@major-vis/*` packages) via each app's import map — see
  `apps/*/index.html`.
- To reimplement a consumer elsewhere, depend on the schemas here and the pure
  engine contracts in `@major-vis/degree-audit` and `@major-vis/schedule-core`.
- To point an app at a different catalog source (e.g. a college-hosted API),
  change the `baseUrl` passed to `loadCatalog` in the app's `main.js`.
