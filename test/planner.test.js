import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  courseInfo,
  filteredUniverse,
  passes,
  checkAggregates,
  satisfied,
  evaluateRequirement,
  evaluateProgram,
} from '../lib/planner.js'

// Small synthetic catalog the way majors.json exposes courses.
const CATALOG = [
  'GER 101',
  'GER 115',
  'GER 222',
  'GER 243',
  'GER 301',
  'GER 302',
  'HIS 327',
  'ENG 243',
  'ENG 244',
  'ENG 247',
  'ENG 300',
  'ANTH 160',
  'ANTH 223',
  'ANTH 233',
  'ANTH 259',
  'ANTH 311',
  'BIO 161',
  'BIO 221',
  'BIO 301',
  'BIO 362',
  'BIO 363',
  'CS 150',
  'MUS 232',
]

const takenFrom = (codes) => new Set(codes)

// ---------------------------------------------------------------------------
// courseInfo
// ---------------------------------------------------------------------------

test('courseInfo parses a plain code', () => {
  assert.deepEqual(courseInfo('ANTH 160'), { prefixes: ['ANTH'], number: 160 })
})

test('courseInfo parses cross-listed codes', () => {
  assert.deepEqual(courseInfo('CLA/HIS 252'), { prefixes: ['CLA', 'HIS'], number: 252 })
})

test('courseInfo tolerates range codes', () => {
  assert.deepEqual(courseInfo('ENV 408-409'), { prefixes: ['ENV'], number: 408 })
})

test('courseInfo returns empty on garbage', () => {
  assert.deepEqual(courseInfo('not-a-code'), { prefixes: [], number: null })
})

// ---------------------------------------------------------------------------
// course
// ---------------------------------------------------------------------------

test('course satisfied when taken', () => {
  const r = satisfied({ type: 'course', code: 'BIO 161' }, takenFrom(['BIO 161']), CATALOG)
  assert.equal(r.status, 'satisfied')
  assert.deepEqual(r.matched, ['BIO 161'])
})

test('course unsatisfied when not taken', () => {
  const r = satisfied({ type: 'course', code: 'BIO 161' }, takenFrom([]), CATALOG)
  assert.equal(r.status, 'unsatisfied')
  assert.deepEqual(r.missing, ['BIO 161'])
})

// ---------------------------------------------------------------------------
// any_of
// ---------------------------------------------------------------------------

test('any_of (codes) satisfied with one taken', () => {
  const it = { type: 'any_of', codes: ['BIO 362', 'BIO 363'] }
  assert.equal(satisfied(it, takenFrom(['BIO 362']), CATALOG).status, 'satisfied')
})

test('any_of (codes) satisfied with more than one taken (cannot un-take)', () => {
  const it = { type: 'any_of', codes: ['BIO 362', 'BIO 363'] }
  assert.equal(satisfied(it, takenFrom(['BIO 362', 'BIO 363']), CATALOG).status, 'satisfied')
})

test('any_of (codes) unsatisfied when none taken', () => {
  const it = { type: 'any_of', codes: ['BIO 362', 'BIO 363'] }
  const r = satisfied(it, takenFrom([]), CATALOG)
  assert.equal(r.status, 'unsatisfied')
  assert.deepEqual(new Set(r.missing), new Set(['BIO 362', 'BIO 363']))
})

test('any_of (items) satisfied when any nested item is satisfied', () => {
  const it = {
    type: 'any_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'any_of', codes: ['BIO 362', 'BIO 363'] },
    ],
  }
  assert.equal(satisfied(it, takenFrom(['BIO 363']), CATALOG).status, 'satisfied')
})

test('any_of (items) unsatisfied when none satisfied', () => {
  const it = {
    type: 'any_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'any_of', codes: ['BIO 362', 'BIO 363'] },
    ],
  }
  assert.equal(satisfied(it, takenFrom(['BIO 221']), CATALOG).status, 'unsatisfied')
})

// ---------------------------------------------------------------------------
// each_of / some_of
// ---------------------------------------------------------------------------

test('each_of satisfied only when every child satisfied', () => {
  const it = {
    type: 'each_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
    ],
  }
  assert.equal(satisfied(it, takenFrom(['BIO 161', 'BIO 221']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['BIO 161']), CATALOG).status, 'unsatisfied')
})

test('each_of reports the number still missing', () => {
  const it = {
    type: 'each_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
    ],
  }
  assert.equal(satisfied(it, takenFrom(['BIO 161']), CATALOG).needed, 1)
})

test('some_of satisfied at the minimum threshold', () => {
  const it = {
    type: 'some_of',
    min: 2,
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
      { type: 'course', code: 'BIO 301' },
    ],
  }
  assert.equal(satisfied(it, takenFrom(['BIO 161', 'BIO 221']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['BIO 161']), CATALOG).status, 'unsatisfied')
  assert.equal(satisfied(it, takenFrom(['BIO 161']), CATALOG).needed, 1)
})

