import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  courseInfo,
  expandCode,
  prefixMatch,
  filteredUniverse,
  passes,
  checkAggregates,
  satisfied,
  evaluateRequirement,
  evaluateProgram,
  planGaps,
  gapGroups,
  describeConstraints,
  audit,
  assignRequirement,
  prereqGroups,
  prereqStatus,
} from '../planner.js'

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
  'CS 220',
  'CS 231',
  'CS 340',
  'CS 345',
  'MUS 232',
  'ENG 251',
  'COM 251',
  'CLA 252',
  'HIS 252',
  'GNDS 499',
  'HF 101',
  'SPA 217',
  'SPA 219',
  'SPA 319',
  'SPA 320',
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

test('electives with distinctAtLeast treat two same-discipline courses as one slot', () => {
  const it = {
    type: 'electives',
    count: 3,
    constraints: [{ type: 'discipline', distinctAtLeast: 3 }],
  }
  // A second CS course can't fill a second slot, but a valid 3-discipline
  // triple exists -> satisfied, and only the valid courses are "matched".
  const r = satisfied(it, takenFrom(['CS 220', 'CS 231', 'BIO 161', 'SPA 217']), CATALOG)
  assert.equal(r.status, 'satisfied')
  assert.ok(!r.matched.includes('CS 231'), 'the surplus same-discipline course is not claimed')
  assert.ok(r.matched.includes('BIO 161') && r.matched.includes('SPA 217'))
})

test('electives with sameDiscipline demand a common discipline (WL shape)', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'discipline', sameDiscipline: true }],
  }
  // Two courses in a single language satisfy the bucket.
  const ok = satisfied(it, takenFrom(['SPA 217', 'SPA 219']), CATALOG)
  assert.equal(ok.status, 'satisfied')
  assert.deepEqual(new Set(ok.matched), new Set(['SPA 217', 'SPA 219']))
  // A mixed-language pair must NOT satisfy, and must not read as "2/2 matched".
  const bad = satisfied(it, takenFrom(['SPA 217', 'GER 222']), CATALOG)
  assert.equal(bad.status, 'unsatisfied')
  assert.deepEqual(bad.matched, [])
})

test('electives with sameDiscipline ignore a stray other-language course', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'discipline', sameDiscipline: true }],
  }
  const r = satisfied(it, takenFrom(['SPA 217', 'SPA 219', 'GER 222']), CATALOG)
  assert.equal(r.status, 'satisfied')
  assert.deepEqual(new Set(r.matched), new Set(['SPA 217', 'SPA 219']))
})

test('assignRequirement never surfaces an invalid same-discipline selection', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'discipline', sameDiscipline: true }],
  }
  const req = { label: 'WL', sections: [{ heading: '', items: [it] }] }
  const bad = assignRequirement(req, ['SPA 217', 'GER 222'], CATALOG)[0]
  assert.equal(bad.plan.aggOk, false)
  assert.deepEqual(bad.plan.filled, [])
  assert.equal(bad.used.size, 0)
  // A valid pair is what gets claimed.
  const ok = assignRequirement(req, ['SPA 217', 'SPA 219', 'GER 222'], CATALOG)[0]
  assert.equal(ok.plan.aggOk, true)
  assert.deepEqual([...ok.used], ['SPA 217', 'SPA 219'])
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
  const out = evaluateRequirement(req, takenFrom(['BIO 161', 'BIO 221']), CATALOG)
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

test('independentSections lets one course satisfy multiple sections', () => {
  // The core curriculum: ENG 172 counts for both LA and W1 independently.
  const req = {
    label: 'Core',
    independentSections: true,
    sections: [
      { heading: 'LA', items: [{ type: 'course', code: 'ENG 251' }] },
      { heading: 'W1', items: [{ type: 'course', code: 'ENG 251' }] },
    ],
  }
  const out = evaluateRequirement(req, takenFrom(['ENG 251']), CATALOG)
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].status, 'satisfied')
})

test('without independentSections, one course counts for only one section', () => {
  // Same two required courses across sections, but shared pool: ENG 251 can
  // satisfy only the first, leaving the second unsatisfied.
  const req = {
    label: 'Shared',
    sections: [
      { heading: 'A', items: [{ type: 'course', code: 'ENG 251' }] },
      { heading: 'B', items: [{ type: 'course', code: 'ENG 251' }] },
    ],
  }
  const out = evaluateRequirement(req, takenFrom(['ENG 251']), CATALOG)
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].status, 'unsatisfied')
})

// ---------------------------------------------------------------------------
// Within-track no double counting
// ---------------------------------------------------------------------------

const CS_TRACK = {
  label: 'Major',
  sections: [
    { heading: 'Core', items: [{ type: 'course', code: 'CS 220' }] },
    {
      heading: 'Electives',
      items: [{ type: 'electives', count: 1, constraints: [{ type: 'discipline', prefixes: ['CS'] }] }],
    },
  ],
}

