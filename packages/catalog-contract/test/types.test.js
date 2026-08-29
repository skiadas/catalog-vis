// Runtime smoke witness: the emitted catalog documents exist, parse, and carry
// the load-bearing top-level shape. The type-level counterpart of this file is
// `types.witness.ts` (checked by `npm run typecheck`); the schema counterpart
// is `npm run validate:catalog`. All three must stay green together.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The emitted documents live at the repo root, three levels up from this test dir.
const ROOT = resolve(import.meta.dirname, '..', '..', '..')
const load = (name) => JSON.parse(readFileSync(resolve(ROOT, name), 'utf8'))

test('emitted catalog documents carry the contract top-level shape', () => {
  const majors = load('majors.json')
  assert.equal(typeof majors.catalog_year, 'string')
  assert.ok(majors.programs.length > 0)
  assert.ok(Object.keys(majors.catalog).length > 0)

  const requirements = load('requirements_parsed.json')
  assert.equal(requirements.schema_version, '2.0')
  assert.ok(requirements.programs.length > 0)
  assert.ok(requirements.programs[0].requirements[0].sections[0].items.length > 0)

  const core = load('core_requirements.json')
  assert.equal(core.schema_version, '2.0')
  assert.ok(core.programs.length > 0)
})
