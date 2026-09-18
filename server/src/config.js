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

// Identity providers: `username` is self-identify (local dev + tests); `oidc`
// delegates login to an external OpenID Connect issuer (e.g. the college SSO).
export const AUTH_PROVIDERS = ['username', 'oidc']

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

// Truthy env flags: '1' / 'true' (case-insensitive).
function flag(input) {
  const v = String(input ?? '')
    .trim()
    .toLowerCase()
  return v === '1' || v === 'true'
}

// Loopback hosts may speak plain http (a local issuer in dev); anything else
// must be https, and insecure issuers are never allowed in production.
function isLoopbackUrl(value) {
  try {
    const host = new URL(value).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/**
 * @typedef {object} OidcConfig
 * @property {string} issuer
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} redirectUri
 * @property {string} publicOrigin   — empty means "derive from the request" (dev/tests)
 * @property {boolean} allowInsecureIssuer
 */

/**
 * @typedef {object} AuthConfig
 * @property {'username' | 'oidc'} provider
 * @property {boolean} cookieSecure
 * @property {OidcConfig} [oidc]
 */

// The auth slice of the env contract. Fails fast at boot when `oidc` is
// selected but its coordinates are incomplete — a server that cannot complete
// a login should not start.
/**
 * @param {Record<string, string | undefined>} env
 * @returns {AuthConfig}
 */
export function parseAuth(env) {
  const provider = String(env.AUTH_PROVIDER || 'username').trim() || 'username'
  if (!AUTH_PROVIDERS.includes(provider)) {
    throw new Error(`AUTH_PROVIDER must be one of: ${AUTH_PROVIDERS.join(', ')}`)
  }
  /** @type {AuthConfig} */
  const auth = {
    provider: /** @type {'username' | 'oidc'} */ (provider),
    cookieSecure: flag(env.COOKIE_SECURE),
  }
  if (provider !== 'oidc') return auth

  const oidc = {
    issuer: String(env.OIDC_ISSUER || '').trim(),
    clientId: String(env.OIDC_CLIENT_ID || '').trim(),
    clientSecret: String(env.OIDC_CLIENT_SECRET || '').trim(),
    redirectUri: String(env.OIDC_REDIRECT_URI || '').trim(),
    publicOrigin: String(env.PUBLIC_ORIGIN || '').trim(),
    allowInsecureIssuer: false,
  }
  const required = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_REDIRECT_URI']
  const missing = required.filter((key) => !String(env[key] || '').trim())
  if (missing.length) throw new Error(`AUTH_PROVIDER=oidc requires: ${missing.join(', ')}`)
  for (const [key, value] of [
    ['OIDC_ISSUER', oidc.issuer],
    ['OIDC_REDIRECT_URI', oidc.redirectUri],
    ['PUBLIC_ORIGIN', oidc.publicOrigin],
  ]) {
    if (!value) continue
    try {
      new URL(value)
    } catch {
      throw new Error(`${key} must be a valid URL`)
    }
  }
  oidc.allowInsecureIssuer = env.NODE_ENV !== 'production' && isLoopbackUrl(oidc.issuer)
  auth.oidc = oidc
  return auth
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
    auth: parseAuth(env),
    // The default email domain (e.g. 'hanover.edu'): bare usernames typed at
    // sign-in or in access lists are canonicalized to name@domain when set.
    // Empty = no domain default; names are used exactly as typed (the username
    // provider is the common case).
    authDomain: parseAuthDomain(env.AUTH_DOMAIN),
  }
}

// Validates the AUTH_DOMAIN env: a bare domain (no scheme, no path, no @), or
// empty when unset. Anything malformed fails fast at boot — a typo'd domain
// would silently corrupt identity resolution.
export function parseAuthDomain(raw) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
  if (!value) return ''
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) && !value.includes('@') && !value.includes('/')) return value
  throw new Error('AUTH_DOMAIN must be a bare domain like "hanover.edu" (no scheme, path, or @)')
}
