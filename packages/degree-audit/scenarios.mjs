// Synthetic capability catalog for the evaluator.
//
// Every row is a checked-in acceptance case for a requirement SHAPE the engine
// must handle — deliberately written against the synthetic catalog below, NOT
// snapshotted from the current majors.json / core_requirements.json. The
// `sourceShape` tag names the real catalog pattern each row models (core:SM,
// core:WL, program:GNDS, ...) so that when a requirement restructures, this
// table makes it obvious which capability is being relied on and whether the
// redesign still needs it.
//
// Run standalone:   node packages/degree-audit/scenarios.mjs
// As a CI test:     the same rows are asserted by test/scenarios.test.js.
// Assertion fields (all optional):
//   status            exact track status from trackReport
//   sectionStatus     exact section[0] status
//   sectionCounted    exact section[0].counted array
//   sectionExtra      exact section[0].extra array
//   done / total      exact section[0].done / total
//   offers            codes that must appear among the gap-group options
//   offersNone        codes that must NOT appear among the gap-group options
//   prereq            expected flattened prerequisite codes (course_info probe)

// Shared synthetic catalog: covers every discipline/level the shapes reference.
const CATALOG = [
  'FRE 115',
  'FRE 116',
  'FRE 217',
  'FRE 218',
  'FRE 309',
  'GER 115',
  'GER 116',
  'GER 217',
  'GER 218',
  'GER 301',
  'GER 302',
  'SPA 217',
  'SPA 219',
  'SPA 319',
  'SPA 320',
  'GRE 217',
  'GRE 218',
  'CS 150',
  'CS 220',
  'CS 223',
  'CS 231',
  'CS 340',
  'CS 345',
  'MAT 113',
  'MAT 121',
  'MAT 135',
  'MAT 232',
  'BIO 161',
  'BIO 185',
  'BIO 221',
  'BIO 301',
  'BIO 362',
  'BIO 363',
  'ANTH 160',
  'ANTH 223',
  'ANTH 311',
  'ENG 243',
  'ENG 244',
  'ENG 251',
  'ENG 300',
  'ENG/COM 251',
  'COM 251',
  'CLA 252',
  'HIS 252',
  'HIS 327',
  'GNDS 499',
  'ENV 306',
  'ENV 408',
  'ENV 409',
  'MUS 232',
  'HF 101',
]

const wl = {
  label: 'World Languages',
  sections: [
    {
      heading: '2-unit sequence in the same language',
      items: [
        {
          type: 'electives',
          count: 2,
          constraints: [{ type: 'discipline', sameDiscipline: true }],
        },
      ],
    },
  ],
}

const sm = {
  label: 'Scientific & Mathematical Methods',
  independentSections: true,
  sections: [
    {
      heading: 'Methods',
      items: [
        {
          type: 'electives',
          count: 3,
          constraints: [
            { type: 'discipline', distinctAtLeast: 3 },
            { type: 'min_from', codes: ['BIO 161'], atLeast: 1 },
          ],
        },
      ],
    },
  ],
}

