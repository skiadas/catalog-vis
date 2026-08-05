// Pure, testable requirements evaluator.
//
// Data is passed in as arguments (never imported from the Vue store) so this
// module can be exercised under `node --test` with hand-built fixtures.
//
// Semantics:
// - A requirement node is satisfied independently (`satisfied`); overlap is
//   naive membership — a course may satisfy many nodes. No double-count
//   assignment is performed (v1 limitation).
// - `any_of` is satisfied when at least one alternative is taken (you cannot
//   "un-take" courses, so "exactly one" is not enforced).
//
// Constraints come in two kinds:
// - Per-course *filters* (`from` codes, `exclude`, plain `level`,
//   plain `discipline`) that scope which courses count.
// - Count *aggregates* over the chosen set (`level.atLeast/atMost`,
//   `discipline.atLeast/atMost/distinctAtLeast`, `max_from`, `min_from`).
// Aggregates never scope the universe — e.g. `discipline{GER atLeast 7}`
// still lets non-GER courses fill the remainder of an electives bucket.

const CODE_RE = /^([A-Z/]+)\s+(\S+)$/

const hasCount = (c) => c.atLeast != null || c.atMost != null || c.distinctAtLeast != null

// ---------------------------------------------------------------------------
// Code helpers
// ---------------------------------------------------------------------------

// Splits a catalog course code into its prefixes and numeric part. Handles
// cross-listed codes like `"CLA/HIS 252"` -> `{ prefixes: ['CLA','HIS'], number: 252 }`.
export function courseInfo(code) {
  const m = CODE_RE.exec(code)
  if (!m) return { prefixes: [], number: null }
  const prefixes = m[1].split('/')
  const digits = (m[2].match(/\d{3}/) || [])[0]
  return { prefixes, number: digits ? Number(digits) : null }
}

function toSet(value) {
  if (value instanceof Set) return value
  if (Array.isArray(value)) return new Set(value)
  if (value && typeof value === 'object') return new Set(Object.keys(value))
  return new Set()
}

function prefixMatch(code, prefixes) {
  return courseInfo(code).prefixes.some((p) => prefixes.includes(p))
}

function levelAt(code, level, orAbove) {
  const number = courseInfo(code).number
  if (number == null || level == null) return false
  // "300-level" means the 300–399 band; `orAbove` widens to no upper bound.
  if (orAbove) return number >= level
  return number >= level && number < level + 100
}

// ---------------------------------------------------------------------------
// Filters & aggregates
// ---------------------------------------------------------------------------

export function passes(code, constraint) {
  switch (constraint.type) {
    case 'from':
      return constraint.codes ? constraint.codes.includes(code) : true
    case 'exclude':
      return !constraint.codes.includes(code)
    case 'level':
      if (hasCount(constraint)) return true
      if (constraint.min != null && constraint.max != null) {
        const number = courseInfo(code).number
        return number != null && number >= constraint.min && number <= constraint.max
      }
      return levelAt(code, constraint.level, constraint.orAbove)
    case 'discipline':
      if (hasCount(constraint) || !constraint.prefixes) return true
      return prefixMatch(code, constraint.prefixes)
    default:
      return true
  }
}

// Determines the set of courses eligible for an `electives` bucket. Scope comes
// only from *filter* constraints: `from` codes, plain `discipline`, plain
// `level`. `exclude` is always subtracted. Aggregates never scope.
export function filteredUniverse(constraints, catalog) {
  const constraintsList = constraints || []
  const all = toSet(catalog)
  let pool = null

  for (const c of constraintsList) {
    if (c.type === 'from' && c.codes) {
      pool = intersection(pool, new Set(c.codes))
    } else if (c.type === 'discipline' && !hasCount(c) && c.prefixes) {
      const pred = (code) => prefixMatch(code, c.prefixes)
      pool = pool ? new Set([...pool].filter(pred)) : new Set([...all].filter(pred))
    } else if (c.type === 'level' && !hasCount(c)) {
      const pred = (code) => passes(code, c)
      pool = pool ? new Set([...pool].filter(pred)) : new Set([...all].filter(pred))
    }
  }

  if (!pool) pool = new Set(all)

  for (const c of constraintsList) {
    if (c.type === 'exclude') {
      for (const code of c.codes) pool.delete(code)
    }
  }

  return pool
}