test('a required course cannot also fill the same track electives', () => {
  // CS 220 is the required course; taking it must not satisfy the elective.
  const out = evaluateRequirement(CS_TRACK, takenFrom(['CS 220']), CATALOG)
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].status, 'unsatisfied')
  assert.equal(out.sections[1].items[0].count, 0)
  // A distinct CS course does satisfy the elective.
  const out2 = evaluateRequirement(CS_TRACK, takenFrom(['CS 220', 'CS 231']), CATALOG)
  assert.equal(out2.sections[1].items[0].status, 'satisfied')
  assert.equal(out2.sections[1].items[0].count, 1)
})

test('gapGroups omits claimed courses from electives options', () => {
  const groups = gapGroups(CS_TRACK.sections[1].items[0], takenFrom(['CS 220']), CATALOG, new Set(['CS 220']))
  const electives = groups.find((g) => g.expandable)
  assert.ok(electives)
  assert.ok(!electives.codes.includes('CS 220'))
  assert.deepEqual(electives.codes, ['CS 150', 'CS 231', 'CS 340', 'CS 345'])
})

test('an excluded course cannot satisfy a nested any_of/each_of/some_of alternative', () => {
  // A course already claimed by another node in the track must not satisfy a
  // choice nested inside any_of / each_of / some_of.
  const anyOf = {
    type: 'any_of',
    items: [
      { type: 'course', code: 'CS 220' },
      { type: 'course', code: 'CS 231' },
    ],
  }
  assert.equal(satisfied(anyOf, ['CS 220'], CATALOG, ['CS 220']).status, 'unsatisfied')
  assert.equal(satisfied(anyOf, ['CS 220'], CATALOG).status, 'satisfied')

  const eachOf = {
    type: 'each_of',
    items: [
      { type: 'course', code: 'CS 220' },
      { type: 'course', code: 'CS 231' },
    ],
  }
  assert.equal(satisfied(eachOf, ['CS 220', 'CS 231'], CATALOG, ['CS 220']).status, 'unsatisfied')
  assert.equal(satisfied(eachOf, ['CS 220', 'CS 231'], CATALOG).status, 'satisfied')

  const someOf = {
    type: 'some_of',
    min: 3,
    items: [
      { type: 'course', code: 'CS 220' },
      { type: 'course', code: 'CS 231' },
      { type: 'course', code: 'CS 340' },
    ],
  }
  assert.equal(satisfied(someOf, ['CS 220', 'CS 231', 'CS 340'], CATALOG, ['CS 220']).status, 'unsatisfied')
  assert.equal(satisfied(someOf, ['CS 220', 'CS 231', 'CS 340'], CATALOG).status, 'satisfied')
})

test('a course may count for requirements in different tracks', () => {
  const otherTrack = {
    label: 'CS minor',
    sections: [
      {
        heading: null,
        items: [{ type: 'electives', count: 1, constraints: [{ type: 'discipline', prefixes: ['CS'] }] }],
      },
    ],
  }
  // Two separate tracks: CS 220 satisfies the first track's required course and
  // (on its own) the second track's elective — allowed.
  const out = evaluateProgram([CS_TRACK, otherTrack], takenFrom(['CS 220']), CATALOG)
  assert.equal(out[0].sections[0].items[0].status, 'satisfied')
  assert.equal(out[1].sections[0].items[0].status, 'satisfied')
})

test('any_of consumes one alternative, freeing the other for same-track electives', () => {
  const track = {
    label: 'T',
    sections: [
      { heading: 'Choice', items: [{ type: 'any_of', codes: ['CS 340', 'CS 345'] }] },
      {
        heading: 'Electives',
        items: [{ type: 'electives', count: 1, constraints: [{ type: 'discipline', prefixes: ['CS'] }] }],
      },
    ],
  }
  const out = evaluateRequirement(track, takenFrom(['CS 340', 'CS 345']), CATALOG)
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  // The freed alternative counts toward the elective bucket.
  assert.equal(out.sections[1].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].count, 1)
})

test('a single course cannot satisfy two rigid nodes in one track', () => {
  const track = {
    label: 'T',
    sections: [
      { heading: 'A', items: [{ type: 'course', code: 'CS 220' }] },
      { heading: 'B', items: [{ type: 'any_of', codes: ['CS 220', 'CS 231'] }] },
    ],
  }
  const out = evaluateRequirement(track, takenFrom(['CS 220']), CATALOG)
  // Only one of the two required nodes may claim CS 220.
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].status, 'unsatisfied')
})

test('assignRequirement reports which course goes to which node', () => {
  const track = {
    label: 'T',
    sections: [
      { heading: 'Choice', items: [{ type: 'any_of', codes: ['CS 340', 'CS 345'] }] },
      {
        heading: 'Electives',
        items: [{ type: 'electives', count: 1, constraints: [{ type: 'discipline', prefixes: ['CS'] }] }],
      },
    ],
  }
  const assignment = assignRequirement(track, takenFrom(['CS 340', 'CS 345']), CATALOG)
  const choice = assignment[0]
  const electives = assignment[1]
  // Exactly one of the two is assigned to the choice; the other to electives.
  assert.deepEqual([...choice.used], ['CS 340'])
  assert.deepEqual([...electives.used], ['CS 345'])
  assert.ok(!choice.used.has([...electives.used][0]))
})

