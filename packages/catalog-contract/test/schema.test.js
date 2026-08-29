import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

const here = dirname(fileURLToPath(import.meta.url))
const load = (rel) => JSON.parse(readFileSync(join(here, rel), 'utf8'))

const majorsSchema = load('../schemas/majors.schema.json')
const requirementsSchema = load('../schemas/requirements.schema.json')
const coreSchema = load('../schemas/core.schema.json')

const ajv = new Ajv2020({ allErrors: true })
const compile = (schema) => {
  const validate = ajv.compile(schema)
  return (data) => {
    validate(data)
    return { ok: !validate.errors, errors: validate.errors || [] }
  }
}
const checkMajors = compile(majorsSchema)
const checkRequirements = compile(requirementsSchema)
const checkCore = compile(coreSchema)

// Deep-clones a valid fixture and returns an untyped copy, so tests can corrupt
// documents into shapes the valid-document type can't express (the schema must
// reject them) without sprinkling `any` casts at each mutation site.
const corrupt = (doc) => /** @type {any} */ (structuredClone(doc))

const validProgram = {
  id: 'anthropologycultural',
  name: 'Anthropology, Cultural',
  type: ['major', 'minor'],
  courses: [{ course_code: 'ANTH 160', course_name: 'Special Topics', prerequisites: [], credit_hours: 1 }],
}
const validMajor = {
  catalog_year: '2025-2026',
  total_programs: 1,
  total_courses: 1,
  catalog: { 'ANTH 160': validProgram.courses[0] },
  programs: [validProgram],
}
const validReqProgram = {
  id: 'anthropologycultural',
  name: 'Anthropology, Cultural',
  requirements: [
    {
      label: 'Major',
      sections: [
        {
          heading: 'Courses',
          items: [{ type: 'course', code: 'ANTH 160' }],
        },
      ],
    },
  ],
}
const validParsed = { schema_version: '2.0', programs: [validReqProgram] }

test('majors schema accepts a valid document and rejects bad course codes', () => {
  assert.equal(checkMajors(validMajor).ok, true)
  const bad = structuredClone(validMajor)
  bad.programs[0].courses[0].course_code = 'ANTH 16'
  assert.equal(checkMajors(bad).ok, false)
})

test('majors schema rejects requirement text that is not a {label, text} object', () => {
  const bad = structuredClone(validMajor)
  bad.programs[0].requirements = { major: 'just a string' }
  assert.equal(checkMajors(bad).ok, false)
})

test('requirements schema accepts valid nodes and rejects unknown item types', () => {
  assert.equal(checkRequirements(validParsed).ok, true)
  const bad = structuredClone(validParsed)
  bad.programs[0].requirements[0].sections[0].items[0].type = 'everything'
  assert.equal(checkRequirements(bad).ok, false)
})

test('requirements schema rejects an any_of carrying both codes and items', () => {
  const bad = corrupt(validParsed)
  bad.programs[0].requirements[0].sections[0].items = [
    { type: 'any_of', codes: ['BIO 161'], items: [{ type: 'course', code: 'BIO 161' }] },
  ]
  assert.equal(checkRequirements(bad).ok, false)
})

test('requirements schema allows a from constraint that is note-only', () => {
  const data = corrupt(validParsed)
  data.programs[0].requirements[0].sections[0].items = [
    { type: 'electives', count: 2, constraints: [{ type: 'from', note: 'courses below' }] },
  ]
  assert.equal(checkRequirements(data).ok, true)
})

test('core schema accepts a valid area and rejects a missing electives count', () => {
  const valid = {
    schema_version: '2.0',
    programs: [
      {
        id: 'core-curriculum',
        name: 'Core Curriculum',
        requirements: [
          {
            id: 'LA',
            label: 'Literary and Artistic Perspectives (LA)',
            sections: [{ heading: 'LA', items: [{ type: 'electives', count: 2, constraints: [] }] }],
          },
        ],
      },
    ],
  }
  assert.equal(checkCore(valid).ok, true)
  const bad = corrupt(valid)
  bad.programs[0].requirements[0].sections[0].items[0] = { type: 'electives' }
  assert.equal(checkCore(bad).ok, false)
})
