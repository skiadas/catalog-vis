// Build-time binding between the docs and the screenshot manifest.
//
// A <Shot file="…"> that names no manifest entry, or a manifest entry whose
// PNG is not on disk, fails the docs build instead of embedding a dead image.
// validateShots() is pure (all I/O injected) so the rules are node --test-able;
// checkDocsSite() is the fs glue the Vitepress config calls from buildEnd.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { entries } from './manifest.mjs'

const SHOT_RE = /<Shot\b[^>]*\sfile=["']([^"']+)["'][^>]*>/g

export function findShotUsages(markdown) {
  return [...markdown.matchAll(SHOT_RE)].map((match) => match[1])
}

export function validateShots({ usages, manifest, exists }) {
  const problems = []
  const manifestFiles = new Set(manifest.map((entry) => entry.file))
  for (const { file, source } of usages) {
    if (!manifestFiles.has(file)) {
      problems.push(`${source}: <Shot file="${file}"> has no manifest entry`)
    }
  }
  for (const entry of manifest) {
    if (!exists(entry.file)) {
      problems.push(`manifest entry "${entry.file}" has no file on disk`)
    }
  }
  return problems
}

export function checkDocsSite(root) {
  const pages = readdirSync(root, { recursive: true })
    .filter((rel) => typeof rel === 'string' && rel.endsWith('.md'))
    .map((rel) => ({ source: rel, markdown: readFileSync(join(root, rel), 'utf8') }))
  const usages = pages.flatMap(({ source, markdown }) =>
    findShotUsages(markdown).map((file) => ({ file, source })),
  )
  const shotDir = join(root, 'public', 'screenshots')
  return validateShots({
    usages,
    manifest: entries,
    exists: (file) => existsSync(join(shotDir, file)),
  })
}