test('assignRequirement consumes every code of a range alternative together', () => {
  const track = {
    label: 'T',
    sections: [{ heading: 'Choice', items: [{ type: 'any_of', codes: ['ENV 408-409', 'ENV 471'] }] }],
  }
  // Both halves of the range must be in the pool for the alternative to fire.
  const full = assignRequirement(track, takenFrom(['ENV 408', 'ENV 409']), CATALOG)
  assert.ok(full[0].ok)
  assert.deepEqual([...full[0].used].sort(), ['ENV 408', 'ENV 409'])
  // With only one half taken, the range alternative is unsatisfied.
  const partial = assignRequirement(track, takenFrom(['ENV 408']), CATALOG)
  assert.equal(partial[0].ok, false)
  // The ENV 471 alternative still works on its own.
  const alt = assignRequirement(track, takenFrom(['ENV 471']), CATALOG)
  assert.ok(alt[0].ok)
})

test('gapGroups keeps a range alternative as its two parts', () => {
  const item = { type: 'any_of', codes: ['ENV 408-409', 'ENV 471'] }
  const groups = gapGroups(item, new Set(['ENV 408']), CATALOG)
  const open = groups.flatMap((g) => g.codes || [])
  assert.ok(open.includes('ENV 408-409'))
  assert.ok(open.includes('ENV 471'))
})

// ---------------------------------------------------------------------------
// Backtracking: a course is never permanently taken by an earlier node that a
// later sibling needs, and electives don't starve later buckets.
// ---------------------------------------------------------------------------

test('some_of defers to a sibling that needs the same course', () => {
  // some_of min 1 [CS 220, CS 231] followed by a required CS 220. The greedy
  // first-fit would grab CS 220 for the some_of and leave the requirement
  // unsatisfied; backtracking must assign CS 231 to the some_of instead.
  const track = {
    label: 'T',
    sections: [
      {
        heading: 'S',
        items: [
          {
            type: 'some_of',
            min: 1,
            items: [
              { type: 'course', code: 'CS 220' },
              { type: 'course', code: 'CS 231' },
            ],
          },
          { type: 'course', code: 'CS 220' },
        ],
      },
    ],
  }
  const assignment = assignRequirement(track, takenFrom(['CS 220', 'CS 231']), CATALOG)
  assert.ok(
    assignment.every((e) => e.ok),
    'both nodes should be satisfiable',
  )
  const someOf = assignment[0]
  const required = assignment[1]
  // The some_of must not have taken CS 220; the required course gets it.
  assert.deepEqual([...someOf.used], ['CS 231'])
  assert.deepEqual([...required.used], ['CS 220'])
})

test('backtracking tries a later any_of alternative instead of failing', () => {
  // any_of [CS 340, CS 345] then a required CS 340. The greedy choice would
  // pick CS 340 for the any_of, leaving the requirement unmet.
  const track = {
    label: 'T',
    sections: [
      {
        heading: 'S',
        items: [
          { type: 'any_of', codes: ['CS 340', 'CS 345'] },
          { type: 'course', code: 'CS 340' },
        ],
      },
    ],
  }
  const assignment = assignRequirement(track, takenFrom(['CS 340', 'CS 345']), CATALOG)
  assert.ok(
    assignment.every((e) => e.ok),
    'both nodes should be satisfiable',
  )
  assert.deepEqual([...assignment[0].used], ['CS 345'])
  assert.deepEqual([...assignment[1].used], ['CS 340'])
})

test('an electives bucket with a failing fill does not starve a later bucket', () => {
  // First bucket: 2 CS electives (only CS 345 is left after the required node
  // takes CS 340, so it can't reach its count). Second bucket: 1 CS elective.
  // The first bucket's failed fill must not consume CS 345 that the second
  // bucket needs.
  const track = {
    label: 'T',
    sections: [
      {
        heading: 'S',
        items: [
          { type: 'course', code: 'CS 340' },
          { type: 'electives', count: 2, constraints: [{ type: 'discipline', prefixes: ['CS'] }] },
          { type: 'electives', count: 1, constraints: [{ type: 'discipline', prefixes: ['CS'] }] },
        ],
      },
    ],
  }
  const assignment = assignRequirement(track, takenFrom(['CS 340', 'CS 345']), CATALOG)
  const firstBucket = assignment[1]
  const secondBucket = assignment[2]
  // The first (2-count) bucket can't be satisfied with only one CS course left,
  // so it must not have consumed CS 345; the later bucket gets it.
  assert.ok(firstBucket.plan.filled.length < 2, 'first bucket should be underfilled')
  assert.deepEqual([...firstBucket.used], [], 'underfilled bucket must not claim courses')
  assert.ok(secondBucket.ok, 'the later bucket should still fill from CS 345')
  assert.deepEqual([...secondBucket.used], ['CS 345'])
})

