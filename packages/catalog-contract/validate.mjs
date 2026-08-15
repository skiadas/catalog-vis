#!/usr/bin/env node
// Validates the committed catalog data artifacts against the formal schemas
// in this package. Run:  npm run validate:catalog
//
// This is a *parallel* contract check to test/test_data.py: the JSON Schemas
// cover structure/vocabulary, while test_data.py keeps the derived/relational
// invariants (id-from-name, track-slug uniqueness, cross-file integrity).

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')

const SUITES = [
  ['majors.json', 'schemas/majors.schema.json'],
  ['requirements_parsed.json', 'schemas/requirements.schema.json'],
  ['core_requirements.json', 'schemas/core.schema.json'],
]

const ajv = new Ajv2020({ allErrors: true })

let failed = 0
for (const [dataRel, schemaRel] of SUITES) {
  const dataPath = join(root, dataRel)
  const schemaPath = join(here, schemaRel)
  let data
  try {
    data = JSON.parse(readFileSync(dataPath, 'utf8'))
  } catch (err) {
    console.error(`FAIL ${dataRel}: cannot read/parse (${err.message})`)
    failed++
    continue
  }
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
  const validate = ajv.compile(schema)
  if (validate(data)) {
    console.log(`OK   ${dataRel} conforms to ${schemaRel}`)
  } else {
    failed++
    console.log(`FAIL ${dataRel} does not conform to ${schemaRel}:`)
    for (const e of validate.errors) {
      console.log(`  ${e.instancePath || '/'} ${e.message}`)
    }
  }
}

if (failed) process.exit(1)
console.log('All catalog data conforms to the contract schemas.')
