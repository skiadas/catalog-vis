// Client-side service configuration.
//
// Resolves which of the major-vis services (program / schedule / planner) are
// enabled, plus auth metadata, for the app shells' navigation. Sources, tried in
// order:
//   1. a server endpoint (`/api/config`, driven by the deployment's SERVICES
//      env var) — the production source when the backend exists, and
//   2. a static `config.json` adjacent to the deployment — the fallback for
//      the current serverless / GitHub Pages hosting, and
//   3. an in-code default (all services).
//
// Pure JS (no Vue): each app bootstrap `await loadConfig(...)` before mounting,
// so the resolved service list can be rendered straight into the nav.

// The canonical service registry: key is the stable id (used in config files /
// env vars / URLs), label the nav label, dir the app's directory relative to
// the other apps.
export const SERVICE_DEFS = [
  { key: 'program', label: 'Programs', dir: 'browse' },
  { key: 'schedule', label: 'Schedule', dir: 'schedule' },
  { key: 'planner', label: 'Planner', dir: 'planner' },
]

export const SERVICE_KEYS = SERVICE_DEFS.map((s) => s.key)

// Fallback when nothing resolves: all services enabled (matches today's static
// deployment until a config.json / server endpoint is supplied).
export const DEFAULT_SERVICES = [...SERVICE_KEYS]

let state = null
let loading = null

function normalizeServices(input) {
  if (!Array.isArray(input)) return null
  const wanted = new Set(input.filter((k) => typeof k === 'string' && SERVICE_KEYS.includes(k)))
  const out = SERVICE_DEFS.map((s) => s.key).filter((k) => wanted.has(k))
  return out.length ? out : null
}

async function fetchConfig(url, fetchImpl) {
  if (!url) return null
  try {
    const res = await fetchImpl(url)
    if (!res.ok) return null
    const data = await res.json()
    const services = normalizeServices(data && data.services)
    if (!services) return null
    return { services, auth: (data && data.auth) || null }
  } catch {
    return null
  }
}

// Loads the config into module state (shared across the app), trying `endpoint`
// then `staticPath` then `fallback`. Returns the resolved config. Concurrent
// callers share a single fetch. `fallback` may be an array of service keys or a
// full config object.
export function loadConfig({ endpoint, staticPath, fallback = DEFAULT_SERVICES } = {}) {
  if (loading) return loading
  const fetchImpl = globalThis.fetch
  loading = (async () => {
    const base = (await fetchConfig(endpoint, fetchImpl)) || (await fetchConfig(staticPath, fetchImpl))
    if (base) {
      state = base
      return state
    }
    const keys = Array.isArray(fallback) ? fallback : fallback && fallback.services
    state = { services: normalizeServices(keys) || DEFAULT_SERVICES, auth: null }
    return state
  })()
  return loading
}

export function config() {
  return state
}

export function isEnabled(key) {
  return !!(state && state.services.includes(key))
}

// Resets cached state so a new loadConfig can run (used by tests; a fresh page
// always starts with `state === null`).
export function resetConfig() {
  state = null
  loading = null
}