test('an unsatisfiable rigid node does not crash the electives sibling (Spanish minor)', () => {
  // A required choice (SPA 319 or 320) with neither taken, followed by a 5-count
  // SPA electives bucket. The rigid pass fails, but the electives must still be
  // evaluated and reported (not crash `planResult` reading `plan.filled`).
  const track = {
    label: 'T',
    sections: [
      {
        heading: 'Spanish courses',
        items: [
          { type: 'any_of', codes: ['SPA 319', 'SPA 320'] },
          {
            type: 'electives',
            count: 5,
            constraints: [
              { type: 'discipline', prefixes: ['SPA'] },
              { type: 'exclude', codes: ['SPA 115', 'SPA 116'] },
            ],
          },
        ],
      },
    ],
  }
  const noCourses = evaluateRequirement(track, takenFrom([]), CATALOG)
  assert.equal(noCourses.sections[0].items[0].status, 'unsatisfied')
  assert.equal(noCourses.sections[0].items[1].status, 'unsatisfied')
  assert.equal(noCourses.sections[0].items[1].count, 0)

  // With other SPA courses taken (but not 319/320), the electives still report
  // its own progress instead of showing 0.
  const some = evaluateRequirement(track, takenFrom(['SPA 217', 'SPA 219']), CATALOG)
  assert.equal(some.sections[0].items[0].status, 'unsatisfied')
  assert.equal(some.sections[0].items[1].status, 'unsatisfied')
  assert.equal(some.sections[0].items[1].count, 2)
  assert.equal(some.sections[0].items[1].needed, 3)

  // The full requirement evaluates without crashing; with no choice taken it
  // reports "unsatisfied", but the electives' per-course progress is intact.
  const audited = audit([some])
  assert.equal(audited.requirements[0].status, 'unsatisfied')
  assert.equal(audited.requirements[0].sections[0].satisfied, 0)
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

test('checkAggregates counts a fixed-level band (atLeast/atMost)', () => {
  const atLeast2 = { type: 'level', level: 300, atLeast: 2 }
  assert.equal(checkAggregates(['GER 301', 'GER 302'], [atLeast2]), true)
  assert.equal(checkAggregates(['GER 301', 'HIS 327'], [atLeast2]), true)
  assert.equal(checkAggregates(['GER 301', 'GER 101'], [atLeast2]), false)
  const atMost1 = { type: 'level', level: 100, atMost: 1 }
  assert.equal(checkAggregates(['GER 101', 'HIS 327'], [atMost1]), true)
  assert.equal(checkAggregates(['GER 101', 'GER 115'], [atMost1]), false)
})

test('checkAggregates counts a range band (min/max) with atLeast', () => {
  const band = { type: 'level', min: 160, max: 169, atLeast: 2 }
  // CATALOG's 160-169 courses: ANTH 160, BIO 161.
  assert.equal(checkAggregates(['ANTH 160', 'BIO 161'], [band]), true)
  assert.equal(checkAggregates(['ANTH 160', 'GER 101'], [band]), false)
})

test('sameDiscipline requires all chosen to share one common prefix', () => {
  const constraint = { type: 'discipline', sameDiscipline: true }
  assert.equal(checkAggregates(['GER 101', 'GER 222'], [constraint]), true)
  assert.equal(checkAggregates(['GER 101', 'GER 222', 'GER 301'], [constraint]), true)
  assert.equal(checkAggregates(['GER 101', 'HIS 327'], [constraint]), false)
  // Cross-listed codes count as a match when any side overlaps.
  assert.equal(checkAggregates(['ENG/COM 251', 'COM 251'], [constraint]), true)
  assert.equal(checkAggregates(['ENG/COM 251', 'HIS 327'], [constraint]), false)
  // Empty chosen set trivially passes.
  assert.equal(checkAggregates([], [constraint]), true)
})

test('sameDiscipline does not scope the universe', () => {
  const constraint = { type: 'discipline', sameDiscipline: true }
  assert.equal(filteredUniverse([constraint], CATALOG).size, CATALOG.length)
  assert.equal(passes('GER 101', constraint), true)
  assert.equal(passes('HIS 327', constraint), true)
})

test('electives fail sameDiscipline when taken courses span disciplines', () => {
  const it = { type: 'electives', count: 2, constraints: [{ type: 'discipline', sameDiscipline: true }] }
  const mixed = satisfied(it, takenFrom(['GER 101', 'HIS 327']), CATALOG)
  assert.equal(mixed.status, 'unsatisfied')
  const same = satisfied(it, takenFrom(['GER 101', 'GER 115']), CATALOG)
  assert.equal(same.status, 'satisfied')
})

test('describeConstraints renders sameDiscipline as a shared-discipline note', () => {
  assert.equal(describeConstraints([{ type: 'discipline', sameDiscipline: true }]), 'in the same discipline')
})

// ---------------------------------------------------------------------------
// cross-listing resolution (slash codes + prefix aliases)
// ---------------------------------------------------------------------------

test('expandCode turns a cross-listed code into its concrete variants', () => {
  assert.deepEqual(expandCode('ENG/COM 251'), ['ENG 251', 'COM 251', 'ENG/COM 251'])
  assert.deepEqual(expandCode('CLA/HIS 252'), ['CLA 252', 'HIS 252', 'CLA/HIS 252'])
})

test('expandCode applies prefix aliases', () => {
  assert.deepEqual(expandCode('GNDR 499'), ['GNDS 499', 'GNDR 499'])
  assert.deepEqual(expandCode('GNDS 499'), ['GNDS 499'])
})

test('expandCode expands a course-number range into each concrete code', () => {
  assert.deepEqual(expandCode('ENV 408-409'), ['ENV 408', 'ENV 409', 'ENV 408-409'])
  // a range across a cross-listed prefix
  assert.deepEqual(expandCode('ENG/COM 250-251'), [
    'ENG 250',
    'ENG 251',
    'COM 250',
    'COM 251',
    'ENG/COM 250-251',
  ])
})

test('a range code is satisfied when every course in the range is taken', () => {
  const item = { type: 'any_of', codes: ['ENV 408-409', 'ENV 471'] }
  // only ENV 408 taken: the range alternative is open, ENV 471 open
  assert.equal(satisfied(item, ['ENV 408'], CATALOG).status, 'unsatisfied')
  // both ENV 408 + ENV 409 taken: satisfied via the range
  assert.equal(satisfied(item, ['ENV 408', 'ENV 409'], CATALOG).status, 'satisfied')
  // ENV 471 alone also satisfies the any_of
  assert.equal(satisfied(item, ['ENV 471'], CATALOG).status, 'satisfied')
})

test('prefixMatch matches an aliased spelling against the real prefix', () => {
  assert.equal(prefixMatch('GNDR 499', ['GNDS']), true)
  assert.equal(prefixMatch('GNDS 499', ['GNDS']), true)
  assert.equal(prefixMatch('GNDR 499', ['GNDR']), false)
})

test('course satisfied by either side of a cross-listed code', () => {
  assert.equal(
    satisfied({ type: 'course', code: 'ENG/COM 251' }, takenFrom(['COM 251']), CATALOG).status,
    'satisfied',
  )
  const r = satisfied({ type: 'course', code: 'ENG/COM 251' }, takenFrom(['ENG 251']), CATALOG)
  assert.equal(r.status, 'satisfied')
  assert.deepEqual(r.matched, ['ENG 251'])
  assert.equal(
    satisfied({ type: 'course', code: 'ENG/COM 251' }, takenFrom(['CLA 252']), CATALOG).status,
    'unsatisfied',
  )
})

test('course satisfied through a prefix alias', () => {
  const r = satisfied({ type: 'course', code: 'GNDR 499' }, takenFrom(['GNDS 499']), CATALOG)
  assert.equal(r.status, 'satisfied')
  assert.deepEqual(r.matched, ['GNDS 499'])
})

test('any_of matches a cross-listed alternative', () => {
  const it = { type: 'any_of', codes: ['ENG/COM 251', 'BIO 161'] }
  assert.equal(satisfied(it, takenFrom(['COM 251']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['BIO 161']), CATALOG).status, 'satisfied')
  assert.equal(satisfied(it, takenFrom(['CLA 252']), CATALOG).status, 'unsatisfied')
})

test('from pool expands cross-listed codes', () => {
  const pool = filteredUniverse([{ type: 'from', codes: ['ENG/COM 251'] }], CATALOG)
  assert.deepEqual([...pool].sort(), ['COM 251', 'ENG 251', 'ENG/COM 251'])
  assert.equal(passes('ENG 251', { type: 'from', codes: ['ENG/COM 251'] }), true)
  assert.equal(passes('COM 251', { type: 'from', codes: ['ENG/COM 251'] }), true)
})

test('exclude removes both sides of a cross-listed code', () => {
  const pool = filteredUniverse([{ type: 'exclude', codes: ['ENG/COM 251'] }], CATALOG)
  assert.ok(!pool.has('ENG 251'))
  assert.ok(!pool.has('COM 251'))
  assert.ok(pool.has('ENG 243'))
})

test('min_from counts cross-listed codes', () => {
  const chosen = ['ENG 251', 'BIO 161']
  assert.equal(checkAggregates(chosen, [{ type: 'min_from', codes: ['ENG/COM 251'], atLeast: 1 }]), true)
  assert.equal(
    checkAggregates(['BIO 161'], [{ type: 'min_from', codes: ['ENG/COM 251'], atLeast: 1 }]),
    false,
  )
})

test('solver consumes one side of a cross-listed course', () => {
  const track = {
    label: 'T',
    sections: [
      { heading: 'A', items: [{ type: 'course', code: 'ENG/COM 251' }] },
      { heading: 'B', items: [{ type: 'course', code: 'ENG/COM 251' }] },
    ],
  }
  const out = evaluateRequirement(track, takenFrom(['ENG 251']), CATALOG)
  assert.equal(out.sections[0].items[0].status, 'satisfied')
  assert.equal(out.sections[1].items[0].status, 'unsatisfied')
})

test('planGaps offers both sides of a cross-listed course', () => {
  const gaps = planGaps({ type: 'course', code: 'ENG/COM 251' }, takenFrom([]), CATALOG)
  assert.deepEqual(gaps.courses, ['ENG 251', 'COM 251', 'ENG/COM 251'])
})

test('gapGroups keeps nested any_of pairs together as options', () => {
  const science = {
    type: 'any_of',
    note: 'choose one pair',
    items: [
      {
        type: 'each_of',
        items: [
          { type: 'course', code: 'BIO 161' },
          { type: 'course', code: 'BIO 185' },
        ],
      },
      {
        type: 'each_of',
        items: [
          { type: 'course', code: 'CHE 161' },
          { type: 'course', code: 'CHE 185' },
        ],
      },
    ],
  }
  const groups = gapGroups(science, takenFrom([]), CATALOG, new Set())
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, 'choose one pair')
  assert.equal(groups[0].alternatives.length, 2)
  assert.deepEqual(groups[0].alternatives[0].slots, [{ codes: ['BIO 161'] }, { codes: ['BIO 185'] }])
  assert.deepEqual(groups[0].alternatives[1].slots, [{ codes: ['CHE 161'] }, { codes: ['CHE 185'] }])
})

test('gapGroups splits a choice+required slot into two slots', () => {
  const kip = {
    type: 'any_of',
    note: 'choose one pair',
    items: [
      {
        type: 'each_of',
        items: [
          { type: 'any_of', codes: ['BIO 165', 'BIO 185', 'KIP 161'] },
          { type: 'course', code: 'KIP 215' },
        ],
      },
    ],
  }
  const groups = gapGroups(kip, takenFrom([]), CATALOG, new Set())
  const option = groups[0].alternatives[0]
  assert.equal(option.slots.length, 2)
  assert.equal(option.slots[0].label, 'Choose one of')
  assert.deepEqual(option.slots[0].codes, ['BIO 165', 'BIO 185', 'KIP 161'])
  assert.deepEqual(option.slots[1], { codes: ['KIP 215'] })
})

test('gapGroups skips a nested any_of alternative already satisfied', () => {
  const science = {
    type: 'any_of',
    note: 'choose one pair',
    items: [
      {
        type: 'each_of',
        items: [
          { type: 'course', code: 'BIO 161' },
          { type: 'course', code: 'BIO 185' },
        ],
      },
      {
        type: 'each_of',
        items: [
          { type: 'course', code: 'CHE 161' },
          { type: 'course', code: 'CHE 185' },
        ],
      },
    ],
  }
  // With BIO 161+185 taken the whole any_of is satisfied, so no gap remains.
  const satisfied = gapGroups(science, takenFrom(['BIO 161', 'BIO 185']), CATALOG, new Set())
  assert.deepEqual(satisfied, [])
  // Taking only half a pair leaves the choice open, still offered as options.
  const half = gapGroups(science, takenFrom(['BIO 161']), CATALOG, new Set())
  assert.equal(half[0].alternatives.length, 2)
})

test('gapGroups falls back to a flat any_of when every option is a single course', () => {
  const it = {
    type: 'any_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
    ],
  }
  const groups = gapGroups(it, takenFrom([]), CATALOG, new Set())
  assert.equal(groups.length, 1)
  assert.ok(!groups[0].alternatives)
  assert.deepEqual(groups[0].codes, ['BIO 161', 'BIO 221'])
})

