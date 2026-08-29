// Server configuration, read from environment once at boot. Centralizes the
// env contract so the app factory is easy to construct in tests too.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Canonical service keys in nav order (mirrors @major-vis/app-config's
// SERVICE_DEFS). Invalid entries in SERVICES are dropped; the default is the
// schedule app, which is the only service currently exposed to end users.
export const SERVICE_KEYS = ['program', 'schedule', 'planner']
export const DEFAULT_SERVICES = ['schedule']

export function parseServices(input) {
  if (input == null || String(input).trim() === '') return DEFAULT_SERVICES
  const seen = new Set()
  const out = []
  for (const part of String(input).split(',')) {
    const k = part.trim()
    if (SERVICE_KEYS.includes(k) && !seen.has(k)) out.push(k)
    seen.add(k)
  }
  return out.length ? out : DEFAULT_SERVICES
}

export function loadConfig(env = process.env) {
  const repoRoot = path.resolve(__dirname, '..', '..')
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    services: parseServices(env.SERVICES),
    // Where the static apps + catalog JSON live (the repo root by default).
    staticDir: path.resolve(env.STATIC_DIR || repoRoot),
    repoRoot,
    dbPath: path.resolve(env.DB_PATH || path.join(repoRoot, 'server', 'data', 'major-vis.db')),
    sessionCookie: env.SESSION_COOKIE || 'mjv_sid',
  }
}
