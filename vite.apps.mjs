// Shared Vite config factory for the three independently-deployable apps.
//
// Each app keeps its own root (apps/<name>), so a build is a self-contained
// static bundle. `base: './'` makes every emitted asset URL relative, which
// lets a built app run from any host, path, or internal IP with no per-deploy
// configuration. Bare `@major-vis/*` imports resolve through the workspace
// package `exports` fields — this replaces the per-app import maps and makes
// bad imports a build-time error instead of a browser runtime crash.
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

export function appConfig(name) {
  return defineConfig({
    root: resolve(repoRoot, 'apps', name),
    base: './',
    build: {
      outDir: resolve(repoRoot, 'dist', name),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        // The apps are plain template strings rendered at runtime (no .vue
        // single-file components), so they need the full Vue build that ships
        // the template compiler rather than the runtime-only default export.
        vue: 'vue/dist/vue.esm-bundler.js',
      },
    },
    define: {
      // Feature flags the full Vue build expects; Options API must stay on
      // because every component is authored as an options object.
      __VUE_OPTIONS_API__: true,
      __VUE_PROD_DEVTOOLS__: false,
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
  })
}