// ---------------------------------------------------------------------------
// planGaps / audit
// ---------------------------------------------------------------------------

test('planGaps for a missing course', () => {
  assert.deepEqual(planGaps({ type: 'course', code: 'BIO 161' }, takenFrom([]), CATALOG), {
    need: 1,
    courses: ['BIO 161'],
  })
})

test('planGaps for a satisfied course is empty', () => {
  assert.deepEqual(planGaps({ type: 'course', code: 'BIO 161' }, takenFrom(['BIO 161']), CATALOG), {
    need: 0,
    courses: [],
  })
})

test('planGaps for an unsatisfied any_of lists the alternatives', () => {
  const it = { type: 'any_of', codes: ['BIO 362', 'BIO 363'] }
  assert.deepEqual(planGaps(it, takenFrom([]), CATALOG), { need: 1, courses: ['BIO 362', 'BIO 363'] })
  assert.deepEqual(planGaps(it, takenFrom(['BIO 362']), CATALOG), { need: 0, courses: [] })
})

test('planGaps for each_of lists only the missing child', () => {
  const it = {
    type: 'each_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
    ],
  }
  const gaps = planGaps(it, takenFrom(['BIO 161']), CATALOG)
  assert.equal(gaps.need, 1)
  assert.deepEqual(gaps.courses, ['BIO 221'])
})

