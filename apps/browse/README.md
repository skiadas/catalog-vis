# browse app

The program & course catalog browser. Zero local persistence; read-only over
the catalog data contract.

## Inputs

Catalog data via `@major-vis/catalog-client`. `main.js` calls
`loadCatalog({ baseUrl: '../../' })` (the repo-root JSON when co-deployed);
point it at a college-hosted catalog source by changing that `baseUrl`.

## Routes

- `#/` — program list
- `#/program/:id` — program detail (requirements + courses)
- `#/course/:code` — course detail

## Cross-app links (emitted)

- **→ planner**: `../planner/#/?program=<id>&track=<trackKey>` ("Add to planner"
  on each parsed requirement). The planner app parses the query and adds the
  track. (`plannerUrl` in `router.js`.)

## Cross-app links (consumed)

None — this app is a leaf (no local state to deep-link into).

## Serve / lift out

Any static server; the import map in `index.html` resolves `@major-vis/*` to
`../packages/*` relative to this directory, so the whole repo must be served
for now. To lift this app onto its own host: copy `apps/browse/`, point the
import map at your catalog host (or set `catalog-client`'s `baseUrl`), and the
two nav links (`../schedule/`, `../planner/`) at the other apps' hostnames.