function intersection(a, b) {
  return a ? new Set([...a].filter((x) => b.has(x))) : b
}

// Verifies count aggregates hold over the chosen set. Returns boolean.
export function checkAggregates(chosen, constraints) {
  const codes = [...chosen]
  for (const c of constraints || []) {
    if (c.type === 'level' && (c.atLeast != null || c.atMost != null)) {
      const at = codes.filter((code) => levelAt(code, c.level, c.orAbove)).length
      if (c.atLeast != null && at < c.atLeast) return false
      if (c.atMost != null && at > c.atMost) return false
    } else if (
      c.type === 'discipline' &&
      (c.atLeast != null || c.atMost != null || c.distinctAtLeast != null)
    ) {
      if (c.distinctAtLeast != null) {
        const distinct = new Set(codes.flatMap((code) => courseInfo(code).prefixes)).size
        if (distinct < c.distinctAtLeast) return false
      }
      if (c.atLeast != null) {
        const at = codes.filter((code) => prefixMatch(code, c.prefixes || [])).length
        if (at < c.atLeast) return false
      }
      if (c.atMost != null) {
        const at = c.prefixes
          ? Math.max(
              0,
              ...c.prefixes.map((p) => codes.filter((code) => courseInfo(code).prefixes.includes(p)).length),
            )
          : maxDisciplineUse(codes)
        if (at > c.atMost) return false
      }
    } else if (c.type === 'max_from' && c.atMost != null) {
      const at = codes.filter((code) => c.codes.includes(code)).length
      if (at > c.atMost) return false
    } else if (c.type === 'min_from' && c.atLeast != null) {
      const at = codes.filter((code) => c.codes.includes(code)).length
      if (at < c.atLeast) return false
    }
  }
  return true
}

function maxDisciplineUse(codes) {
  const counts = {}
  for (const code of codes) {
    for (const p of courseInfo(code).prefixes) counts[p] = (counts[p] || 0) + 1
  }
  const values = Object.values(counts)
  return values.length ? Math.max(...values) : 0
}

// ---------------------------------------------------------------------------
// Recursive evaluation
// ---------------------------------------------------------------------------