test('planGaps for some_of lists at most `need` children', () => {
  const it = {
    type: 'some_of',
    min: 2,
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
      { type: 'course', code: 'BIO 301' },
    ],
  }
  const gaps = planGaps(it, takenFrom(['BIO 161']), CATALOG)
  assert.equal(gaps.need, 1)
  assert.equal(gaps.courses.length, 1)
})

test('planGaps for electives caps recommended courses at need', () => {
  const it = { type: 'electives', count: 2, constraints: [{ type: 'discipline', prefixes: ['GER'] }] }
  const gaps = planGaps(it, takenFrom(['GER 101']), CATALOG)
  assert.equal(gaps.need, 1)
  assert.equal(gaps.courses.length, 1)
})

test('planGaps for electives flags aggregate shortfalls', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'level', level: 300, atLeast: 2 }],
  }
  // Enough courses, but only one at 300 -> falls to the aggregate flag.
  const gaps = planGaps(it, takenFrom(['GER 101', 'GER 301']), CATALOG)
  assert.equal(gaps.aggregate, true)
  assert.equal(gaps.need, 0)
})

test('planGaps for custom is unknown', () => {
  assert.deepEqual(planGaps({ type: 'custom', text: 'x' }, takenFrom([]), CATALOG), {
    need: 0,
    courses: [],
    unknown: true,
  })
})

