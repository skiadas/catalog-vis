import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig, parseAuth, parseAuthDomain } from '../src/config.js'

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
