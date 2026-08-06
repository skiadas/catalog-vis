// Pure, testable requirements evaluator.
//
// Data is passed in as arguments (never imported from the Vue store) so this
// module can be exercised under `node --test` with hand-built fixtures.
//
// Semantics:
// - Within a single requirement (track), a course satisfies at most one node:
//   courses claimed by required/choice nodes are excluded from the track's
//   electives buckets (`claimedCourses`). Across tracks, a course may count
//   for each track independently (naive global membership).
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

// Prefix spellings that appear in requirement text but not in the catalog.
// `GNDR` is a variant of `GNDS` in the gender-studies requirement text.
const PREFIX_ALIASES = { GNDR: 'GNDS' }

const hasCount = (c) =>
  c.atLeast != null || c.atMost != null || c.distinctAtLeast != null || c.sameDiscipline === true

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

// True when the code's prefix list contains any of `prefixes` (aliases applied
// to the code's spelling so a `GNDR 499` requirement matches `GNDS 499`).
export function prefixMatch(code, prefixes) {
  return courseInfo(code).prefixes.some(
    (p) => (PREFIX_ALIASES[p] || p) && prefixes.includes(PREFIX_ALIASES[p] || p),
  )
}

// Resolves a single requirement code to the concrete catalog code(s) that
// satisfy it. Handles prefix aliases (`GNDR 499` -> `GNDS 499`) and
// cross-listed slash codes (`ENG/COM 251` -> [`ENG 251`, `COM 251`]).
export function expandCode(code) {
  const m = CODE_RE.exec(code)
  if (!m) return [code]
  const number = m[2]
  const prefixes = m[1].split('/').map((p) => PREFIX_ALIASES[p] || p)
  const aliased = prefixes.length === 1 ? [`${prefixes[0]} ${number}`] : prefixes.map((p) => `${p} ${number}`)
  // Keep the original spelling too, so a pool keyed by `GNDS 499` matches the
  // aliased form and a pool that already contains `ENG/COM 251` still matches.
  return [...new Set([...aliased, code])]
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
      return constraint.codes ? constraint.codes.some((c) => expandCode(c).includes(code)) : true
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
      pool = intersection(pool, new Set(c.codes.flatMap(expandCode)))
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
      for (const code of c.codes.flatMap(expandCode)) pool.delete(code)
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
      (c.atLeast != null || c.atMost != null || c.distinctAtLeast != null || c.sameDiscipline === true)
    ) {
      if (c.sameDiscipline === true && codes.length) {
        // Every chosen course must share at least one common discipline prefix.
        const prefixSets = codes.map((code) => courseInfo(code).prefixes.map((p) => PREFIX_ALIASES[p] || p))
        let common = new Set(prefixSets[0])
        for (const ps of prefixSets.slice(1)) {
          common = new Set([...common].filter((p) => ps.includes(p)))
        }
        if (common.size === 0) return false
      }
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
      const expanded = c.codes.flatMap(expandCode)
      const at = codes.filter((code) => expanded.includes(code)).length
      if (at > c.atMost) return false
    } else if (c.type === 'min_from' && c.atLeast != null) {
      const expanded = c.codes.flatMap(expandCode)
      const at = codes.filter((code) => expanded.includes(code)).length
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
// `excluded` is an optional set of course codes that must not satisfy this item
// (used to stop one course counting toward two requirement nodes in the same
// track — e.g. a required course also filling the electives bucket).
export function satisfied(item, taken, catalog, excluded) {
  const takenSet = toSet(taken)
  const excludedSet = toSet(excluded)

  switch (item.type) {
    case 'course': {
      const matched = expandCode(item.code).filter((c) => takenSet.has(c))
      const hit = matched.length > 0
      return {
        status: hit ? 'satisfied' : 'unsatisfied',
        matched,
        missing: hit ? [] : [item.code],
        needed: hit ? 0 : 1,
        count: hit ? 1 : 0,
        min: 1,
        max: 1,
      }
    }

    case 'any_of': {
      const results = item.codes
        ? item.codes.map((code) => {
            const matched = expandCode(code).filter((c) => takenSet.has(c))
            return { status: matched.length ? 'satisfied' : 'unsatisfied', matched, missing: [code] }
          })
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
      const chosen = [...pool].filter((code) => takenSet.has(code) && !excludedSet.has(code))
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

// ---------------------------------------------------------------------------
// Per-track course assignment (no double counting)
// ---------------------------------------------------------------------------
// Within a track, each taken course may satisfy at most one requirement node.
// We solve this in two passes over the requirement's items:
//   1. A "rigid" pass assigns courses to required/choice nodes (course, any_of,
//      each_of, some_of). Electives are deferred placeholders that consume
//      nothing, so they never steal a course a rigid node needs.
//   2. An "electives" pass fills each electives bucket from whatever courses
//      the rigid pass left unused.
// Choice points (which any_of option, which some_of picks) are tried with
// backtracking; a failed branch releases its courses back to the pool.

function restorePool(pool, snapshot) {
  pool.clear()
  for (const c of snapshot) pool.add(c)
}

function rigidSatisfy(item, pool, catalog) {
  // Returns { ok, used: string[], plan }. Consumes from `pool` (mutating it).
  switch (item.type) {
    case 'course': {
      const matched = expandCode(item.code).find((c) => pool.has(c))
      if (matched) {
        pool.delete(matched)
        return { ok: true, used: [matched], plan: { type: 'course', code: matched, ok: true } }
      }
      return { ok: false, used: [], plan: { type: 'course', code: item.code, ok: false } }
    }
    case 'any_of': {
      if (item.codes) {
        for (const code of item.codes) {
          const matched = expandCode(code).find((c) => pool.has(c))
          if (matched) {
            pool.delete(matched)
            return { ok: true, used: [matched], plan: { type: 'choice', chosen: matched } }
          }
        }
        return { ok: false, used: [], plan: { type: 'choice' } }
      }
      const snapshot = new Set(pool)
      for (let i = 0; i < (item.items || []).length; i++) {
        const sub = rigidSatisfy(item.items[i], pool, catalog)
        if (sub.ok) {
          return { ok: true, used: sub.used, plan: { type: 'choice', chosenIndex: i, child: sub.plan } }
        }
        restorePool(pool, snapshot)
      }
      return { ok: false, used: [], plan: { type: 'choice' } }
    }
    case 'each_of':
    case 'pair': {
      const children = item.items || (item.codes || []).map((code) => ({ type: 'course', code }))
      const snapshot = new Set(pool)
      const used = []
      const plans = []
      for (const ch of children) {
        const sub = rigidSatisfy(ch, pool, catalog)
        if (!sub.ok) {
          restorePool(pool, snapshot)
          return { ok: false, used: [], plan: { type: 'all', children: plans } }
        }
        used.push(...sub.used)
        plans.push(sub.plan)
      }
      return { ok: true, used, plan: { type: 'all', children: plans } }
    }
    case 'some_of': {
      const min = item.min ?? 1
      const children = item.items || []
      const snapshot = new Set(pool)
      const used = []
      const plans = []
      let okCount = 0
      for (const ch of children) {
        const before = new Set(pool)
        const sub = rigidSatisfy(ch, pool, catalog)
        if (sub.ok) {
          okCount++
          used.push(...sub.used)
          plans.push(sub.plan)
        } else {
          restorePool(pool, before)
        }
        if (okCount >= min) break
      }
      if (okCount >= min) return { ok: true, used, plan: { type: 'pick', min, children: plans } }
      restorePool(pool, snapshot)
      return { ok: false, used: [], plan: { type: 'pick', min, children: plans } }
    }
    case 'electives': {
      // Deferred placeholder — consumes nothing; filled by the electives pass.
      return { ok: true, used: [], plan: { type: 'electives', item, filled: [], aggOk: true } }
    }
    default:
      return { ok: false, used: [], plan: { type: 'other' } }
  }
}

function fillElectives(plan, pool, catalog) {
  if (plan.type === 'electives') {
    const item = plan.item
    const count = item.count || 0
    const constraints = item.constraints || []
    const poolSet = filteredUniverse(constraints, catalog)
    const eligible = [...pool]
      .filter((code) => poolSet.has(code))
      .sort((a, b) => electivesWeight(b, constraints) - electivesWeight(a, constraints) || a.localeCompare(b))
    const filled = eligible.slice(0, count)
    for (const c of filled) pool.delete(c)
    plan.filled = filled
    plan.aggOk = checkAggregates(filled, constraints)
    return
  }
  if (plan.type === 'choice' && plan.chosenIndex != null) fillElectives(plan.child, pool, catalog)
  else if (plan.type === 'all' || plan.type === 'pick') {
    for (const ch of plan.children) fillElectives(ch, pool, catalog)
  }
}

function nodeSatisfied(plan) {
  switch (plan.type) {
    case 'course':
      return plan.ok === true
    case 'choice':
      return (
        plan.ok !== false && (plan.chosen != null || (plan.chosenIndex != null && nodeSatisfied(plan.child)))
      )
    case 'all':
      return plan.children.length > 0 && plan.children.every(nodeSatisfied)
    case 'pick':
      return plan.children.filter(nodeSatisfied).length >= (plan.min || 1)
    case 'electives':
      return plan.filled.length >= (plan.item.count || 0) && plan.aggOk
    default:
      return false
  }
}

function nodeMatched(plan) {
  switch (plan.type) {
    case 'course':
      return plan.ok === true ? [plan.code] : []
    case 'choice':
      if (plan.chosen != null) return [plan.chosen]
      if (plan.chosenIndex != null && plan.child) return nodeMatched(plan.child)
      return []
    case 'all':
    case 'pick':
      return (plan.children || []).flatMap(nodeMatched)
    case 'electives':
      return plan.filled
    default:
      return []
  }
}

function planResult(item, plan) {
  const unknown = item.type === 'custom' || item.type === 'level_gate'
  const satisfied = nodeSatisfied(plan)
  if (unknown) {
    return { status: 'unknown', matched: [], missing: [], needed: 0, count: 0, min: 0, max: 0 }
  }
  const matched = nodeMatched(plan)
  const count =
    item.type === 'electives'
      ? plan.filled.length
      : plan.type === 'all' || plan.type === 'pick'
        ? plan.children.filter(nodeSatisfied).length
        : satisfied
          ? 1
          : 0
  const min =
    item.type === 'electives'
      ? item.count || 0
      : plan.type === 'pick'
        ? plan.min || 1
        : plan.type === 'all'
          ? item.items || (item.codes || []).map(() => ({})).length
          : 1
  const max =
    item.type === 'electives'
      ? item.count || 0
      : plan.type === 'pick'
        ? (item.items || []).length
        : plan.type === 'all'
          ? item.items || (item.codes || []).map(() => ({})).length
          : 1
  const missing =
    item.type === 'course'
      ? satisfied
        ? []
        : [item.code]
      : item.type === 'any_of' && item.codes
        ? satisfied
          ? []
          : item.codes
        : item.type === 'electives'
          ? []
          : (plan.children || []).flatMap((c) => (nodeSatisfied(c) ? [] : missingCodes(c)))
  return {
    status: satisfied ? 'satisfied' : 'unsatisfied',
    matched,
    missing,
    needed: count >= min ? 0 : min - count,
    count,
    min,
    max,
  }
}

function missingCodes(plan) {
  if (plan.type === 'course' && plan.ok === false) return [plan.code]
  if (plan.type === 'choice' && plan.ok === false) return []
  if (plan.type === 'electives') return []
  return (plan.children || []).flatMap(missingCodes)
}

// Assigns taken courses to a requirement's items, returning the assignment in
// section order: `{ sectionIndex, item, ok, used: Set }`.
export function assignRequirement(requirement, taken, catalog) {
  const pool = new Set(toSet(taken))
  const sections = (requirement && requirement.sections) || []
  const entries = []
  for (const s of sections) {
    for (const it of s.items || []) {
      const r = rigidSatisfy(it, pool, catalog)
      entries.push({
        sectionIndex: sections.indexOf(s),
        item: it,
        ok: r.ok,
        plan: r.plan,
        used: new Set(r.used),
      })
    }
  }
  // Fill electives buckets from whatever the rigid pass left unused.
  for (const e of entries) {
    if (e.ok) fillElectives(e.plan, pool, catalog)
  }
  // Electives' used set is their filled courses (the rigid pass deferred them).
  for (const e of entries) {
    if (e.plan.type === 'electives') e.used = new Set(e.plan.filled)
  }
  return entries
}

// Evaluates every section/item of a single requirement, assigning each taken
// course to at most one requirement node within the track.
export function evaluateRequirement(requirement, taken, catalog) {
  const entries = assignRequirement(requirement, taken, catalog)
  const sections = (requirement && requirement.sections) || []
  const perSection = sections.map((s, si) => ({
    heading: s.heading,
    items: entries.filter((e) => e.sectionIndex === si).map((e) => planResult(e.item, e.plan)),
  }))
  return { label: requirement.label, sections: perSection }
}

// Courses reserved by a requirement's non-electives nodes (for callers that
// want the "used by required/choice nodes" subset specifically).
export function claimedCourses(requirement, taken, catalog) {
  const claimed = new Set()
  for (const s of (requirement && requirement.sections) || []) {
    for (const it of s.items || []) {
      if (it.type === 'electives') continue
      for (const c of satisfied(it, taken, catalog).matched || []) claimed.add(c)
    }
  }
  return claimed
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
      return { need: 1, courses: expandCode(item.code) }
    case 'any_of':
      if (item.codes) return { need: 1, courses: item.codes.flatMap(expandCode) }
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

// ---------------------------------------------------------------------------
// Human-readable still-need ("gap") groups
// ---------------------------------------------------------------------------
//
// `gapGroups` turns the missing pieces of a requirement into labeled groups a
// student can act on, e.g.:
//   - `{ label: 'Choose one of', codes: ['CS 340', 'CS 345'] }` (an any_of; the
//     alternatives are presented once as a choice, not each as individually
//     "needed")
//   - `{ label: '2 more courses — CS courses · 200-level or above …', codes: [...] }`
//     (an electives shortfall; the label describes *what kind* of course is
//     missing, and the codes are recommendations)
//   - `{ note: '…' }` (unstructured requirement or a failed aggregate).
// Each returned group is `{ label?, codes?: string[], note?: string }`.

export function describeConstraints(constraints) {
  const parts = []
  for (const c of constraints || []) {
    if (c.type === 'discipline' && c.sameDiscipline) {
      parts.push('in the same discipline')
    } else if (c.type === 'discipline' && c.prefixes && c.prefixes.length) {
      parts.push(`${c.prefixes.join('/')} courses`)
    } else if (c.type === 'level') {
      if (c.level != null) {
        if (c.atLeast != null) parts.push(`at least ${c.atLeast} at ${c.level}-level${c.orAbove ? '+' : ''}`)
        else if (c.atMost != null) parts.push(`no more than ${c.atMost} at ${c.level}-level`)
        else parts.push(`${c.level}-level${c.orAbove ? ' or above' : ''}`)
      } else if (c.min != null && c.max != null) {
        parts.push(`${c.min}–${c.max} level`)
      }
    } else if (c.type === 'from' && c.codes && c.codes.length) {
      parts.push(`from: ${c.codes.join(', ')}`)
    } else if (c.type === 'exclude' && c.codes) {
      parts.push(`excluding ${c.codes.join(', ')}`)
    } else if (c.type === 'min_from' && c.codes) {
      parts.push(`at least ${c.atLeast ?? 1} of ${c.codes.join(', ')}`)
    } else if (c.type === 'max_from' && c.codes) {
      parts.push(`at most ${c.atMost ?? 1} of ${c.codes.join(', ')}`)
    }
  }
  return parts.join(' · ')
}

export function gapGroups(item, taken, catalog, excluded) {
  excluded = excluded || new Set()
  const result = satisfied(item, taken, catalog, excluded)
  if (result.status === 'satisfied') return []
  if (result.status === 'unknown') {
    return [{ note: 'Includes an unstructured requirement — check the catalog text for this part.' }]
  }

  switch (item.type) {
    case 'course':
      return [{ codes: [item.code] }]
    case 'any_of': {
      if (item.codes) {
        const open = item.codes.filter((c) => !taken.has(c))
        return open.length ? [{ label: 'Choose one of', codes: open }] : []
      }
      // any_of with nested items: each item is one alternative. Present the
      // still-open alternatives as a single choice, each option preserving its
      // internal structure as ordered slots (e.g. a science pair is two course
      // slots joined by '+'; "one from X or Y, plus KIP 215" is a choice slot
      // followed by a course slot) instead of flattening everything together.
      const alternatives = []
      for (const alt of item.items || []) {
        if (satisfied(alt, taken, catalog).status === 'satisfied') continue
        const sub = gapGroups(alt, taken, catalog, excluded)
        const slots = sub.map((g) =>
          g.label ? { label: g.label, codes: g.codes || [] } : { codes: g.codes || [] },
        )
        if (!slots.length || slots.some((s) => !s.codes.length)) {
          alternatives.push({ slots: [{ codes: planGaps(alt, taken, catalog).courses }] })
        } else {
          alternatives.push({ slots })
        }
      }
      if (!alternatives.length) return []
      // Flat form when every alternative is a single required course.
      if (
        alternatives.every((a) => a.slots.length === 1 && !a.slots[0].label && a.slots[0].codes.length === 1)
      ) {
        return [{ label: item.note || 'Choose one of', codes: alternatives.flatMap((a) => a.slots[0].codes) }]
      }
      return [{ label: item.note || 'Choose one of the following', alternatives }]
    }
    case 'each_of':
    case 'pair': {
      const items = item.items || (item.codes || []).map((code) => ({ type: 'course', code }))
      return items.flatMap((it) => gapGroups(it, taken, catalog, excluded))
    }
    case 'some_of': {
      const min = item.min ?? 1
      const children = item.items || []
      const satisfiedCount = children.filter(
        (c) => satisfied(c, taken, catalog).status === 'satisfied',
      ).length
      const need = Math.max(0, min - satisfiedCount)
      if (need === 0) return []
      const candidates = []
      for (const ch of children) {
        if (satisfied(ch, taken, catalog).status === 'satisfied') continue
        for (const g of gapGroups(ch, taken, catalog, excluded)) {
          for (const code of g.codes || []) candidates.push(code)
        }
      }
      return [{ label: `Pick ${need} of`, codes: candidates.slice(0, need) }]
    }
    case 'electives': {
      const constraints = item.constraints || []
      // Every eligible course not yet taken, alphabetically, for browsing.
      const options = [...result.missing].filter((c) => !excluded.has(c)).sort((a, b) => a.localeCompare(b))
      if (result.count < (item.count || 0)) {
        const need = (item.count || 0) - result.count
        const scope = describeConstraints(constraints) || 'eligible courses'
        return [{ label: `Need ${need} more ${scope}`, codes: options, expandable: true }]
      }
      const aggText = describeConstraints((constraints || []).filter((c) => hasCount(c)))
      return [
        {
          label: aggText ? `Still need: ${aggText}` : 'Still need a category rule',
          codes: options,
          expandable: true,
        },
      ]
    }
    default:
      return [{ note: 'Unstructured requirement — check the catalog text for this part.' }]
  }
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
