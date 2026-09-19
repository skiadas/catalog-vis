import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, parseAuth, parseAuthDomain, parseAdminUsernames } from '../src/config.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The env vars config.js reads that are deliberately NOT container settings:
// STATIC_DIR and SESSION_COOKIE are dev-only overrides, and NODE_ENV is set by
// nothing at runtime (the image is the production build). Every other env
// loadConfig reads must reach the container through compose.yaml and be
// documented in deploy/.env.example — the deploy seam that a unit-testable
// config() alone cannot protect.
const CONFIG_INTERNAL_ONLY = new Set(['STATIC_DIR', 'SESSION_COOKIE', 'NODE_ENV'])

// The env names loadConfig actually reads, captured by handing it a recording
// proxy (once per auth provider, since the OIDC vars are only touched in that
// branch) — so a new config env is caught without hand-maintaining a list.
function configEnvNames() {
  const names = new Set()
  const values = {
    PORT: '8080',
    HOST: '0.0.0.0',
    SERVICES: 'schedule',
    STATIC_DIR: '/srv',
    DB_PATH: '/data/major-vis.db',
    SESSION_COOKIE: 'mjv_sid',
    AUTH_PROVIDER: 'oidc',
    COOKIE_SECURE: 'true',
    OIDC_ISSUER: 'https://sso.example.org',
    OIDC_CLIENT_ID: 'major-vis',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI: 'https://app.example.org/api/auth/callback',
    PUBLIC_ORIGIN: 'https://app.example.org',
    NODE_ENV: 'production',
    AUTH_DOMAIN: 'hanover.edu',
    ADMIN_USERNAMES: 'admin',
  }
  const env = (provider) =>
    new Proxy(
      { ...values, AUTH_PROVIDER: provider },
      {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined
          names.add(prop)
          return prop in target ? target[prop] : ''
        },
      },
    )
  loadConfig(env('username'))
  loadConfig(env('oidc'))
  return names
}

test('every operator env config.js reads is passed through compose and documented', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8')
  const example = fs.readFileSync(path.join(ROOT, 'deploy', '.env.example'), 'utf8')
  const operatorEnvs = [...configEnvNames()].filter((name) => !CONFIG_INTERNAL_ONLY.has(name))
  assert.ok(operatorEnvs.length > 5, 'sanity: the env contract was captured')
  const missingFromCompose = operatorEnvs.filter((name) => !new RegExp(`^\\s+${name}:`, 'm').test(compose))
  assert.deepEqual(missingFromCompose, [], 'compose.yaml must pass these into the container')
  // Of those, the ones compose sources from .env (`${NAME}`) are operator
  // settings and must be documented in deploy/.env.example. The container
  // wiring compose sets itself (PORT, HOST, DB_PATH) is not operator-facing.
  const fromEnvFile = new Set([...compose.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]))
  const missingFromExample = operatorEnvs.filter(
    (name) => fromEnvFile.has(name) && !new RegExp(`^#?\\s*${name}=`, 'm').test(example),
  )
  assert.deepEqual(missingFromExample, [], 'deploy/.env.example must document these')
})

test('parseAuth defaults to username self-identify with insecure cookies off', () => {
  assert.deepEqual(parseAuth({}), { provider: 'username', cookieSecure: false })
  assert.deepEqual(parseAuth({ COOKIE_SECURE: 'true' }), { provider: 'username', cookieSecure: true })
  assert.deepEqual(parseAuth({ COOKIE_SECURE: '1' }), { provider: 'username', cookieSecure: true })
  assert.equal(parseAuth({ AUTH_PROVIDER: ' username ' }).provider, 'username')
})

test('parseAuth rejects unknown providers', () => {
  assert.throws(() => parseAuth({ AUTH_PROVIDER: 'saml' }), /AUTH_PROVIDER must be one of/)
})

test('parseAuth requires the oidc coordinates and validates their URLs', () => {
  assert.throws(
    () => parseAuth({ AUTH_PROVIDER: 'oidc' }),
    /OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI/,
  )
  const complete = {
    AUTH_PROVIDER: 'oidc',
    OIDC_ISSUER: 'https://sso.example.org',
    OIDC_CLIENT_ID: 'major-vis',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI: 'https://app.example.org/api/auth/callback',
    PUBLIC_ORIGIN: 'https://app.example.org',
  }
  const auth = parseAuth(complete)
  assert.equal(auth.provider, 'oidc')
  assert.equal(auth.oidc.issuer, 'https://sso.example.org')
  assert.equal(auth.oidc.allowInsecureIssuer, false)
  assert.throws(() => parseAuth({ ...complete, OIDC_ISSUER: 'not a url' }), /OIDC_ISSUER must be a valid URL/)
  assert.throws(
    () => parseAuth({ ...complete, OIDC_REDIRECT_URI: 'not a url' }),
    /OIDC_REDIRECT_URI must be a valid URL/,
  )
  assert.throws(
    () => parseAuth({ ...complete, PUBLIC_ORIGIN: 'not a url' }),
    /PUBLIC_ORIGIN must be a valid URL/,
  )
})

test('parseAuth allows a loopback http issuer only outside production', () => {
  const base = {
    AUTH_PROVIDER: 'oidc',
    OIDC_ISSUER: 'http://127.0.0.1:3000',
    OIDC_CLIENT_ID: 'major-vis',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI: 'http://127.0.0.1:8080/api/auth/callback',
  }
  assert.equal(parseAuth(base).oidc.allowInsecureIssuer, true)
  assert.equal(parseAuth({ ...base, NODE_ENV: 'production' }).oidc.allowInsecureIssuer, false)
  assert.equal(parseAuth({ ...base, OIDC_ISSUER: 'http://sso.example.org' }).oidc.allowInsecureIssuer, false)
})

test('loadConfig exposes the auth slice', () => {
  const config = loadConfig({})
  assert.equal(config.auth.provider, 'username')
  assert.equal(config.auth.cookieSecure, false)
})

test('parseAuthDomain accepts a bare domain and rejects malformed ones', () => {
  assert.equal(parseAuthDomain(undefined), '')
  assert.equal(parseAuthDomain(''), '')
  assert.equal(parseAuthDomain('  HANOVER.EDU '), 'hanover.edu')
  assert.equal(parseAuthDomain('sub.example.org'), 'sub.example.org')
  for (const bad of ['https://hanover.edu', 'hanover.edu/path', '@hanover.edu', 'no-dot', 'a b']) {
    assert.throws(() => parseAuthDomain(bad), /AUTH_DOMAIN must be a bare domain/)
  }
})

test('loadConfig exposes authDomain', () => {
  assert.equal(loadConfig({}).authDomain, '')
  assert.equal(loadConfig({ AUTH_DOMAIN: 'Hanover.edu' }).authDomain, 'hanover.edu')
})

test('parseAdminUsernames canonicalizes the comma list; unset means no admins', () => {
  assert.deepEqual(parseAdminUsernames(undefined), new Set())
  assert.deepEqual(parseAdminUsernames(''), new Set())
  assert.deepEqual(
    parseAdminUsernames('CSkiadas, wahl@hanover.edu, bob'),
    new Set(['cskiadas', 'wahl@hanover.edu', 'bob']),
  )
  assert.deepEqual(parseAdminUsernames('bob, BOB', 'hanover.edu'), new Set(['bob@hanover.edu']))
})

test('loadConfig exposes adminUsernames', () => {
  assert.deepEqual(loadConfig({}).adminUsernames, new Set())
  assert.deepEqual(loadConfig({ ADMIN_USERNAMES: 'a, b' }).adminUsernames, new Set(['a', 'b']))
})
