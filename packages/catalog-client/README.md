# @major-vis/catalog-client

Browser catalog data layer shared by all apps. Fetches the three catalog
artifacts into Vue-reactive refs and derives browse filters. This is the
read-only side of the catalog contract (see `@major-vis/catalog-contract` for
the schemas and types).

Browser-only (fetches via `fetch`), so the apps' unit-tested engines
(`schedule-core`, `degree-audit`) never import it.

## Contract

### Refs

- `programs` — `majors.json.programs`
- `allCourses` — course index keyed by concrete `PREFIX NNN` code (global
  `catalog` unioned with per-program courses)
- `parsedRequirements` — `{ programId: requirement[] }` from
  `requirements_parsed.json`
- `coreRequirements` — the single core-curriculum program's requirements from
  `core_requirements.json`
- `loading` — true until `loadCatalog` finishes
- `errorMessage` — human-readable reason the catalog couldn't be loaded (fetch
  failure or contract validation failure), or `''` when all is well; the apps
  render it instead of the catalog UI
- `searchQuery`, `filterType` — browse-list filter inputs
- `filteredPrograms` — derived, filtered program list

The refs and helpers are JSDoc-typed against `@major-vis/catalog-contract`'s
declarations, so consumers type-check against the real catalog shape.

### Loading

```js
await loadCatalog() // page-relative JSON
await loadCatalog({ baseUrl: 'https://catalog.example.edu/api/' })
await loadCatalog({
  baseUrl: '../../',
  files: { majors: 'majors.json', parsed: 'requirements_parsed.json', core: 'core_requirements.json' },
})
```

`baseUrl` is the **single configuration seam**: point an app at a
college-hosted catalog API (or another host) by changing it. The catalog host
must allow CORS when apps are served from a different origin (GitHub Pages
sends `Access-Control-Allow-Origin: *`).

By default every fetched document is validated against the catalog contract
(`validate: true`) before it is stored; on failure `errorMessage` is set, the
refs stay empty, and the promise rejects (the apps render the message instead
of an empty catalog). Pass `{ validate: false }` to skip the check.

### Helpers

- `programsUsingCourse(code)` → `[{ program }]`
- `courseByCode(code)` → the course record or `null`
- `courseName(code)` → the course's `course_name` or `''` (the one way
  components look up a course name)
- `filteredPrograms` (computed, via `searchQuery`/`filterType`)

## Consumers

All three apps import catalog data only through this package (via the app's
import map). App-specific state (planner plans, schedule collections, filters)
lives in the apps' own stores, never here.
