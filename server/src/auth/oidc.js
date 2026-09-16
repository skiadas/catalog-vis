// OIDC (OpenID Connect authorization code + PKCE) auth provider. Wraps
// `openid-client`: issuer discovery is lazy and cached for the process
// lifetime, each login stores a single-use state/nonce/PKCE row (oidc_flows),
// and the callback consumes it, validates the ID token, provisions the user
// just-in-time by email (lowercased), and hands the session cookie back to the
// app via `startSession`.
//
// Route contract (stable for the browser): GET /api/auth/login redirects to the
// issuer; GET /api/auth/callback returns the browser to the app path the login
// started from, appending `?auth_error=<code>` on failure.

import * as client from 'openid-client'
import * as db from '../db.js'

const DEFAULT_SCOPE = 'openid email'
const DEFAULT_FLOW_TTL_SECONDS = 600

/**
 * @typedef {import('openid-client').Configuration} OidcConfiguration
 */

/**
 * @typedef {object} OidcProviderOptions
 * @property {import('node:sqlite').DatabaseSync} database
 * @property {string} issuer
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} redirectUri
 * @property {string} [publicOrigin]          empty = derive from the request (dev/tests)
 * @property {(res: any, user: { id: number, username: string }) => void} startSession
 * @property {string} [scope]
 * @property {number} [flowTtlSeconds]
 * @property {boolean} [allowInsecureIssuer]
 */

// Lazy discovery: the first login fetches /.well-known/openid-configuration;
// later logins reuse the configuration. A failed discovery clears the cache so
// the next attempt can recover (e.g. the issuer was unreachable at boot).
function createDiscovery({ issuer, clientId, clientSecret, allowInsecureIssuer }) {
  /** @type {Promise<OidcConfiguration> | null} */
  let pending = null
  return () => {
    if (!pending) {
      const options = allowInsecureIssuer ? { execute: [client.allowInsecureRequests] } : undefined
      pending = client.discovery(new URL(issuer), clientId, clientSecret, undefined, options).catch((err) => {
        pending = null
        throw err
      })
    }
    return pending
  }
}

/**
 * @param {OidcProviderOptions} options
 */
export function createOidcProvider({
  database,
  issuer,
  clientId,
  clientSecret,
  redirectUri,
  publicOrigin = '',
  startSession,
  scope = DEFAULT_SCOPE,
  flowTtlSeconds = DEFAULT_FLOW_TTL_SECONDS,
  allowInsecureIssuer = false,
}) {
  const discover = createDiscovery({ issuer, clientId, clientSecret, allowInsecureIssuer })

  // The browser's origin for this request: the configured public origin in
  // production, or the request's own host in dev/tests (no proxy involved).
  function originFor(req) {
    return publicOrigin || `${req.protocol}://${req.get('host')}`
  }

  // Only same-origin paths are allowed as return targets (no protocol-relative
  // //host, no absolute URLs), so `return_to` can never become an open redirect.
  function safeReturnTo(raw, origin) {
    if (typeof raw !== 'string' || raw === '') return '/'
    try {
      const url = new URL(raw, origin)
      if (url.origin !== new URL(origin).origin) return '/'
      return url.pathname + url.search + url.hash
    } catch {
      return '/'
    }
  }

  // Back to the app with a machine-readable reason the sign-in did not finish.
  function failTo(origin, returnTo, code) {
    const url = new URL(returnTo || '/', origin)
    url.searchParams.set('auth_error', code)
    return url.href
  }

  // GET /api/auth/login — begin the authorization-code flow.
  async function loginHandler(req, res) {
    const origin = originFor(req)
    try {
      const config = await discover()
      const state = client.randomState()
      const nonce = client.randomNonce()
      const codeVerifier = client.randomPKCECodeVerifier()
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
      const returnTo = safeReturnTo(req.query.return_to, origin)
      db.createOidcFlow(database, { state, nonce, codeVerifier, returnTo, ttl: flowTtlSeconds })
      const url = client.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })
      res.redirect(url.href)
    } catch (err) {
      console.error('oidc login start failed:', err)
      res.redirect(failTo(origin, '/', 'sso_unavailable'))
    }
  }

  // GET /api/auth/callback — consume the flow, exchange the code, sign in.
  async function callbackHandler(req, res) {
    const origin = originFor(req)
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const flow = state ? db.consumeOidcFlow(database, state) : null
    if (!flow) return res.redirect(failTo(origin, '/', 'invalid_state'))
    const error = typeof req.query.error === 'string' ? req.query.error : ''
    if (error) return res.redirect(failTo(origin, flow.return_to, `sso_${error}`))
    try {
      const config = await discover()
      // openid-client derives the token request's redirect_uri from this URL
      // (query stripped), so it must be the callback's absolute URL.
      const currentUrl = new URL(req.originalUrl, origin)
      const tokens = await client.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: flow.code_verifier,
        expectedState: state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      })
      const claims = /** @type {Record<string, unknown>} */ (tokens.claims() || {})
      const email = String(claims.email || '')
        .trim()
        .toLowerCase()
      if (!email) return res.redirect(failTo(origin, flow.return_to, 'email_missing'))
      const user = db.ensureUser(database, email)
      startSession(res, user)
      res.redirect(new URL(flow.return_to || '/', origin).href)
    } catch (err) {
      console.error('oidc callback failed:', err)
      res.redirect(failTo(origin, flow.return_to, 'sso_failed'))
    }
  }

  return { loginHandler, callbackHandler }
}
