# @major-vis/catalog-client

Browser catalog data layer shared by all apps. Fetches the three catalog
artifacts into Vue-reactive refs and derives browse filters. This is the
read-only side of the catalog contract (see `@major-vis/catalog-contract` for
the schemas).

Depends on the **Vue global** (CDN), matching the app views' pattern — it is
browser-only and not `node --test`-able (unlike the pure engine packages).

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
- `searchQuery`, `filterType` — browse-list filter inputs
- `filteredPrograms` — derived, filtered program list

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

### Helpers

- `programsUsingCourse(code)` → `[{ program }]`
- `filteredPrograms` (computed, via `searchQuery`/`filterType`)

## Consumers

All three apps import catalog data only through this package (via the app's
import map). App-specific state (planner plans, schedule collections, filters)
lives in the apps' own stores, never here.