// Evaluates a single requirement item. Returns a `Result`:
// { status: 'satisfied'|'unsatisfied'|'unknown', matched, missing, needed, count, min, max }
export function satisfied(item, taken, catalog) {
  const takenSet = toSet(taken)

  switch (item.type) {
    case 'course': {
      const hit = takenSet.has(item.code)
      return {
        status: hit ? 'satisfied' : 'unsatisfied',
        matched: hit ? [item.code] : [],
        missing: hit ? [] : [item.code],
        needed: hit ? 0 : 1,
        count: hit ? 1 : 0,
        min: 1,
        max: 1,
      }
    }

    case 'any_of': {
      const results = item.codes
        ? item.codes.map((code) => ({
            status: takenSet.has(code) ? 'satisfied' : 'unsatisfied',
            matched: takenSet.has(code) ? [code] : [],
            missing: [code],
          }))
        : (item.items || []).map((it) => satisfied(it, taken, catalog))
      const matched = results.flatMap((r) => r.matched)
      const ok = results.some((r) => r.status === 'satisfied')
      return {
        status: ok ? 'satisfied' : 'unsatisfied',
        matched,
        missing: results.flatMap((r) => (r.status === 'satisfied' ? [] : r.missing)),
        needed: ok ? 0 : 1,
        count: matched.length,
        min: 1,
        max: 1,
      }
    }

    case 'each_of': {
      const results = (item.items || []).map((it) => satisfied(it, taken, catalog))
      const satisfiedCount = results.filter((r) => r.status === 'satisfied').length
      const ok = results.every((r) => r.status === 'satisfied')
      return {
        status: ok ? 'satisfied' : 'unsatisfied',
        matched: results.flatMap((r) => r.matched),
        missing: ok ? [] : results.flatMap((r) => (r.status === 'satisfied' ? [] : r.missing)),
        needed: ok ? 0 : item.items.length - satisfiedCount,
        count: satisfiedCount,
        min: item.items.length,
        max: item.items.length,
      }
    }

    case 'some_of': {
      const min = item.min ?? 1
      const results = (item.items || []).map((it) => satisfied(it, taken, catalog))
      const satisfiedCount = results.filter((r) => r.status === 'satisfied').length
      const ok = satisfiedCount >= min
      return {
        status: ok ? 'satisfied' : 'unsatisfied',
        matched: results.flatMap((r) => r.matched),
        missing: results.flatMap((r) => (r.status === 'satisfied' ? [] : r.missing)),
        needed: ok ? 0 : min - satisfiedCount,
        count: satisfiedCount,
        min,
        max: item.items.length,
      }
    }

    case 'electives': {
      const constraints = item.constraints || []
      const pool = filteredUniverse(constraints, catalog)
      const chosen = [...pool].filter((code) => takenSet.has(code))
      const baseOk = chosen.length >= (item.count || 0)
      const aggOk = checkAggregates(chosen, constraints)
      const ok = baseOk && aggOk
      return {
        status: ok ? 'satisfied' : 'unsatisfied',
        matched: chosen,
        missing: ok ? [] : [...pool].filter((code) => !takenSet.has(code)),
        needed: (item.count || 0) - chosen.length,
        count: chosen.length,
        min: item.count || 0,
        max: item.count || 0,
      }
    }

    case 'pair': {
      // Retired legacy type; treat as `each_of` (every alternative required).
      const items = item.items || (item.codes || []).map((code) => ({ type: 'course', code }))
      return satisfied({ type: 'each_of', items }, taken, catalog)
    }

    case 'level_gate':
    case 'custom':
    default:
      // Anything that can't be structurally evaluated.
      return { status: 'unknown', matched: [], missing: [], needed: 0, count: 0, min: 0, max: 0 }
  }
}

// Evaluates every section/item of a single requirement.
export function evaluateRequirement(requirement, taken, catalog) {
  return {
    label: requirement.label,
    sections: (requirement.sections || []).map((s) => ({
      heading: s.heading,
      items: (s.items || []).map((it) => satisfied(it, taken, catalog)),
    })),
  }
}

// Evaluates the full parsed requirement list for a program.
export function evaluateProgram(requirements, taken, catalog) {
  return (requirements || []).map((r) => evaluateRequirement(r, taken, catalog))
}

// ---------------------------------------------------------------------------
// Planning / audit helpers
// ---------------------------------------------------------------------------

function unionGaps(gaps, cap) {
  const need = gaps.reduce((sum, g) => sum + g.need, 0)
  const courses = [...new Set(gaps.flatMap((g) => g.courses))].slice(0, cap)
  return { need, courses }
}

