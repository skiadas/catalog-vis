// Server configuration, read from environment once at boot. Centralizes the
// env contract so the app factory is easy to construct in tests too.
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { canonicalUsername } from './names.js'

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

// A toggle that is ON unless explicitly turned off ('0' / 'false' / 'no' /
// 'off'); an unset value stays ON. The complement of `flag` for opt-out vars.
function toggledOff(input) {
  return /^(0|false|no|off)$/i.test(String(input ?? '').trim())
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

// The default email domain for local development. `npm run serve` runs with
// `NODE_ENV=development`, which makes bare usernames canonicalize to this
// domain — so a directory.csv of bare names (`skiadas`) and a developer's
// sign-in land on the same account. Set `AUTH_DOMAIN=` (empty) to opt out, or
// any explicit value to override.
export const DEV_AUTH_DOMAIN = 'hanover.edu'

// The effective AUTH_DOMAIN: an explicit env value always wins (including an
// explicitly empty one, which disables the default); an unset value falls back
// to DEV_AUTH_DOMAIN in development mode and to no domain otherwise.
export function effectiveAuthDomain(env, devMode) {
  if (env.AUTH_DOMAIN === undefined || env.AUTH_DOMAIN === null) {
    return devMode ? DEV_AUTH_DOMAIN : ''
  }
  return parseAuthDomain(env.AUTH_DOMAIN)
}

// The short (7-char) form of a full commit SHA. Empty in, empty out.
export function shortCommit(sha) {
  const full = String(sha ?? '').trim()
  return full ? full.slice(0, 7) : ''
}

// Best-effort `git rev-parse --short HEAD`, for local development only. The
// container carries no git binary or .git dir, so this never runs in
// production (see parseVersion). Any failure is a silent null.
function gitShortHead(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return String(out).trim() || null
  } catch {
    return null
  }
}

/**
 * Build metadata for the `/api/version` endpoint: which commit the running
 * code came from. The container bakes `GIT_SHA`/`GIT_REF`/`GIT_BUILT_AT` at
 * image build (see the Dockerfile + publish workflow); unset (local `npm run
 * serve`, tests) falls back to the working tree's `git rev-parse --short HEAD`
 * in development, and to nulls otherwise.
 * @param {Record<string, string | undefined>} env
 * @param {{ repoRoot?: string, devMode?: boolean }} [options]
 * @returns {{ commit: string | null, ref: string | null, builtAt: string | null }}
 */
export function parseVersion(env, { repoRoot, devMode } = {}) {
  const commit = shortCommit(env.GIT_SHA)
  if (commit) {
    return {
      commit,
      ref: String(env.GIT_REF || '').trim() || null,
      builtAt: String(env.GIT_BUILT_AT || '').trim() || null,
    }
  }
  if (devMode) {
    const dev = gitShortHead(repoRoot)
    if (dev) return { commit: dev, ref: null, builtAt: null }
  }
  return { commit: null, ref: null, builtAt: null }
}

export function loadConfig(env = process.env) {
  const repoRoot = path.resolve(__dirname, '..', '..')
  // Where the static apps + catalog JSON live (the repo root by default).
  const staticDir = path.resolve(env.STATIC_DIR || repoRoot)
  // Development mode is opt-in and set by the `npm run serve` script alone
  // (NODE_ENV=development). It is what gates the dev-only conveniences below;
  // the container is NODE_ENV=production and the test harnesses are
  // NODE_ENV=test, so neither ever gets them.
  const devMode = env.NODE_ENV === 'development'
  const authDomain = effectiveAuthDomain(env, devMode)
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    services: parseServices(env.SERVICES),
    staticDir,
    repoRoot,
    dbPath: path.resolve(env.DB_PATH || path.join(repoRoot, 'server', 'data', 'major-vis.db')),
    sessionCookie: env.SESSION_COOKIE || 'mjv_sid',
    auth: parseAuth(env),
    // The canonicalization domain for bare usernames (see effectiveAuthDomain):
    // defaults to hanover.edu in dev, explicit-only elsewhere. Empty = names
    // used exactly as typed (the username provider's common case).
    authDomain,
    // Admins (canonical usernames) manage the user directory: display names
    // and the departments each user belongs to. Canonicalized through the same
    // effective domain, so `ADMIN_USERNAMES=haris` matches in dev.
    adminUsernames: parseAdminUsernames(env.ADMIN_USERNAMES, authDomain),
    // Build metadata (see parseVersion): the commit the running code came from.
    version: parseVersion(env, { repoRoot, devMode }),
    // Dev convenience: seed the user directory from the gitignored repo-root
    // `directory.csv` at boot (see seed-directory.js), so a developer sees real
    // display names without signing in as an admin. Dev-only, and
    // `SEED_DIRECTORY=0` disables it for a pristine directory.
    seedDirectory: devMode && !toggledOff(env.SEED_DIRECTORY),
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

// Parses ADMIN_USERNAMES: a comma-separated list of canonical usernames (each
// canonicalized like the auth flows). Unset = no admins (the directory API is
// inert). Returns a Set of canonical names.
export function parseAdminUsernames(raw, domain = '') {
  const out = new Set()
  for (const part of String(raw ?? '').split(',')) {
    const name = canonicalUsername(part, domain)
    if (name) out.add(name)
  }
  return out
}