// ---------------------------------------------------------------------------
// electives — filters vs aggregates, and universe scoping
// ---------------------------------------------------------------------------

test('electives with no filters: any catalog course counts', () => {
  const it = { type: 'electives', count: 3 }
  const chosen = new Set(['GER 101', 'ANTH 160', 'MUS 232'])
  const r = satisfied(it, chosen, CATALOG)
  assert.equal(r.status, 'satisfied')
  assert.equal(r.count, 3)
})

test('electives with a from-pool scope', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'from', codes: ['ARTH 111', 'HIS 266', 'HIS 267'] }],
  }
  assert.equal(satisfied(it, takenFrom(['HIS 266', 'HIS 267']), CATALOG).status, 'satisfied')
  // A course outside the pool must not count.
  assert.equal(satisfied(it, takenFrom(['HIS 266', 'BIO 161']), CATALOG).status, 'unsatisfied')
})

test('electives with a plain discipline scope (Anthropology shape)', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'discipline', prefixes: ['ANTH'] }],
  }
  assert.equal(satisfied(it, takenFrom(['ANTH 160', 'ANTH 223']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['ANTH 160', 'BIO 161']), CATALOG).status, 'unsatisfied')
})

test('electives with level band scope (GEO 16x shape)', () => {
  const it = {
    type: 'electives',
    count: 1,
    constraints: [{ type: 'level', min: 160, max: 169 }],
  }
  assert.equal(satisfied(it, takenFrom(['ANTH 160']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['ANTH 223']), CATALOG).status, 'unsatisfied')
})

test('electives base count plus level aggregate (German 300-level shape)', () => {
  const it = {
    type: 'electives',
    count: 4,
    constraints: [
      { type: 'exclude', codes: ['GER 115'] },
      { type: 'level', level: 300, atLeast: 2 },
    ],
  }
  // 4 GER courses, only one at 300 -> falls short of the 300 aggregate.
  assert.equal(
    satisfied(it, takenFrom(['GER 101', 'GER 222', 'GER 243', 'GER 301']), CATALOG).status,
    'unsatisfied',
  )
  // 3 at 300 -> satisfied.
  assert.equal(
    satisfied(it, takenFrom(['GER 101', 'GER 301', 'GER 302', 'HIS 327']), CATALOG).status,
    'satisfied',
  )
})

test('discipline atLeast is an aggregate, not a scope (German all-course universe)', () => {
  const it = {
    type: 'electives',
    count: 3,
    constraints: [{ type: 'discipline', prefixes: ['GER'], atLeast: 2 }],
  }
  // One non-GER course is tolerated inside the bucket.
  assert.equal(satisfied(it, takenFrom(['GER 301', 'GER 302', 'HIS 327']), CATALOG).status, 'satisfied')
  // Too few GER courses -> not satisfied.
  assert.equal(satisfied(it, takenFrom(['GER 301', 'HIS 327', 'MUS 232']), CATALOG).status, 'unsatisfied')
})

test('discipline distinctAtLeast (variegated disciplines)', () => {
  const it = {
    type: 'electives',
    count: 3,
    constraints: [{ type: 'discipline', distinctAtLeast: 3 }],
  }
  assert.equal(satisfied(it, takenFrom(['GER 101', 'ANTH 160', 'MUS 232']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['GER 101', 'GER 222', 'MUS 232']), CATALOG).status, 'unsatisfied')
})

test('discipline atMost without prefixes caps any single discipline (Asian Studies shape)', () => {
  const it = {
    type: 'electives',
    count: 3,
    constraints: [{ type: 'discipline', atMost: 2 }],
  }
  assert.equal(satisfied(it, takenFrom(['GER 101', 'GER 222', 'GER 243']), CATALOG).status, 'unsatisfied')
  assert.equal(satisfied(it, takenFrom(['GER 101', 'GER 222', 'ANTH 160']), CATALOG).status, 'satisfied')
})

test('electives with min_from (Anthropology comparative/geo shape)', () => {
  const it = {
    type: 'electives',
    count: 4,
    constraints: [
      { type: 'discipline', prefixes: ['ANTH'] },
      { type: 'min_from', codes: ['ANTH 223', 'ANTH 233'], atLeast: 2 },
      { type: 'min_from', codes: ['ANTH 259', 'ANTH 311'], atLeast: 1 },
    ],
  }
  // Meets both min_from floors and the base count of 4.
  assert.equal(
    satisfied(it, takenFrom(['ANTH 223', 'ANTH 233', 'ANTH 259', 'ANTH 160']), CATALOG).status,
    'satisfied',
  )
  // Only one geographic-area course -> the atLeast 2 geo floor fails.
  assert.equal(
    satisfied(it, takenFrom(['ANTH 223', 'ANTH 259', 'ANTH 160', 'ANTH 311']), CATALOG).status,
    'unsatisfied',
  )
  // Base count of 4 not reached.
  assert.equal(satisfied(it, takenFrom(['ANTH 223', 'ANTH 259', 'ANTH 160']), CATALOG).status, 'unsatisfied')
})