// Derives the "still needed" information for a single requirement item, given
// the courses already taken. Returns:
//   { need: number, courses: string[], aggregate?: true, unknown?: true }
// - `courses` lists concrete codes still worth taking (capped to `need` for
//   large electives pools).
// - `aggregate` is set when an electives bucket has enough courses but still
//   fails a count rule (e.g. not enough at the 300-level) — code-level picks
//   can't be derived naively, so the caller should prompt for a choice.
// - `unknown` marks items whose satisfaction can't be computed (custom notes).
export function planGaps(item, taken, catalog) {
  const result = satisfied(item, taken, catalog)
  if (result.status === 'satisfied') return { need: 0, courses: [] }
  if (result.status === 'unknown') return { need: 0, courses: [], unknown: true }

  switch (item.type) {
    case 'course':
      return { need: 1, courses: [item.code] }
    case 'any_of':
      if (item.codes) return { need: 1, courses: item.codes }
      // An `any_of` with items needs any one child satisfied.
      return { need: result.needed, courses: unionGaps(gapsOfChildren(item, taken, catalog), 1).courses }
    case 'each_of':
    case 'pair': {
      const children = gapsOfChildren(item, taken, catalog)
      return { need: result.needed, courses: unionGaps(children, result.needed || Infinity).courses }
    }
    case 'some_of': {
      // Only the worst (shortest) `need` children really need attention.
      const children = gapsOfChildren(item, taken, catalog)
      const missing = children.filter((g) => g.need > 0)
      return {
        need: result.needed,
        courses: unionGaps(missing, result.needed || Infinity).courses,
      }
    }
    case 'electives': {
      if (result.count < (item.count || 0)) {
        // Base count short — recommend eligible courses, preferring those that
        // also help close unmet aggregate rules (e.g. "at least 7 GER",
        // "N at the 300-level", a min_from floor).
        const constraints = item.constraints || []
        const weighted = [...result.missing].sort(
          (a, b) => electivesWeight(b, constraints) - electivesWeight(a, constraints) || a.localeCompare(b),
        )
        return { need: result.needed, courses: weighted.slice(0, result.needed) }
      }
      // Count is enough but an aggregate (level/discipline/min_from) fails.
      return { need: 0, courses: [], aggregate: true }
    }
    default:
      return { need: 0, courses: [], unknown: true }
  }
}

function gapsOfChildren(item, taken, catalog) {
  const items = item.items || (item.codes || []).map((code) => ({ type: 'course', code }))
  return items.map((it) => planGaps(it, taken, catalog))
}

// Ranks a course by how many unmet aggregate rules it would help close. Used to
// make electives recommendations relevant (e.g. German -> GER + 300-level first)
// instead of alphabetically arbitrary when the universe is open.
function electivesWeight(code, constraints) {
  let weight = 0
  for (const c of constraints) {
    if (c.type === 'discipline' && c.atLeast && c.prefixes && prefixMatch(code, c.prefixes)) weight += 2
    else if (c.type === 'level' && c.atLeast != null && levelAt(code, c.level, c.orAbove)) weight += 2
    else if (c.type === 'level' && c.min != null && c.max != null && passes(code, c)) weight += 1
    else if (c.type === 'min_from' && c.codes && c.codes.includes(code)) weight += 2
    else if (c.type === 'exclude' && c.codes.includes(code)) weight -= 3
  }
  return weight
}

// Rolls a program's evaluation up to section / requirement / program status.
// Each requirement reports its own status and per-section tallies.
export function audit(evaluatedProgram) {
  const requirements = evaluatedProgram.map((req) => {
    const sections = req.sections.map((s) => {
      const satisfied = s.items.filter((r) => r.status === 'satisfied').length
      const unknown = s.items.some((r) => r.status === 'unknown')
      const allMet = satisfied === s.items.length && !unknown
      const anyMet = satisfied > 0
      const status = unknown ? 'unknown' : allMet ? 'satisfied' : anyMet ? 'partial' : 'unsatisfied'
      return { heading: s.heading, status, satisfied, total: s.items.length }
    })
    const allMet = sections.every((s) => s.status === 'satisfied')
    const anyMet = sections.some((s) => s.status !== 'unsatisfied')
    const unknown = sections.some((s) => s.status === 'unknown')
    const status = unknown ? 'unknown' : allMet ? 'satisfied' : anyMet ? 'partial' : 'unsatisfied'
    return {
      label: req.label,
      status,
      sections,
      satisfied: sections.filter((s) => s.status === 'satisfied').length,
      total: sections.length,
    }
  })
  return {
    requirements,
    satisfied: requirements.filter((r) => r.status === 'satisfied').length,
    partial: requirements.filter((r) => r.status === 'partial').length,
    unsatisfied: requirements.filter((r) => r.status === 'unsatisfied').length,
    unknown: requirements.filter((r) => r.status === 'unknown').length,
    total: requirements.length,
  }
}
