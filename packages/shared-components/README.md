# @major-vis/shared-components

Shared Vue 3 components for the major-vis apps. This is the home for UI the
apps share, so a repeated look has one implementation instead of a copy per app.
(Styles still live in the root `style/partials/`; this package owns the
components that consume them.)

Today it ships the **notifier**:

- **`Notifier`** — a component that mounts the sonner `<Toaster>` host (and its
  stylesheet). Each app renders it **once** at its root (`App.vue`) so a toast
  survives the route/overlay change that triggered it.
- **`notify`** — a tiny wrapper over `vue-sonner`'s `toast`:
  - `notify.success(message)`
  - `notify.error(message)`
  - `notify.action(message, { label, onClick, duration })` — a persistent,
    actionable toast (defaults to `duration: Infinity`), used for e.g. the
    "newer version available → Refresh" prompt.

App code depends on `notify.*`, never on `vue-sonner` directly, so the toast
library stays swappable behind this file.

## Usage

```js
import { Notifier, notify } from '@major-vis/shared-components'
// Render <Notifier /> once in the app root; call notify.* from anywhere.
```

## Notes

- The top-nav markup, currently duplicated in each app's `App.vue`, is a future
  candidate to move here; it is deliberately out of scope for now.
- Component behavior is covered by the Playwright e2e suite (and `npm run
  probe` boot smoke), not node unit tests — there is no DOM/component test
  stack in the repo by design.
