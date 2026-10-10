// Build-time globals injected by Vite's `define` (see vite.apps.mjs). Declared
// here so `vue-tsc` type-checks app code that reads them: `__APP_VERSION__` is
// the short commit SHA the running bundle was built from ('' when unknown —
// local builds without git, or a define that was not applied).

declare const __APP_VERSION__: string
