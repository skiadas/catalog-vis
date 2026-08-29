// Catalog API: the three catalog artifacts + a manifest, always public.
//
// The pipeline JSON files are the source of truth (live at the static root —
// see config.js `staticDir`); this router serves them with the cache policy
// that matches their role: the data contract must never go stale in a
// consumer's browser (no-store), and `/catalog.json` gives integrators a
// single versioned summary of what's being served. No DB, no auth — the
// catalog is public by design; auth applies to schedule data only.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'

/** The three canonical catalog artifacts (names match the contract's files). */
export const CATALOG_ARTIFACTS = ['majors.json', 'requirements_parsed.json', 'core_requirements.json']

/**
 * @param {string} staticDir
 * @returns {import('express').Router}
 */
export function catalogRouter(staticDir) {
  const router = express.Router()

  for (const file of CATALOG_ARTIFACTS) {
    router.get(`/${file}`, (req, res, next) => {
      const abs = join(staticDir, file)
      if (!existsSync(abs)) return res.status(404).json({ error: 'not_found', file })
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(abs, (err) => {
        if (err) next(err)
      })
    })
  }

  // `/catalog.json` — a manifest describing the served artifacts, so a consumer
  // (or a human) can see which catalog year/version a host is serving without
  // downloading the (large) artifacts.
  router.get('/catalog.json', (req, res) => {
    const majorsAbs = join(staticDir, 'majors.json')
    if (!existsSync(majorsAbs)) return res.status(404).json({ error: 'not_found', file: 'majors.json' })
    const majors = JSON.parse(readFileSync(majorsAbs, 'utf8'))
    const parsedAbs = join(staticDir, 'requirements_parsed.json')
    const coreAbs = join(staticDir, 'core_requirements.json')
    const parsed = existsSync(parsedAbs) ? JSON.parse(readFileSync(parsedAbs, 'utf8')) : null
    const core = existsSync(coreAbs) ? JSON.parse(readFileSync(coreAbs, 'utf8')) : null
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      catalog_year: majors.catalog_year || null,
      updated_at: majors.generated_at || null,
      schema_version: (parsed && parsed.schema_version) || (core && core.schema_version) || null,
      artifacts: CATALOG_ARTIFACTS,
    })
  })

  return router
}