export const scenarios = [
  {
    sourceShape: 'core:WL',
    name: 'single language started offers only its continuations',
    requirement: wl,
    taken: ['SPA 217'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'partial',
      done: 1,
      total: 2,
      offers: ['SPA 219'],
      offersNone: ['GER 116', 'HIS 327', 'BIO 161'],
    },
  },
  {
    sourceShape: 'core:WL',
    name: 'two languages started keeps BOTH threads offerable',
    requirement: wl,
    taken: ['SPA 217', 'GER 218'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'partial',
      done: 1,
      total: 2,
      offers: ['SPA 219', 'GER 115', 'GER 116', 'GER 217'],
      offersNone: ['HIS 327', 'BIO 161', 'ENG 243'],
    },
  },
  {
    sourceShape: 'core:WL',
    name: 'same-language pair satisfies the sequence',
    requirement: wl,
    taken: ['SPA 217', 'SPA 219'],
    expect: {
      status: 'satisfied',
      sectionStatus: 'satisfied',
      sectionCounted: ['SPA 217', 'SPA 219'],
      sectionExtra: [],
    },
  },
  {
    sourceShape: 'core:SM',
    name: 'single CS course reads 1/3',
    requirement: sm,
    taken: ['CS 220'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'partial',
      done: 1,
      total: 3,
      sectionCounted: ['CS 220'],
      sectionExtra: [],
    },
  },
  {
    sourceShape: 'core:SM',
    name: 'surplus same-discipline course is dead weight, not progress',
    requirement: sm,
    taken: ['CS 220', 'CS 223'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'partial',
      done: 1,
      total: 3,
      sectionCounted: ['CS 220'],
      sectionExtra: ['CS 223'],
    },
  },
  {
    sourceShape: 'core:SM',
    name: 'second distinct discipline unlocks 2/3',
    requirement: sm,
    taken: ['CS 220', 'CS 223', 'ANTH 160'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'partial',
      done: 2,
      total: 3,
      sectionCounted: ['ANTH 160', 'CS 220'],
      sectionExtra: ['CS 223'],
    },
  },
  {
    sourceShape: 'core:SM',
    name: 'count-short bucket offers every eligible course',
    requirement: sm,
    taken: ['CS 220'],
    expect: {
      done: 1,
      total: 3,
      offers: ['ANTH 160', 'MAT 121', 'BIO 161', 'GER 116'],
    },
  },
  {
    sourceShape: 'core:SM',
    name: 'only the missing lab closes a no-lab bucket',
    requirement: sm,
    taken: ['CS 220', 'CS 223', 'ANTH 160'],
    expect: {
      done: 2,
      total: 3,
      offers: ['BIO 161'],
      offersNone: ['CS 150', 'SPA 219', 'GER 116', 'MAT 121'],
    },
  },
  {
    sourceShape: 'core:QL+SM',
    name: 'independent core sections let one course count twice',
    requirement: {
      label: 'Core',
      independentSections: true,
      sections: [
        { heading: 'QL', items: [{ type: 'course', code: 'MAT 121' }] },
        {
          heading: 'SM',
          items: [
            {
              type: 'electives',
              count: 3,
              constraints: [
                { type: 'discipline', distinctAtLeast: 3 },
                { type: 'min_from', codes: ['BIO 161'], atLeast: 1 },
              ],
            },
          ],
        },
      ],
    },
    taken: ['MAT 121', 'BIO 161'],
    expect: {
      status: 'partial',
      sectionIndex: 1,
      sectionStatus: 'partial',
      done: 2,
      total: 3,
    },
  },
  {
    sourceShape: 'program:any_of',
    name: 'any_of choice lists the open alternatives',
    requirement: {
      label: 'BS Requirement',
      sections: [
        {
          heading: 'Choose one',
          items: [{ type: 'any_of', codes: ['BIO 362', 'BIO 363'] }],
        },
      ],
    },
    taken: [],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'unsatisfied',
      offers: ['BIO 362', 'BIO 363'],
    },
  },
  {
    sourceShape: 'program:each_of',
    name: 'each_of requires every child',
    requirement: {
      label: 'Gateway',
      sections: [
        {
          heading: 'Both',
          items: [
            {
              type: 'each_of',
              items: [
                { type: 'course', code: 'CS 220' },
                { type: 'course', code: 'CS 231' },
              ],
            },
          ],
        },
      ],
    },
    taken: ['CS 220'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'unsatisfied',
      offers: ['CS 231'],
    },
  },
  {
    sourceShape: 'program:crossover',
    name: 'cross-listed ENG/COM 251 resolves to either spelling',
    requirement: {
      label: 'Crossover',
      sections: [{ heading: 'Speech', items: [{ type: 'course', code: 'ENG/COM 251' }] }],
    },
    taken: ['COM 251'],
    expect: {
      status: 'satisfied',
      sectionStatus: 'satisfied',
    },
  },
  {
    sourceShape: 'program:range',
    name: 'a range code requires every endpoint',
    requirement: {
      label: 'Capstone',
      sections: [{ heading: 'Range', items: [{ type: 'course', code: 'ENV 408-409' }] }],
    },
    // Both halves of the range must be present, mirroring how
    // assignRequirement consumes a range alternative together.
    taken: ['ENV 408', 'ENV 409'],
    expect: {
      status: 'satisfied',
      sectionStatus: 'satisfied',
    },
  },
  {
    sourceShape: 'program:course',
    name: 'required course present satisfies',
    requirement: {
      label: 'Core course',
      sections: [{ heading: 'Req', items: [{ type: 'course', code: 'HIS 327' }] }],
    },
    taken: ['HIS 327'],
    expect: {
      status: 'satisfied',
      sectionStatus: 'satisfied',
    },
  },
  {
    sourceShape: 'program:level',
    name: 'level-band electives count only in-band courses',
    requirement: {
      label: 'Upper division',
      sections: [
        {
          heading: '2 × 300+',
          items: [{ type: 'electives', count: 2, constraints: [{ type: 'level', level: 300, atLeast: 2 }] }],
        },
      ],
    },
    taken: ['FRE 309', 'GER 301'],
    expect: {
      status: 'satisfied',
      sectionStatus: 'satisfied',
      sectionCounted: ['FRE 309', 'GER 301'],
    },
  },
  {
    sourceShape: 'program:some_of',
    name: 'some_of reports the worst missing child',
    requirement: {
      label: 'Two of three',
      sections: [
        {
          heading: 'Pick 2',
          items: [
            {
              type: 'some_of',
              min: 2,
              items: [
                { type: 'course', code: 'MAT 113' },
                { type: 'course', code: 'MAT 121' },
                { type: 'course', code: 'MAT 232' },
              ],
            },
          ],
        },
      ],
    },
    taken: ['MAT 113'],
    expect: {
      status: 'unsatisfied',
      sectionStatus: 'unsatisfied',
      done: 0,
      total: 2,
    },
  },
  {
    sourceShape: 'program:prereq',
    name: 'prerequisites parse from an explicit code',
    requirement: {
      label: 'Prereq probe',
      sections: [{ heading: 'Course', items: [{ type: 'course', code: 'CS 231' }] }],
    },
    taken: ['CS 231'],
    catalog: [...CATALOG, { course_code: 'CS 231', prerequisites: ['CS 220'] }],
    expect: { prereq: ['CS 220'] },
  },
]