// ---------------------------------------------------------------------------
// gapGroups / describeConstraints
// ---------------------------------------------------------------------------

test('gapGroups for a missing course is a bare group', () => {
  assert.deepEqual(gapGroups({ type: 'course', code: 'BIO 161' }, takenFrom([]), CATALOG), [
    { codes: ['BIO 161'] },
  ])
})

test('gapGroups is empty when satisfied', () => {
  assert.deepEqual(gapGroups({ type: 'course', code: 'BIO 161' }, takenFrom(['BIO 161']), CATALOG), [])
})

test('gapGroups presents an any_of choice once, not per alternative', () => {
  const it = { type: 'any_of', codes: ['BIO 362', 'BIO 363'] }
  assert.deepEqual(gapGroups(it, takenFrom([]), CATALOG), [
    { label: 'Choose one of', codes: ['BIO 362', 'BIO 363'] },
  ])
  // Taking one alternative clears the group entirely.
  assert.deepEqual(gapGroups(it, takenFrom(['BIO 362']), CATALOG), [])
})

test('gapGroups for each_of keeps only the still-missing child', () => {
  const it = {
    type: 'each_of',
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
    ],
  }
  assert.deepEqual(gapGroups(it, takenFrom(['BIO 161']), CATALOG), [{ codes: ['BIO 221'] }])
})

test('gapGroups for some_of is a single pick-N-of group', () => {
  const it = {
    type: 'some_of',
    min: 2,
    items: [
      { type: 'course', code: 'BIO 161' },
      { type: 'course', code: 'BIO 221' },
      { type: 'course', code: 'BIO 301' },
    ],
  }
  assert.deepEqual(gapGroups(it, takenFrom([]), CATALOG), [
    { label: 'Pick 2 of', codes: ['BIO 161', 'BIO 221', 'BIO 301'].slice(0, 2) },
  ])
})

test('gapGroups for an electives shortfall lists the full eligible pool, expandable', () => {
  const it = {
    type: 'electives',
    count: 3,
    constraints: [
      { type: 'discipline', prefixes: ['GER'] },
      { type: 'level', level: 300, atLeast: 2 },
    ],
  }
  const groups = gapGroups(it, takenFrom(['GER 101']), CATALOG)
  assert.equal(groups.length, 1)
  assert.match(groups[0].label, /^Need 2 more GER courses/)
  assert.equal(groups[0].expandable, true)
  // All eligible GER courses not yet taken, alphabetically.
  assert.deepEqual(groups[0].codes, ['GER 115', 'GER 222', 'GER 243', 'GER 301', 'GER 302'])
})

test('gapGroups for electives with count met but aggregate short flags an expandable pool', () => {
  const it = {
    type: 'electives',
    count: 2,
    constraints: [{ type: 'level', level: 300, atLeast: 2 }],
  }
  const groups = gapGroups(it, takenFrom(['GER 101', 'GER 301']), CATALOG)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].expandable, true)
  assert.match(groups[0].label, /Still need/)
  assert.ok(groups[0].codes.length > 0)
})

test('gapGroups for custom returns an unknown note', () => {
  const groups = gapGroups({ type: 'custom', text: 'x' }, takenFrom([]), CATALOG)
  assert.equal(groups.length, 1)
  assert.ok(groups[0].note)
})

test('describeConstraints renders filter and aggregate constraints', () => {
  const text = describeConstraints([
    { type: 'discipline', prefixes: ['CS'] },
    { type: 'level', level: 200, orAbove: true },
    { type: 'level', level: 300, atLeast: 2 },
  ])
  assert.match(text, /CS courses/)
  assert.match(text, /200-level or above/)
  assert.match(text, /at least 2 at 300-level/)
})

test('describeConstraints is empty without constraints', () => {
  assert.equal(describeConstraints([]), '')
})

test('audit rolls up requirement statuses', () => {
  const reqs = [
    {
      label: 'Met',
      sections: [{ heading: 'Core', items: [{ type: 'course', code: 'BIO 161' }] }],
    },
    {
      label: 'Partial',
      sections: [
        { heading: 'A', items: [{ type: 'course', code: 'BIO 161' }] },
        { heading: 'B', items: [{ type: 'course', code: 'BIO 221' }] },
      ],
    },
    { label: 'Unknown', sections: [{ heading: 'C', items: [{ type: 'custom', text: 'x' }] }] },
  ]
  const out = audit(evaluateProgram(reqs, takenFrom(['BIO 161']), CATALOG))
  assert.equal(out.total, 3)
  assert.equal(out.satisfied, 1)
  assert.equal(out.partial, 1)
  assert.equal(out.unknown, 1)
  assert.equal(out.unsatisfied, 0)
  assert.equal(out.requirements[1].status, 'partial')
  assert.equal(out.requirements[1].sections[0].status, 'satisfied')
  assert.equal(out.requirements[1].sections[1].status, 'unsatisfied')
})

