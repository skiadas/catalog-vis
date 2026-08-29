import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG_FILES, validateCatalog } from '@major-vis/catalog-contract'

// Runtime-entry tests: `index.js` is the browser-safe validator surface apps
// use at load time (validate fetched catalog documents, fail loud), and the
// CLI/CI path (`validate.mjs`) shells into it. Importing the package by its
// own name exercises the `exports` wiring end to end — if the declared types
// (`types.d.ts`) and the runtime entry drift apart, these tests break.

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const load = (rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'))

/** @type {import('@major-vis/catalog-contract').CatalogDocs} */
const realDocs = {
  'majors.json': load('majors.json'),
  'requirements_parsed.json': load('requirements_parsed.json'),
  'core_requirements.json': load('core_requirements.json'),
}

// Deep-clones a fixture and returns an untyped copy so tests can corrupt
// documents without fighting the valid-document type (see schema.test.js).
const corrupt = (doc) => /** @type {any} */ (structuredClone(doc))

test('exports match the declared runtime surface', () => {
  assert.deepEqual(CATALOG_FILES, ['majors.json', 'requirements_parsed.json', 'core_requirements.json'])
  assert.equal(typeof validateCatalog, 'function')
})

test('accepts the real committed catalog documents', () => {
  assert.equal(validateCatalog(realDocs), null)
})

test('reports the file and error path for a corrupted course code', () => {
  const bad = corrupt(realDocs)
  bad['majors.json'].programs[0].courses[0].course_code = 'BAD'
  const issues = validateCatalog(bad)
  assert.ok(issues)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].file, 'majors.json')
  assert.equal(issues[0].errors[0].instancePath, '/programs/0/courses/0/course_code')
})

test('flags a missing document as a failure', () => {
  const issues = validateCatalog({ ...realDocs, 'core_requirements.json': undefined })
  assert.ok(issues)
  assert.equal(issues[0].file, 'core_requirements.json')
  assert.equal(issues[0].errors[0].instancePath, '')
})

test('reports failures across multiple documents at once', () => {
  const bad = corrupt(realDocs)
  bad['majors.json'].programs[0].name = 42
  bad['requirements_parsed.json'].programs[0].requirements[0].label = 42
  const issues = validateCatalog(bad)
  assert.ok(issues)
  assert.equal(issues.length, 2)
})