test('electives with max_from (English minor shape)', () => {
  const it = {
    type: 'electives',
    count: 5,
    constraints: [
      { type: 'level', level: 100, atMost: 1 },
      { type: 'max_from', codes: ['ENG 243', 'ENG 244', 'ENG 247'], atMost: 2 },
    ],
  }
  // Three from the capped list -> over the max_from cap.
  assert.equal(
    satisfied(it, takenFrom(['ENG 243', 'ENG 244', 'ENG 247', 'ENG 300', 'GER 222']), CATALOG).status,
    'unsatisfied',
  )
  // Two from the list, and no 100-level courses -> fine.
  assert.equal(
    satisfied(it, takenFrom(['ENG 243', 'ENG 244', 'ENG 300', 'GER 222', 'GER 301']), CATALOG).status,
    'satisfied',
  )
  // Three 100-level courses -> over the level 100 cap.
  assert.equal(
    satisfied(it, takenFrom(['ENG 243', 'ENG 244', 'ENG 300', 'BIO 161', 'CS 150', 'ANTH 160']), CATALOG)
      .status,
    'unsatisfied',
  )
})

test('electives report chosen count and remaining needed', () => {
  const it = { type: 'electives', count: 4, constraints: [{ type: 'discipline', prefixes: ['GER'] }] }
  const r = satisfied(it, takenFrom(['GER 301', 'GER 302']), CATALOG)
  assert.equal(r.status, 'unsatisfied')
  assert.equal(r.count, 2)
  assert.equal(r.needed, 2)
})

// ---------------------------------------------------------------------------
// custom / legacy
// ---------------------------------------------------------------------------

test('custom is unknown', () => {
  assert.equal(satisfied({ type: 'custom', text: 'narrative' }, takenFrom([]), CATALOG).status, 'unknown')
  assert.equal(satisfied({ type: 'custom', text: 'narrative' }, new Set(), CATALOG).status, 'unknown')
})

test('legacy pair evaluates as each_of', () => {
  const it = { type: 'pair', codes: ['BIO 161', 'BIO 221'] }
  assert.equal(satisfied(it, takenFrom(['BIO 161', 'BIO 221']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['BIO 161']), CATALOG).status, 'unsatisfied')
})

test('level_gate is unknown', () => {
  assert.equal(satisfied({ type: 'level_gate', level: 300 }, new Set(), CATALOG).status, 'unknown')
})

// ---------------------------------------------------------------------------
// evaluateRequirement / evaluateProgram
// ---------------------------------------------------------------------------

test('evaluateRequirement mirrors the sections/items shape', () => {
  const req = {
    label: 'Biology courses',
    sections: [
      {
        heading: 'Core',
        items: [{ type: 'course', code: 'BIO 161' }],
      },
      { heading: 'Cognate', items: [{ type: 'electives', count: 1 }] },
    ],
  }
  const out = evaluateRequirement(req, takenFrom(['BIO 161']), CATALOG)
  assert.equal(out.label, 'Biology courses')
  assert.equal(out.sections[0].heading, 'Core')
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].status, 'satisfied')
})

test('evaluateProgram evaluates the full list', () => {
  const reqs = [
    { label: 'A', sections: [{ heading: null, items: [{ type: 'course', code: 'BIO 161' }] }] },
    { label: 'B', sections: [{ heading: null, items: [{ type: 'custom', text: 'x' }] }] },
  ]
  const out = evaluateProgram(reqs, takenFrom(['BIO 161']), CATALOG)
  assert.equal(out.length, 2)
  assert.equal(out[0].sections[0].items[0].status, 'satisfied')
  assert.equal(out[1].sections[0].items[0].status, 'unknown')
})

// ---------------------------------------------------------------------------
// filteredUniverse / passes / checkAggregates (lower-level)
// ---------------------------------------------------------------------------

test('exclude removes codes from the universe', () => {
  const pool = filteredUniverse([{ type: 'exclude', codes: ['BIO 161'] }], CATALOG)
  assert.ok(!pool.has('BIO 161'))
  assert.ok(pool.has('BIO 221'))
})

test('from pool takes precedence over an open universe', () => {
  const pool = filteredUniverse([{ type: 'from', codes: ['HIS 266', 'BIO 161'] }], CATALOG)
  assert.deepEqual([...pool].sort(), ['BIO 161', 'HIS 266'])
})

test('passes handles exclude and cross-listed prefix filters', () => {
  assert.equal(passes('BIO 161', { type: 'exclude', codes: ['BIO 161'] }), false)
  assert.equal(passes('HIS 327', { type: 'exclude', codes: ['BIO 161'] }), true)
  assert.equal(passes('BIO 161', { type: 'discipline', prefixes: ['BIO'] }), true)
  assert.equal(passes('BIO 161', { type: 'discipline', prefixes: ['HIS'] }), false)
})

test('checkAggregates is true when no aggregates present', () => {
  assert.equal(checkAggregates(['BIO 161'], [{ type: 'from', codes: ['BIO 161'] }]), true)
})