// ---------------------------------------------------------------------------
// prerequisites — parsing raw catalog strings into checkable groups
// ---------------------------------------------------------------------------

// The catalog used for prerequisite parsing — an array of codes (the same
// shape `allCourses` derives from majors.json).
const PREREQ_CATALOG = [
  ...CATALOG,
  'CS 223',
  'MAT 113',
  'ANTH 162',
  'INS 161',
  'PLS 160',
  'CHE 161',
  'BIO 185',
  'KIP 161',
  'FRE 115',
  'MAT 121',
]

const ORDER = ['y1f', 'y1w', 'y1s', 'y2f', 'y2w', 'y2s', 'y3f', 'y3w', 'y3s', 'y4f', 'y4w', 'y4s']

test('prereqGroups resolves a bare-number prerequisite against the own prefix', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [{ kind: 'all', codes: ['CS 220'] }])
})

test('prereqGroups parses an explicit code', () => {
  const course = { course_code: 'MAT 121', prerequisites: ['MAT 113'] }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [{ kind: 'all', codes: ['MAT 113'] }])
})

test('prereqGroups treats "X or …" clauses as any-of groups', () => {
  const course = { course_code: 'ANTH 259', prerequisites: ['162 or a sociology gateway course'] }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [{ kind: 'any', codes: ['ANTH 162'] }])
})

test('prereqGroups aliases CHEM to CHE', () => {
  const course = { course_code: 'BIO 223', prerequisites: ['CHEM 161 and one of BIO 185 or KIP 161'] }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [
    { kind: 'all', codes: ['CHE 161'] },
    { kind: 'any', codes: ['BIO 185', 'KIP 161'] },
  ])
})

test('prereqGroups drops except-clauses and level-band noise', () => {
  const course = {
    course_code: 'PLS 212',
    prerequisites: ['a 100-level Political Science course (except PLS 160) or INS 161'],
  }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [{ kind: 'any', codes: ['INS 161'] }])
})

test('prereqGroups ignores courses not in the catalog', () => {
  const course = { course_code: 'ENGR 325', prerequisites: ['305'] }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [])
})

test('prereqGroups drops standing/permission/placement prose', () => {
  const course = {
    course_code: 'ARTD 210',
    prerequisites: ['Sophomore standing or above or instructor permission'],
  }
  const placement = {
    course_code: 'CS 231',
    prerequisites: ['placement at the Ready for Precalculus level or above'],
  }
  assert.deepEqual(prereqGroups(course, PREREQ_CATALOG), [])
  assert.deepEqual(prereqGroups(placement, PREREQ_CATALOG), [])
})

test('prereqGroups leaves a course without prerequisites empty', () => {
  assert.deepEqual(prereqGroups({ course_code: 'BIO 161', prerequisites: [] }, PREREQ_CATALOG), [])
})

// ---------------------------------------------------------------------------
// prereqStatus — presence and timing against planner slots
// ---------------------------------------------------------------------------

const slotted = (object) => object

test('prereqStatus is met when the prerequisite is scheduled earlier', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  const status = prereqStatus(slotted({ y1f: ['CS 220'], y2f: ['CS 223'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(status.met, true)
  assert.deepEqual(status.missing, [])
  assert.deepEqual(status.outOfOrder, [])
})

test('prereqStatus flags a prerequisite missing from the plan', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  const status = prereqStatus(slotted({ y2f: ['CS 223'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(status.met, false)
  assert.deepEqual(status.missing, ['CS 220'])
})

test('prereqStatus flags a prerequisite scheduled too late', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  const status = prereqStatus(slotted({ y1f: ['CS 223'], y2f: ['CS 220'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(status.met, false)
  assert.deepEqual(status.outOfOrder, ['CS 220'])
})

test('prereqStatus flags a prerequisite in the same term', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  const status = prereqStatus(slotted({ y1f: ['CS 220', 'CS 223'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(status.met, false)
  assert.deepEqual(status.outOfOrder, ['CS 220'])
})

test('prereqStatus skips ordering checks for unassigned courses', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  const status = prereqStatus(slotted({ unassigned: ['CS 220', 'CS 223'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(status.met, true)
  assert.deepEqual(status.missing, [])
  assert.deepEqual(status.outOfOrder, [])
})

test('prereqStatus treats transfer credit as earlier than any term', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220'] }
  const status = prereqStatus(
    slotted({ transfer: ['CS 220'], y1f: ['CS 223'] }),
    course,
    PREREQ_CATALOG,
    ORDER,
  )
  assert.equal(status.met, true)
})

test('prereqStatus honors any-of groups for both presence and timing', () => {
  const course = { course_code: 'CS 223', prerequisites: ['220 or MAT 121'] }
  const earlier = prereqStatus(slotted({ y1f: ['MAT 121'], y2f: ['CS 223'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(earlier.met, true)
  const late = prereqStatus(slotted({ y1f: ['CS 223'], y2f: ['MAT 121'] }), course, PREREQ_CATALOG, ORDER)
  assert.equal(late.met, false)
  assert.deepEqual(late.outOfOrder, ['MAT 121'])
})
