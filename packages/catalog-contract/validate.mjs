#!/usr/bin/env node
// Validates the committed catalog data artifacts against the formal schemas
// in this package. Run:  npm run validate:catalog
//
// This is a *parallel* contract check to test/test_data.py: the JSON Schemas
// cover structure/vocabulary, while test_data.py keeps the derived/relational
// invariants (id-from-name, track-slug uniqueness, cross-file integrity).
//
// Reads the artifacts from the repo root and runs the same validation routine
// the browser uses (`validateCatalog` in `index.js`), so the pipeline and the
// apps judge documents identically.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG_FILES, validateCatalog } from './index.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')

/** @type {import('./types.d.ts').CatalogDocs} */
const docs = {
  'majors.json': undefined,
  'requirements_parsed.json': undefined,
  'core_requirements.json': undefined,
}
let readFailed = 0
for (const file of CATALOG_FILES) {
  try {
    docs[file] = JSON.parse(readFileSync(join(root, file), 'utf8'))
  } catch (err) {
    readFailed++
    console.error(`FAIL ${file}: cannot read/parse (${err.message})`)
  }
}
if (readFailed) process.exit(1)

const issues = validateCatalog(docs)
if (issues) {
  for (const { file, errors } of issues) {
    console.log(`FAIL ${file} does not conform to its schema:`)
    for (const e of errors) {
      console.log(`  ${e.instancePath || '/'} ${e.message}`)
    }
  }
  process.exit(1)
}
for (const file of CATALOG_FILES) console.log(`OK   ${file} conforms to its schema`)
console.log('All catalog data conforms to the contract schemas.')
