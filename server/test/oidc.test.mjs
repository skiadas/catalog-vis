// End-to-end tests for the OIDC provider: a minimal mock OpenID Provider
// (discovery + JWKS + token endpoint) plays the issuer, and the test drives
// both ends of the flow — it reads the authorization URL the app builds,
// mints the code the OP would return, and hits the app's callback like the
// browser would. openid-client does the real discovery, PKCE, and ID-token
// validation against the mock.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import crypto from 'node:crypto'
import { once } from 'node:events'
import { openDb, createOidcFlow } from '../src/db.js'
import { createApp } from '../src/app.js'

// ---- Mock OpenID Provider ---------------------------------------------------

async function startMockOp() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' }
  /** @type {Map<string, { codeChallenge: string, nonce: string, email: string }>} */
  const codes = new Map()
  let base = ''

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', base)
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/.well-known/openid-configuration') {
      return send(200, {
        issuer: base,
        authorization_endpoint: `${base}/auth`,
        token_endpoint: `${base}/token`,
        jwks_uri: `${base}/jwks`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['client_secret_post'],
        code_challenge_methods_supported: ['S256'],
        id_token_signing_alg_values_supported: ['RS256'],
        subject_types_supported: ['public'],
      })
    }
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] })
    if (url.pathname === '/token' && req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = new URLSearchParams(Buffer.concat(chunks).toString())
      const entry = codes.get(String(body.get('code') || ''))
      if (!entry) return send(400, { error: 'invalid_grant' })
      if (body.get('client_id') !== 'test-client' || body.get('client_secret') !== 'test-secret') {
        return send(401, { error: 'invalid_client' })
      }
      const challenge = crypto
        .createHash('sha256')
        .update(String(body.get('code_verifier') || ''))
        .digest('base64url')
      if (challenge !== entry.codeChallenge) {
        return send(400, { error: 'invalid_request', error_description: 'PKCE failed' })
      }
      const now = Math.floor(Date.now() / 1000)
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString(
        'base64url',
      )
      const payload = Buffer.from(
        JSON.stringify({
          iss: base,
          aud: 'test-client',
          sub: entry.email,
          email: entry.email,
          nonce: entry.nonce,
          iat: now,
          exp: now + 300,
        }),
      ).toString('base64url')
      const signature = crypto
        .sign('sha256', Buffer.from(`${header}.${payload}`), privateKey)
        .toString('base64url')
      return send(200, {
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: `${header}.${payload}.${signature}`,
      })
    }
    send(404, { error: 'not_found' })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`

  return {
    base,
    // The test plays the authorization endpoint: it records what the browser
    // was asked to approve and mints the code the OP would return.
    issueCode({ codeChallenge, nonce, email }) {
      const code = crypto.randomBytes(8).toString('hex')
      codes.set(code, { codeChallenge, nonce, email })
      return code
    },
    close: () => new Promise((done) => server.close(done)),
  }
}

// ---- App under test ---------------------------------------------------------

// The app needs its own base URL (for the registered redirect URI), so the
// HTTP server starts first with a placeholder handler and the real app is
// installed once the port is known.
async function startOidcApp(op) {
  const database = await openDb(':memory:')
  let handler = (req, res) => {
    res.statusCode = 503
    res.end()
  }
  const server = http.createServer((req, res) => handler(req, res))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address()
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  handler = createApp({
    database,
    services: ['schedule'],
    auth: {
      provider: 'oidc',
      cookieSecure: false,
      oidc: {
        issuer: op.base,
        clientId: 'test-client',
        clientSecret: 'test-secret',
        redirectUri: `${base}/api/auth/callback`,
        publicOrigin: base,
        allowInsecureIssuer: true,
      },
    },
  })
  return {
    base,
    db: database,
    close: async () => {
      await new Promise((done) => server.close(done))
      database.close()
    },
  }
}

// A cookie-jar fetch that never follows redirects (the login 302 goes to the
// mock OP's authorization endpoint, which only a browser would visit).
function makeClient(base) {
  const cookies = /** @type {Record<string, string>} */ ({})
  return {
    cookies,
    /**
     * @param {string} path
     * @param {{ method?: string, body?: unknown }} [options]
     */
    async request(path, { method = 'GET', body } = {}) {
      const headers = /** @type {Record<string, string>} */ ({})
      const jar = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      if (jar) headers.Cookie = jar
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      const res = await fetch(base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      })
      for (const sc of res.headers.getSetCookie()) {
        const [pair] = sc.split(';')
        const i = pair.indexOf('=')
        if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1)
      }
      return res
    },
  }
}

// Runs the first leg (login → authorization URL) and returns its params.
async function beginLogin(client, returnTo) {
  const res = await client.request(
    `/api/auth/login${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`,
  )
  assert.equal(res.status, 302)
  return new URL(res.headers.get('location'))
}

// ---- Tests ------------------------------------------------------------------

test('oidc: /api/config reports the oidc provider and username login is gone', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    const c = makeClient(app.base)
    const config = await (await c.request('/api/config')).json()
    assert.equal(config.auth.provider, 'oidc')
    assert.equal(config.auth.user, null)
    assert.equal((await c.request('/api/auth/login', { method: 'POST', body: { username: 'alice' } })).status, 404)
  } finally {
    await app.close()
    await op.close()
  }
})

test('oidc: login redirects to the issuer with state, nonce, and PKCE S256', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    const c = makeClient(app.base)
    const url = await beginLogin(c, '/apps/schedule/')
    assert.equal(url.origin, op.base)
    assert.equal(url.pathname, '/auth')
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('client_id'), 'test-client')
    assert.equal(url.searchParams.get('redirect_uri'), `${app.base}/api/auth/callback`)
    assert.equal(url.searchParams.get('scope'), 'openid email')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    for (const param of ['state', 'nonce', 'code_challenge']) {
      assert.ok(url.searchParams.get(param), param)
    }
  } finally {
    await app.close()
    await op.close()
  }
})

test('oidc: callback provisions the user by email, starts a session, and returns to the app', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    const c = makeClient(app.base)
    const authUrl = await beginLogin(c, '/apps/schedule/')
    const code = op.issueCode({
      codeChallenge: authUrl.searchParams.get('code_challenge'),
      nonce: authUrl.searchParams.get('nonce'),
      email: 'Alice@Hanover.edu',
    })
    const cb = await c.request(
      `/api/auth/callback?code=${code}&state=${authUrl.searchParams.get('state')}`,
    )
    assert.equal(cb.status, 302)
    assert.equal(cb.headers.get('location'), `${app.base}/apps/schedule/`)

    // The session cookie is live and schedule APIs work with it.
    const session = await (await c.request('/api/auth/session')).json()
    assert.equal(session.user.username, 'alice@hanover.edu')
    assert.equal((await c.request('/api/schedules')).status, 200)

    // Anonymous visitors still see nothing.
    const anon = makeClient(app.base)
    assert.equal((await anon.request('/api/schedules')).status, 401)

    // A second login reuses the same user row (no duplicate identities).
    const authUrl2 = await beginLogin(c)
    const code2 = op.issueCode({
      codeChallenge: authUrl2.searchParams.get('code_challenge'),
      nonce: authUrl2.searchParams.get('nonce'),
      email: 'alice@hanover.edu',
    })
    const cb2 = await c.request(
      `/api/auth/callback?code=${code2}&state=${authUrl2.searchParams.get('state')}`,
    )
    assert.equal(cb2.status, 302)
    assert.equal(cb2.headers.get('location'), `${app.base}/`)
    const session2 = await (await c.request('/api/auth/session')).json()
    assert.equal(session2.user.id, session.user.id)
  } finally {
    await app.close()
    await op.close()
  }
})

test('oidc: unknown or replayed state is rejected without a session', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    const c = makeClient(app.base)
    const authUrl = await beginLogin(c)
    const code = op.issueCode({
      codeChallenge: authUrl.searchParams.get('code_challenge'),
      nonce: authUrl.searchParams.get('nonce'),
      email: 'alice@hanover.edu',
    })
    const state = authUrl.searchParams.get('state')
    assert.equal(
      (await c.request(`/api/auth/callback?code=${code}&state=not-a-state`)).headers.get('location'),
      `${app.base}/?auth_error=invalid_state`,
    )
    // First use of the real state succeeds; the replay is rejected.
    assert.equal((await c.request(`/api/auth/callback?code=${code}&state=${state}`)).status, 302)
    const replay = await c.request(`/api/auth/callback?code=${code}&state=${state}`)
    assert.equal(replay.headers.get('location'), `${app.base}/?auth_error=invalid_state`)
  } finally {
    await app.close()
    await op.close()
  }
})

test('oidc: expired flows are rejected', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    createOidcFlow(app.db, {
      state: 'stale-state',
      nonce: 'n',
      codeVerifier: 'v',
      ttl: -1,
    })
    const c = makeClient(app.base)
    const res = await c.request('/api/auth/callback?code=x&state=stale-state')
    assert.equal(res.headers.get('location'), `${app.base}/?auth_error=invalid_state`)
  } finally {
    await app.close()
    await op.close()
  }
})

test('oidc: issuer errors return to the app path with an auth_error code', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    const c = makeClient(app.base)
    const authUrl = await beginLogin(c, '/apps/schedule/')
    const state = authUrl.searchParams.get('state')
    const res = await c.request(`/api/auth/callback?error=access_denied&state=${state}`)
    assert.equal(res.headers.get('location'), `${app.base}/apps/schedule/?auth_error=sso_access_denied`)
  } finally {
    await app.close()
    await op.close()
  }
})

test('oidc: a token exchange failure signs nobody in', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  // The provider logs the exchange failure; keep the test output quiet.
  const logError = console.error
  console.error = () => {}
  try {
    const c = makeClient(app.base)
    const authUrl = await beginLogin(c)
    // No code issued to the mock OP, so the exchange fails there.
    const res = await c.request(
      `/api/auth/callback?code=bogus&state=${authUrl.searchParams.get('state')}`,
    )
    assert.equal(res.headers.get('location'), `${app.base}/?auth_error=sso_failed`)
    assert.equal((await (await c.request('/api/auth/session')).json()).user, null)
  } finally {
    console.error = logError
    await app.close()
    await op.close()
  }
})

test('oidc: absolute return_to is not an open redirect', async () => {
  const op = await startMockOp()
  const app = await startOidcApp(op)
  try {
    const c = makeClient(app.base)
    const authUrl = await beginLogin(c, 'https://evil.example/steal')
    const code = op.issueCode({
      codeChallenge: authUrl.searchParams.get('code_challenge'),
      nonce: authUrl.searchParams.get('nonce'),
      email: 'alice@hanover.edu',
    })
    const res = await c.request(
      `/api/auth/callback?code=${code}&state=${authUrl.searchParams.get('state')}`,
    )
    assert.equal(res.headers.get('location'), `${app.base}/`)
  } finally {
    await app.close()
    await op.close()
  }
})
