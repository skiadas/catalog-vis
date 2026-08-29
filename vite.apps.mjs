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
import { readFile, readdirSync, statSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { compile } from 'sass'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

// The catalog artifacts the apps fetch via `loadCatalog({ baseUrl })`. In the
// co-deployed layout these live at the repo root, two levels above each app;
// in dev the app is served at the origin root, so the relative `../../` would
// resolve to `/majors.json` which the dev server (rooted at apps/<name>) can't
// find. This plugin serves them from the repo root during `vite serve` only;
// `vite build` is untouched (deployed apps keep resolving the shared-root
// layout as designed).
const CATALOG_FILES = ['majors.json', 'requirements_parsed.json', 'core_requirements.json']

const catalogDevPlugin = {
  name: 'major-vis-catalog-dev',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const name = CATALOG_FILES.find((f) => req.url.startsWith(`/${f}`))
      if (!name) return next()
      readFile(resolve(repoRoot, name), (err, data) => {
        if (err) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(data)
      })
    })
  },
}

// Compiles the app's stylesheet from SCSS (style/<name>.scss + partials) and
// writes `apps/<name>/style.css`. The compiled file is deliberately NOT in
// version control: Vite produces it here, in dev (served fresh from the
// middleware, invalidated on any SCSS change) and in build (written in
// `buildStart` so the index.html `<link>` resolves before the bundle runs).
// The SCSS sources are the only authority; a compile error fails the build.
function scssPlugin(name) {
  const sources = () => {
    const partialsDir = resolve(repoRoot, 'style', 'partials')
    return [
      resolve(repoRoot, 'style', `${name}.scss`),
      ...readdirSync(partialsDir)
        .filter((f) => f.endsWith('.scss'))
        .map((f) => resolve(partialsDir, f)),
    ]
  }
  const mtimeKey = () =>
    sources()
      .map((f) => statSync(f).mtimeMs)
      .join(':')
  let cache = { key: '', css: '' }
  const compiled = () => {
    const key = mtimeKey()
    if (cache.key !== key) {
      cache = { key, css: compile(resolve(repoRoot, 'style', `${name}.scss`)).css }
      writeFileSync(resolve(repoRoot, 'apps', name, 'style.css'), cache.css)
    }
    return cache.css
  }
  return {
    name: 'major-vis-scss',
    buildStart() {
      compiled()
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url.split('?')[0] !== '/style.css') return next()
        res.setHeader('Content-Type', 'text/css')
        res.setHeader('Cache-Control', 'no-store')
        res.end(compiled())
      })
    },
  }
}

export function appConfig(name) {
  return defineConfig({
    root: resolve(repoRoot, 'apps', name),
    base: './',
    plugins: [catalogDevPlugin, scssPlugin(name)],
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
