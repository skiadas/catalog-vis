// Version API: the build metadata this deployment is running.
//
// Identifies the commit the server was built from so an operator can confirm a
// push actually reached the live host (`curl /api/version` vs `git rev-parse
// --short HEAD`). The values are baked into the image at build time (see the
// Dockerfile + publish workflow) and read from the environment at boot (see
// config.js `parseVersion`). Read-only and always public — no DB, no auth, no
// writes — so it carries the same low risk as the catalog manifest.

import express from 'express'

/**
 * @param {{ commit: string | null, ref: string | null, builtAt: string | null }} version
 * @returns {import('express').Router}
 */
export function versionRouter(version) {
  const router = express.Router()

  // `commit` is the short SHA, matching the `sha-xxxxxxx` image tag the publish
  // workflow applies; `null` fields mean the build metadata was not injected
  // (local dev, tests, or a hand-built image).
  router.get('/api/version', (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      commit: version.commit,
      ref: version.ref,
      builtAt: version.builtAt,
    })
  })

  return router
}
