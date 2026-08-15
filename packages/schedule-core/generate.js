// Client-side schedule generation: a random schedule across all departments,
// or a schedule containing exclusively one department's courses.
//
// Offerings are produced in the same shape parseCsv returns
// ({prefix, number, section, instructor, days, time}) so a generated schedule can
// be stored in the schedule collection alongside CSV-parsed ones.

import { SLOT_BLOCKS } from './schedule.js'

// Small deterministic PRNG (mulberry32) so generation is reproducible per seed.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle(rng, arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = a[i]
    a[i] = a[j]
    a[j] = t
  }
  return a
}

// Uniform random sample of `n` elements (without replacement).
function sample(rng, arr, n) {
  return shuffle(rng, arr).slice(0, n)
}

function normalizeFaculty(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\.$/, '')
}

// Build the prefix -> faculty-pool map (from programs, including interdisciplinary
// programs whose courses carry those prefixes) and the list of eligible courses
// (any course whose prefix has a faculty pool).
export function buildFacultyAndEligible(programs, allCourses) {
  const faculty = {} // prefix -> Set(faculty names)

  const add = (prefix, names) => {
    if (!names.size) return
    if (!faculty[prefix]) faculty[prefix] = new Set()
    for (const n of names) faculty[prefix].add(n)
  }

  for (const p of programs || []) {
    const names = new Set((p.faculty || []).map(normalizeFaculty).filter(Boolean))
    if (p.course_prefix) {
      add(p.course_prefix, names)
    } else {
      for (const c of p.courses || []) {
        const pf = String(c.course_code || '').split(' ')[0]
        add(pf, names)
      }
    }
  }

  const facultyByPrefix = {}
  for (const pf of Object.keys(faculty)) {
    if (faculty[pf].size) facultyByPrefix[pf] = Array.from(faculty[pf]).sort()
  }

  const eligible = []
  for (const code of Object.keys(allCourses || {})) {
    const [prefix, number] = code.split(' ')
    if (facultyByPrefix[prefix]) eligible.push({ prefix, number })
  }
  eligible.sort((a, b) =>
    a.prefix === b.prefix ? Number(a.number) - Number(b.number) : a.prefix < b.prefix ? -1 : 1,
  )

  return { facultyByPrefix, eligible }
}

// All week slots as "DAYS|time" keys.
function allSlots() {
  const keys = []
  for (const block of SLOT_BLOCKS) {
    for (const slot of block.slots) keys.push(`${block.label}|${slot.time}`)
  }
  return keys
}

// Generate a schedule. `mode` is 'random' (all departments, ~30%) or 'dept'
// (exclusively `prefix`, ~40% of that department). Returns offerings.
export function makeSchedule(mode, prefix, facultyByPrefix, eligible, seed) {
  const rng = mulberry32(seed)
  const slots = allSlots()

  let chosen
  if (mode === 'dept' && prefix) {
    const focus = eligible.filter((c) => c.prefix === prefix)
    chosen = sample(rng, focus, Math.min(focus.length, Math.max(1, Math.round(focus.length * 0.4))))
  } else {
    chosen = sample(rng, eligible, Math.min(eligible.length, Math.max(1, Math.round(eligible.length * 0.3))))
  }
  if (!chosen.length) return []

  // About half of the chosen 100-level courses get a second section.
  const hundred = chosen.filter((c) => Number(c.number) < 200)
  const splitCount = Math.floor(hundred.length / 2)
  const splitSet = new Set(sample(rng, hundred, splitCount).map((c) => `${c.prefix} ${c.number}`))

  // Assign instructors by fewest load.
  const load = {}
  const instructorOf = {}
  const offerings = []
  for (const c of chosen) {
    const code = `${c.prefix} ${c.number}`
    const choices = facultyByPrefix[c.prefix] || []
    let inst = choices[0]
    for (const f of choices) {
      if ((load[f] || 0) < (load[inst] || 0)) inst = f
    }
    load[inst] = (load[inst] || 0) + 1
    instructorOf[code] = inst
    offerings.push({ prefix: c.prefix, number: c.number, section: 'A' })
    if (splitSet.has(code)) offerings.push({ prefix: c.prefix, number: c.number, section: 'B' })
  }

  // Greedy slot assignment: no instructor double-booked in a slot, no two
  // sections of the same course in the same slot. Unplaced offerings are skipped.
  const slotTakenBy = {}
  const courseAt = {}
  for (const sk of slots) {
    slotTakenBy[sk] = new Set()
    courseAt[sk] = new Set()
  }
  const assignment = {}
  for (const o of shuffle(rng, offerings)) {
    const code = `${o.prefix} ${o.number}`
    const inst = instructorOf[code]
    for (const sk of shuffle(rng, slots)) {
      if (courseAt[sk].has(code)) continue
      if (slotTakenBy[sk].has(inst)) continue
      assignment[`${code} ${o.section}`] = sk
      slotTakenBy[sk].add(inst)
      courseAt[sk].add(code)
      break
    }
  }

  return offerings
    .filter((o) => assignment[`${o.prefix} ${o.number} ${o.section}`])
    .map((o) => {
      const sk = assignment[`${o.prefix} ${o.number} ${o.section}`]
      const [days, time] = sk.split('|')
      return {
        prefix: o.prefix,
        number: o.number,
        section: o.section,
        instructor: instructorOf[`${o.prefix} ${o.number}`],
        days,
        time,
      }
    })
}
