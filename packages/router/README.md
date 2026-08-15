# @major-vis/router

Tiny hash-router factory shared by the browse, schedule, and planner apps. No
framework beyond the Vue global (`ref`).

## Contract

```js
import { createRouter } from '@major-vis/router'

const { route, init, navigate } = createRouter(routes, fallbackView)
init()
```

- `routes` — array of `{ view, parse(parts, query) → params | null, href(params) → hashPath }`.
  Routes are matched in order against the hash's path segments (`parts`) and
  query params (`query`); the first whose `parse` returns an object wins.
- `fallbackView` — view used when no route matches.
- `route` — reactive `{ view, params }` (Vue ref).
- `init()` — parses the current hash and subscribes to `hashchange`.
- `navigate(view, params)` — sets the hash via the matching route's `href`
  (no-op if no route matches).

`href` returns the part after `#` **without** the leading `#` (e.g. `/program/x`
or `planner?program=y`); `navigate` prepends it. Query params in the hash
(`#/planner?program=x&track=y`) are decoded into `route.params`, which is how
the planner app receives cross-app deep links from the browse app.
