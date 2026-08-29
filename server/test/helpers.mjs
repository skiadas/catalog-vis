// In-process HTTP helper for testing the Express app on an ephemeral port. A
// single server can host several named clients, each with its own cookie jar,
// so multi-user flows (alice/bob/carol) run against one shared DB/instance.

import http from 'node:http'
import { once } from 'node:events'

export async function startTestServer(app) {
  const server = http.createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  const base = `http://127.0.0.1:${port}`

  function makeClient(cookies = {}) {
    async function request(method, path, body) {
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
      })
      const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const sc of setCookies) {
        const [pair] = sc.split(';')
        const idx = pair.indexOf('=')
        if (idx > 0) cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1)
      }
      const text = await res.text()
      let json = null
      try {
        json = text ? JSON.parse(text) : null
      } catch {
        json = null
      }
      return { status: res.status, json, text, headers: res.headers }
    }
    return {
      get: (p) => request('GET', p),
      post: (p, b) => request('POST', p, b),
      put: (p, b) => request('PUT', p, b),
      patch: (p, b) => request('PATCH', p, b),
      del: (p) => request('DELETE', p),
    }
  }

  const shared = makeClient()
  const clients = new Set()
  return {
    base,
    // The default client (first cookie jar); convenient for single-user tests.
    ...shared,
    // Create an additional isolated client (own cookies) for multi-user flows.
    newClient() {
      const c = makeClient()
      clients.add(c)
      return c
    },
    close: async () => {
      for (const c of clients) await c
      await new Promise((done) => server.close(done))
    },
  }
}