// --- Runner --------------------------------------------------------------

// Flatten a catalog that may include course records down to the code array the
// evaluator expects.
function catalogCodes(catalog) {
  return (catalog || CATALOG).map((item) => (typeof item === 'string' ? item : item.course_code))
}

function run(scenario) {
  const catalog = scenario.catalog || CATALOG
  return trackReport(scenario.requirement, scenario.taken, catalogCodes(catalog), { gaps: true })
}

function check(scenario, report) {
  const failures = []
  const expect = scenario.expect
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  if (expect.status != null && report.status !== expect.status) {
    failures.push(`status ${JSON.stringify(report.status)} ≠ ${JSON.stringify(expect.status)}`)
  }
  const sec = report.sections[expect.sectionIndex || 0] || {}
  if (expect.sectionStatus != null && sec.status !== expect.sectionStatus) {
    failures.push(`sectionStatus ${JSON.stringify(sec.status)} ≠ ${JSON.stringify(expect.sectionStatus)}`)
  }
  if (expect.sectionCounted != null && !eq(sec.counted, expect.sectionCounted)) {
    failures.push(`counted ${JSON.stringify(sec.counted)} ≠ ${JSON.stringify(expect.sectionCounted)}`)
  }
  if (expect.sectionExtra != null && !eq(sec.extra, expect.sectionExtra)) {
    failures.push(`extra ${JSON.stringify(sec.extra)} ≠ ${JSON.stringify(expect.sectionExtra)}`)
  }
  if (expect.done != null && sec.done !== expect.done) {
    failures.push(`done ${sec.done} ≠ ${expect.done}`)
  }
  if (expect.total != null && sec.total !== expect.total) {
    failures.push(`total ${sec.total} ≠ ${expect.total}`)
  }
  const options = (report.gaps || []).flatMap((g) => g.codes || [])
  for (const code of expect.offers || []) {
    if (!options.includes(code)) failures.push(`does not offer ${code}`)
  }
  for (const code of expect.offersNone || []) {
    if (options.includes(code)) failures.push(`should not offer ${code}`)
  }
  if (expect.prereq != null) {
    const catalog = catalogCodes(scenario.catalog)
    const course = (scenario.catalog || CATALOG).find(
      (c) => typeof c === 'object' && c.course_code === 'CS 231',
    ) || {
      course_code: 'CS 231',
    }
    const groups = prereqGroups(course, catalog)
    const flat = groups.flatMap((g) => g.codes || [])
    if (!eq(flat, expect.prereq))
      failures.push(`prereq ${JSON.stringify(flat)} ≠ ${JSON.stringify(expect.prereq)}`)
  }
  return failures
}

export function runScenarios(list = scenarios) {
  const failures = []
  let pass = 0
  for (const scenario of list) {
    const cases = check(scenario, run(scenario))
    if (cases.length) failures.push({ scenario, cases })
    else pass += 1
  }
  return { pass, total: list.length, failures }
}

function printTable() {
  const result = runScenarios()
  const wName = Math.max(20, ...scenarios.map((s) => s.name.length)) + 2
  const wShape = Math.max(12, ...scenarios.map((s) => s.sourceShape.length)) + 2
  console.log('--- evaluator scenarios ---')
  for (const s of scenarios) {
    const ok = !result.failures.some((f) => f.scenario === s)
    const status = s.expect.prereq ? 'prereq' : run(s).status
    console.log(`${ok ? '✔' : '✖'} ${s.name.padEnd(wName)} ${s.sourceShape.padEnd(wShape)} ${status}`)
  }
  console.log('---')
  console.log(`${result.pass}/${result.total} passing`)
  if (result.failures.length) {
    console.log('\nfailures:')
    for (const f of result.failures) {
      console.log(`  ${f.scenario.name}`)
      for (const msg of f.cases) console.log(`    - ${msg}`)
    }
  }
}

import { trackReport, prereqGroups } from './planner.js'

// CLI entrypoint: `node packages/degree-audit/scenarios.mjs`
if (process.argv[1] && process.argv[1].endsWith('/scenarios.mjs')) {
  printTable()
}
