// Pure, testable requirements evaluator.
//
// Data is passed in as arguments (never imported from the Vue store) so this
// module can be exercised under `node --test` with hand-built fixtures.
//
// Semantics:
// - Within a single requirement (track), a course satisfies at most one node:
//   courses claimed by required/choice nodes are excluded from the track's
//   electives buckets. Across tracks, a course may count for each track
//   independently (naive global membership).
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
//
// How to read this file (in order):
//   1. "Code helpers" — how course codes are parsed/matched (`courseInfo`,
//      `expandCode`, `prefixMatch`). The join-key layer.
//   2. "Filters & aggregates" — `passes`, `filteredUniverse`, `checkAggregates`:
//      which courses an electives bucket can draw from, and whether chosen
//      courses satisfy count rules. Filters scope; aggregates verify.
//   3. "Recursive evaluation" — `satisfied`: one item against the taken set.
//      The status vocabulary (`satisfied`/`unsatisfied`/`unknown`) comes from here.
//   4. "Per-track course assignment" — `assignRequirement` (the hard part): a
//      two-pass backtracking solver so each course satisfies at most one node
//      per track. Read `rigidOptions` → `assignItems` → `fillElectives`.
//   5. "Planning / audit helpers" — `planGaps`/`gapGroups` (what to take next)
//      and `audit` (status rollup for the UI).
// The exported entry points for consumers are `satisfied`, `evaluateRequirement`,
// `evaluateProgram`, `assignRequirement`, `planGaps`, `gapGroups`, and `audit`.

const CODE_RE = /^([A-Z/]+)\s+(\S+)$/

// Prefix spellings that appear in requirement/prerequisite text but not in the
// catalog. `GNDR` is a variant of `GNDS` in the gender-studies requirement
// text; `CHEM`/`MATH`/`BSP` are department spellings found in prerequisite text.
const PREFIX_ALIASES = { GNDR: 'GNDS', CHEM: 'CHE', MATH: 'MAT', BSP: 'BUSN' }

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
// satisfy it. Handles prefix aliases (`GNDR 499` -> `GNDS 499`), cross-listed
// slash codes (`ENG/COM 251` -> [`ENG 251`, `COM 251`]), and number ranges
// (`ENV 408-409` -> [`ENV 408`, `ENV 409`]).
export function expandCode(code) {
  const m = CODE_RE.exec(code)
  if (!m) return [code]
  const prefixes = m[1].split('/').map((p) => PREFIX_ALIASES[p] || p)
  const range = /^(\d{3})-(\d{3})$/.exec(m[2])
  const numbers = range ? rangeNumbers(range[1], range[2]) : [m[2]]
  const expanded = []
  for (const prefix of prefixes) {
    for (const number of numbers) {
      expanded.push(`${prefix} ${number}`)
    }
  }
  // Keep the original spelling too, so a pool keyed by `GNDS 499` matches the
  // aliased form and a pool that already contains `ENG/COM 251` still matches.
  return [...new Set([...expanded, code])]
}

// Numbers in an inclusive course-number range (e.g. 408-409 -> [408, 409]).
function rangeNumbers(from, to) {
  const out = []
  const a = Number(from)
  const b = Number(to)
  for (let n = a; n <= b; n++) out.push(String(n).padStart(3, '0'))
  return out
}

// True when `code` is satisfied by the `taken` set, ignoring any code that's
// been `excluded` (already claimed by another node in the track). Cross-listed/
// aliased codes (ENG/COM 251, GNDR 499) are satisfied by any one of their
// concrete spellings, but a number range (ENV 408-409) is a multi-part sequence
// that requires every course in the range to be taken.
function codeSatisfied(code, takenSet, excludedSet) {
  if (/\d{3}-\d{3}$/.test(code)) {
    const parts = expandCode(code).filter((c) => c !== code && !excludedSet.has(c))
    return parts.length > 0 && parts.every((c) => takenSet.has(c))
  }
  return expandCode(code).some((c) => takenSet.has(c) && !excludedSet.has(c))
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
      // A course counts toward a level aggregate if it's in the band: either a
      // fixed band (`level` 300 = 300-399, widened by `orAbove`) or a range
      // band (`min`/`max`, e.g. "GEO 16x").
      const inBand = (code) => {
        const number = courseInfo(code).number
        if (number == null) return false
        if (c.min != null && c.max != null) return number >= c.min && number <= c.max
        if (c.orAbove) return number >= c.level
        return number >= c.level && number < c.level + 100
      }
      const at = codes.filter(inBand).length
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
      const matched = expandCode(item.code).filter((c) => takenSet.has(c) && !excludedSet.has(c))
      const hit = codeSatisfied(item.code, takenSet, excludedSet)
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
            const matched = expandCode(code).filter((c) => takenSet.has(c) && !excludedSet.has(c))
            const ok = codeSatisfied(code, takenSet, excludedSet)
            return { status: ok ? 'satisfied' : 'unsatisfied', matched, missing: [code] }
          })
        : (item.items || []).map((it) => satisfied(it, taken, catalog, excluded))
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
      const results = (item.items || []).map((it) => satisfied(it, taken, catalog, excluded))
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
      const results = (item.items || []).map((it) => satisfied(it, taken, catalog, excluded))
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
      const missingPool = [...pool].filter((code) => !takenSet.has(code))
      const { found, selected } = findValidSelection(chosen, item.count || 0, constraints)
      // `matched`/`count` report the taken courses that can still coexist in a
      // valid selection under the bucket's diversity rules, so a second
      // same-discipline course never reads as a second slot of progress (two CS
      // courses can't fill "3 distinct disciplines"). A course outside an
      // abundance rule (level/prefix/lab floors) still counts toward the base;
      // that shortfall surfaces as a "still need" note instead.
      return {
        status: found ? 'satisfied' : 'unsatisfied',
        matched: selected,
        missing: found ? [] : missingPool,
        needed: found ? 0 : Math.max(0, (item.count || 0) - selected.length),
        count: selected.length,
        min: item.count || 0,
        max: item.count || 0,
      }
    }

    case 'pair': {
      // Retired legacy type; treat as `each_of` (every alternative required).
      const items = item.items || (item.codes || []).map((code) => ({ type: 'course', code }))
      return satisfied({ type: 'each_of', items }, taken, catalog, excluded)
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

// All the distinct ways to satisfy `item` against `pool`, as candidate
// `{ ok, used, plan }` results. `pool` is never mutated here; the backtracking
// caller applies a chosen candidate's `used` itself. Returning every option
// lets a later sibling node re-choose an earlier one instead of being stuck
// with a greedy first-fit.
function rigidOptions(item, pool, catalog) {
  switch (item.type) {
    case 'course': {
      if (/\d{3}-\d{3}$/.test(item.code)) {
        const parts = expandCode(item.code).filter((c) => c !== item.code)
        if (parts.length && parts.every((c) => pool.has(c))) {
          return [{ ok: true, used: parts, plan: { type: 'course', code: item.code, ok: true } }]
        }
        return []
      }
      const matched = expandCode(item.code).find((c) => pool.has(c))
      return matched ? [{ ok: true, used: [matched], plan: { type: 'course', code: matched, ok: true } }] : []
    }
    case 'any_of': {
      if (item.codes) {
        const options = []
        for (const code of item.codes) {
          const parts = /\d{3}-\d{3}$/.test(code)
            ? expandCode(code).filter((c) => c !== code)
            : [expandCode(code).find((c) => pool.has(c))].filter(Boolean)
          if (parts.length && parts.every((c) => pool.has(c))) {
            options.push({ ok: true, used: parts, plan: { type: 'choice', chosen: parts } })
          }
        }
        return options
      }
      const options = []
      for (let i = 0; i < (item.items || []).length; i++) {
        const sub = rigidOptions(item.items[i], pool, catalog)
        for (const s of sub) {
          options.push({ ok: true, used: s.used, plan: { type: 'choice', chosenIndex: i, child: s.plan } })
        }
      }
      return options
    }
    case 'each_of':
    case 'pair': {
      const children = item.items || (item.codes || []).map((code) => ({ type: 'course', code }))
      // All children must be satisfied; combine their choices into one plan.
      const snapshot = new Set(pool)
      const assigned = assignItems(children, pool, catalog)
      restorePool(pool, snapshot)
      return assigned.ok
        ? [{ ok: true, used: assigned.used, plan: { type: 'all', children: assigned.plans } }]
        : []
    }
    case 'some_of': {
      const min = item.min ?? 1
      const children = item.items || []
      const options = []
      // Every subset of children of size >= min, as its own candidate, so the
      // solver can prefer whichever subset doesn't steal a course a later node
      // needs.
      const indexes = children.map((_, i) => i)
      for (const combo of combinations(indexes, min)) {
        const snapshot = new Set(pool)
        const chosen = combo.map((i) => children[i])
        const assigned = assignItems(chosen, pool, catalog)
        if (assigned.ok) {
          options.push({
            ok: true,
            used: assigned.used,
            plan: { type: 'pick', min, children: assigned.plans },
          })
        }
        restorePool(pool, snapshot)
      }
      return options
    }
    case 'electives': {
      // Deferred placeholder — consumes nothing; filled by the electives pass.
      return [{ ok: true, used: [], plan: { type: 'electives', item, filled: [], aggOk: true } }]
    }
    default:
      return []
  }
}

// Cartesian product of `choose`-size subsets of `items` (as arrays of values).
function combinations(items, choose) {
  if (choose <= 0) return [[]]
  if (items.length < choose) return []
  const out = []
  const rec = (start, acc) => {
    if (acc.length === choose) {
      out.push(acc.slice())
      return
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i])
      rec(i + 1, acc)
      acc.pop()
    }
  }
  rec(0, [])
  return out
}

// Backtracking assignment of `items` against a shared `pool` (mutating it):
// each item tries its candidates in order, and a failure anywhere restores the
// pool and tries the next candidate, so no course is permanently taken by an
// earlier node that a later one needs. Returns `{ ok, used, plans }`.
function assignItems(items, pool, catalog) {
  const result = { ok: true, used: [], plans: [] }
  function solve(index, used, plans) {
    if (index >= items.length) {
      result.used = used
      result.plans = plans
      return true
    }
    const item = items[index]
    const snapshot = new Set(pool)
    for (const cand of rigidOptions(item, pool, catalog)) {
      for (const c of cand.used) pool.delete(c)
      if (solve(index + 1, [...used, ...cand.used], [...plans, cand.plan])) {
        return true
      }
      restorePool(pool, snapshot)
    }
    restorePool(pool, snapshot)
    return false
  }
  const ok = solve(0, [], [])
  if (ok) return result
  // The backtracking solve found no single assignment satisfying every rigid
  // node (e.g. an any_of whose alternatives are all untaken). Fall back to a
  // per-item greedy plan so every item still gets a well-formed plan (and its
  // electives buckets still fill) instead of every item collapsing to a generic
  // `{ type: 'other' }` that crashes `planResult` on the electives branch.
  const plans = items.map((item) => {
    const options = rigidOptions(item, pool, catalog)
    return options.length ? options[0].plan : failedPlan(item)
  })
  return { ok: false, used: [], plans }
}

// A well-formed (always-unsatisfied) plan for a rigid item that couldn't be
// satisfied, so `planResult` can still render its status/missing without
// crashing on the electives branch.
function failedPlan(item) {
  switch (item.type) {
    case 'course':
      return { type: 'course', code: item.code, ok: false }
    case 'any_of':
      return { type: 'choice' }
    case 'each_of':
    case 'pair':
      return { type: 'all', children: [] }
    case 'some_of':
      return { type: 'pick', min: item.min ?? 1, children: [] }
    default:
      return { type: 'other' }
  }
}

// True when a constraint is a count rule that `checkAggregates` actually
// verifies over the chosen set (as opposed to a scope filter like `from`).
function isAggregate(c) {
  return (
    ((c.type === 'discipline' || c.type === 'level') &&
      (c.atLeast != null || c.atMost != null || c.distinctAtLeast != null || c.sameDiscipline === true)) ||
    c.type === 'min_from' ||
    c.type === 'max_from'
  )
}

// Finds a subset of `available` of size `count` that passes every count rule in
// `constraints` (`checkAggregates`). Returns `{ found, selected }`:
// - `found: true`  -> `selected` is a valid subset (favors higher-weight courses).
// - `found: false`, `available.length < count` -> `selected` = everything taken
//   so far, so a partially-filled bucket still reports progress.
// - `found: false`, enough courses but no full valid subset -> `selected` = the
//   largest aggregate-valid subset found, so a bucket that can't be completed
//   still surfaces the courses that genuinely count (a same-language pair reads
//   "1/2"); if even singletons pass no rule it stays empty rather than ever
//   claiming a selection the bucket can't legally make (surface as "2/2").
//
// Search is depth-first over candidates ordered by `electivesWeight`. Candidate
// sets are small (only taken-but-unclaimed courses), and an aggregate-free
// bucket short-circuits; a node budget guards the pathological case.
//
// When no exact-count valid selection exists, `selected` is the largest subset
// of the available courses that can still count as progress. Only the *diversity*
// rules cap this: `distinctAtLeast` (distinct disciplines) and `sameDiscipline`
// keep courses out of every valid selection (a second CS course can never be
// part of a 3-distinct-discipline set), so they cap progress per discipline.
// Abundance aggregates (level/prefix floors, min_from/max_from) do not cap
// progress — a course outside a band still counts toward the base count, and the
// remaining shortfall surfaces as a "still need" note instead.
function findValidSelection(available, count, constraints) {
  const ordered = [...available].sort(
    (a, b) => electivesWeight(b, constraints) - electivesWeight(a, constraints) || a.localeCompare(b),
  )
  if (count <= 0) return { found: true, selected: [] }
  if (!constraints.some(isAggregate)) {
    return { found: ordered.length >= count, selected: ordered.slice(0, count) }
  }
  if (ordered.length >= count) {
    const nodeLimit = 200000
    let nodes = 0
    const result = []
    function search(start, chosen) {
      if (nodes++ > nodeLimit) return false
      if (chosen.length === count) {
        if (checkAggregates(chosen, constraints)) {
          result.push(...chosen)
          return true
        }
        return false
      }
      const remaining = count - chosen.length
      for (let i = start; i <= ordered.length - remaining; i++) {
        chosen.push(ordered[i])
        if (search(i + 1, chosen)) return true
        chosen.pop()
      }
      return false
    }
    if (search(0, [])) return { found: true, selected: result }
  }
  return { found: false, selected: diversityCap(ordered, count, constraints) }
}

// The largest subset of `ordered` (preference order preserved) that can coexist
// under the bucket's diversity rules, capped at `count`. `distinctAtLeast`
// allows at most `count - distinct + 1` courses from any one discipline;
// `sameDiscipline` keeps only the discipline with the most courses.
function diversityCap(ordered, count, constraints) {
  const div = (constraints || []).filter(
    (c) => c.type === 'discipline' && (c.distinctAtLeast != null || c.sameDiscipline === true),
  )
  if (!div.length) return ordered.slice(0, count)
  if (div.some((c) => c.sameDiscipline === true)) {
    // All courses must share one discipline: the largest same-discipline block.
    const byPrefix = new Map()
    for (const code of ordered) {
      for (const p of courseInfo(code).prefixes) {
        if (!byPrefix.has(p)) byPrefix.set(p, [])
        byPrefix.get(p).push(code)
      }
    }
    let best = []
    for (const list of byPrefix.values()) if (list.length > best.length) best = list
    return best.slice(0, count)
  }
  const d = Math.max(...div.map((c) => c.distinctAtLeast || 0))
  const cap = Math.max(1, count - d + 1)
  const perPrefixCount = {}
  const kept = []
  for (const code of ordered) {
    if (kept.length >= count) break
    const underCap = courseInfo(code).prefixes.some((p) => (perPrefixCount[p] || 0) < cap)
    if (underCap) {
      kept.push(code)
      for (const p of courseInfo(code).prefixes) perPrefixCount[p] = (perPrefixCount[p] || 0) + 1
    }
  }
  return kept
}

// Untaken pool courses that can actually move an unsatisfied electives bucket
// toward completion, given the courses already placed. A candidate counts as
// helpful when it can be part of a valid selection reachable with the placed
// set: when the student is still filling slots the placed courses stay
// committed (so a German course next to a placed French one is never offered),
// and when they already have a surplus of eligible courses it must be countable
// in some valid selection (so another MAT/CS course can't help a bucket that
// needs a third distinct discipline).
function electedSubsetWith(committed, c, count, constraints) {
  // A valid size-`count` subset of `committed` that includes `c` (surplus case).
  const rest = committed.filter((x) => x !== c)
  if (rest.length < count - 1) return false
  if (rest.length > 12) return true // too many to enumerate; don't over-filter
  let ok = false
  function pick(start, chosen) {
    if (ok) return
    if (chosen.length === count - 1) {
      if (checkAggregates([...chosen, c], constraints)) ok = true
      return
    }
    const remaining = count - 1 - chosen.length
    for (let i = start; i <= rest.length - remaining && !ok; i++) {
      chosen.push(rest[i])
      pick(i + 1, chosen)
      chosen.pop()
    }
  }
  pick(0, [])
  return ok
}

function validCompletion(committed, universe, count, constraints) {
  // Does a valid selection of exactly `count` courses exist that includes every
  // committed course, drawing the remainder from `universe`? DFS with budget.
  if (committed.length > count) return false
  const wanted = count - committed.length
  if (wanted === 0) return checkAggregates(committed, constraints)
  const extra = universe.filter((c) => !committed.includes(c))
  if (extra.length < wanted) return false
  const nodeLimit = 50000
  let nodes = 0
  let ok = false
  function search(start, pool) {
    if (ok || nodes++ > nodeLimit) return
    if (pool.length === wanted) {
      if (checkAggregates([...committed, ...pool], constraints)) ok = true
      return
    }
    const remaining = wanted - pool.length
    for (let i = start; i <= extra.length - remaining && !ok; i++) {
      pool.push(extra[i])
      search(i + 1, pool)
      pool.pop()
    }
  }
  search(0, [])
  return ok
}

function electiveOptions(item, taken, catalog, excluded) {
  const forbidden = excluded || new Set()
  const constraints = item.constraints || []
  const count = item.count || 0
  const takenSet = toSet(taken)
  const universe = filteredUniverse(constraints, catalog)
  const universeList = [...universe].sort((a, b) => a.localeCompare(b))
  const placed = diversityCap(
    universeList.filter((c) => takenSet.has(c) && !forbidden.has(c)),
    count,
    constraints,
  )
  const helpful = []
  for (const c of universeList) {
    if (takenSet.has(c) || forbidden.has(c)) continue
    const committed = [...placed, c]
    if (committed.length > count) {
      if (electedSubsetWith(committed, c, count, constraints)) helpful.push(c)
    } else if (validCompletion(committed, universeList, count, constraints)) {
      helpful.push(c)
    }
  }
  return helpful
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
    const { found, selected } = findValidSelection(eligible, count, constraints)
    plan.filled = selected
    plan.aggOk = found
    // Only consume from the pool when the bucket is actually satisfied; a bucket
    // that can't reach its count or fails its aggregate must not hoard courses a
    // later bucket needs.
    if (found) {
      for (const c of selected) pool.delete(c)
    }
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
      if (plan.chosen != null) return Array.isArray(plan.chosen) ? plan.chosen : [plan.chosen]
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
//
// By default the sections of a requirement share one pool, so a course counts
// toward at most one node in the track. When `requirement.independentSections`
// is true (the core curriculum), each section is instead evaluated against the
// full taken set — a single course may legitimately satisfy several areas (e.g.
// `ENG 172` is both LA and W1).
export function assignRequirement(requirement, taken, catalog) {
  const sections = (requirement && requirement.sections) || []
  const independent = requirement && requirement.independentSections === true
  const shared = new Set(toSet(taken))
  const entries = []
  for (let si = 0; si < sections.length; si++) {
    const s = sections[si]
    const pool = independent ? new Set(toSet(taken)) : shared
    // Backtracking assignment over this section's items sharing `pool`, so a
    // course is never permanently taken by an earlier node that a later one
    // needs (e.g. a some_of that greedily grabs a course a sibling requires).
    const assigned = assignItems(s.items || [], pool, catalog)
    ;(s.items || []).forEach((it, i) => {
      const plan = assigned.plans[i] || { type: 'other' }
      // Electives placeholders are always "ok" — they consume nothing during the
      // rigid pass and their real satisfaction is decided by fillElectives — even
      // when a sibling rigid node is unsatisfiable (assigned.ok false), so a
      // track with an untaken required course still reports its electives
      // progress instead of showing 0/5.
      const ok = plan.type === 'electives' ? true : assigned.ok && nodeSatisfied(plan)
      entries.push({
        sectionIndex: si,
        item: it,
        ok,
        plan,
        used: new Set(assigned.ok ? nodeMatched(plan) : []),
        pool,
      })
    })
  }
  // Fill electives buckets from whatever the rigid pass left unused.
  for (const e of entries) {
    if (e.ok) fillElectives(e.plan, e.pool, catalog)
  }
  // An electives bucket's used set is its filled courses, but only when the
  // bucket actually claimed them from the pool (reaching its count and passing
  // its aggregate). An underfilled bucket leaves its candidates available, so
  // it must not mark them as used — otherwise a later bucket's "still need"
  // suggestions would exclude a course it can still take.
  for (const e of entries) {
    if (e.plan.type === 'electives') {
      e.used = new Set(nodeSatisfied(e.plan) ? e.plan.filled : [])
    }
  }
  return entries
}

// Evaluates every section/item of a single requirement, assigning each taken
// course to at most one requirement node within the track.
export function evaluateRequirement(requirement, taken, catalog) {
  const entries = assignRequirement(requirement, taken, catalog)
  const sections = (requirement && requirement.sections) || []
  const takenSet = toSet(taken)
  const perSection = sections.map((s, si) => ({
    heading: s.heading,
    items: entries
      .filter((e) => e.sectionIndex === si)
      .map((e) => {
        const res = planResult(e.item, e.plan)
        if (e.item.type === 'electives') {
          // All placed courses that pool into this bucket, so the UI can show
          // matched (`matched`) and placed-but-unmatched (`pool` minus matched)
          // courses side by side instead of hiding a partially-started bucket.
          const universe = filteredUniverse(e.item.constraints || [], catalog)
          res.pool = [...universe].filter((c) => takenSet.has(c)).sort()
        }
        return res
      }),
  }))
  return { label: requirement.label, sections: perSection }
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
      const constraints = item.constraints || []
      // Only courses that can still help with the placed set are recommended;
      // a discipline-conflicted or aggregate-useless course is never offered.
      const options = electiveOptions(item, taken, catalog)
        .sort(
          (a, b) => electivesWeight(b, constraints) - electivesWeight(a, constraints) || a.localeCompare(b),
        )
        .slice(0, result.needed || Infinity)
      if (result.count < (item.count || 0)) {
        return { need: result.needed, courses: options }
      }
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

export function describeConstraints(constraints, compact) {
  const parts = []
  for (const c of constraints || []) {
    if (c.type === 'discipline' && c.sameDiscipline) {
      parts.push('in the same discipline')
    } else if (c.type === 'discipline' && c.distinctAtLeast != null) {
      parts.push(`at least ${c.distinctAtLeast} distinct disciplines`)
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
      if (compact) parts.push(`at least ${c.atLeast ?? 1} from a listed set (${c.codes.length} options)`)
      else parts.push(`at least ${c.atLeast ?? 1} of ${c.codes.join(', ')}`)
    } else if (c.type === 'max_from' && c.codes) {
      if (compact) parts.push(`at most ${c.atMost ?? 1} from a listed set (${c.codes.length} options)`)
      else parts.push(`at most ${c.atMost ?? 1} of ${c.codes.join(', ')}`)
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
      // Only courses compatible with the placed set are offered; discipline
      // conflicts and courses that can't close an unmet aggregate are omitted.
      const options = electiveOptions(item, taken, catalog, excluded).sort((a, b) => a.localeCompare(b))
      if (result.count < (item.count || 0)) {
        const need = (item.count || 0) - result.count
        const scope = item.label
          ? `from ${item.label}`
          : describeConstraints(constraints.filter((c) => c.type !== 'from')) || 'eligible courses'
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

// ---------------------------------------------------------------------------
// Course prerequisites
// ---------------------------------------------------------------------------

// Course records carry `prerequisites` as raw catalog strings, e.g. "220",
// "MAT 113", "ANTH 162 or a sociology gateway course", "CHEM 161 and one of
// BIO 185 or KIP 161", "a 100-level Political Science course (except PLS 160)
// or INS 161", or "permission of instructor". `prereqGroups` normalizes those
// into checkable code groups the planner can highlight against, and
// `prereqStatus` judges whether a placed course's prerequisites are present and
// (when the plan has timing) scheduled earlier.

// The catalog's discipline prefixes — the only spellings we trust as course
// codes in prerequisite prose.
const KNOWN_PREFIXES = new Set([
  'ANTH',
  'ARTD',
  'ARTH',
  'AST',
  'BCH',
  'BIO',
  'BUSN',
  'CHE',
  'CLA',
  'COM',
  'CS',
  'DSCI',
  'ECO',
  'EDU',
  'ENG',
  'ENGR',
  'ENV',
  'FRE',
  'GEO',
  'GER',
  'GNDS',
  'GRE',
  'HIS',
  'HMS',
  'ID',
  'INS',
  'KIP',
  'LAT',
  'MAT',
  'ML',
  'MRS',
  'MUS',
  'NUR',
  'PHI',
  'PHY',
  'PLS',
  'PSY',
  'SMGT',
  'SOC',
  'SPA',
  'THR',
  'THS',
])

const PREREQ_CODE_RE = /[A-Za-z]{2,4}\s+\d{3}\b/g
const BARE_NUMBER_RE = /\b\d{3}\b/g
const EXCEPT_RE = /\bexcept\b[^;,.()]*/gi
// The word immediately around a bare number that marks a course-number *band*
// ("a 100-level course", "218 or above") rather than a specific course code.
const NOISE_AROUND_RE = /\b(level|above|below|standing)\b/

function normalizePrereqPrefix(token) {
  return PREFIX_ALIASES[token.toUpperCase()] || token.toUpperCase()
}

// The code(s) mentioned in one prereq clause, normalized and filtered to codes
// that actually exist in the catalog (drops noise like "PLS 100" from a
// "100-level" band, and "PHI 117" from a bare number that isn't a course).
function codesInPrereqClause(clause, ownPrefix, catalogSet) {
  const seen = new Set()
  const codes = []
  const pushCode = (code) => {
    if (!seen.has(code) && catalogSet.has(code)) {
      seen.add(code)
      codes.push(code)
    }
  }
  const explicitRanges = []
  for (const m of clause.matchAll(PREREQ_CODE_RE)) {
    const [token, number] = m[0].split(/\s+/)
    const prefix = normalizePrereqPrefix(token)
    if (KNOWN_PREFIXES.has(prefix)) {
      pushCode(`${prefix} ${number}`)
      explicitRanges.push([m.index, m.index + m[0].length])
    }
  }
  // Bare three-digit numbers resolve against the course's own prefix, unless
  // they sit inside a level/standing phrase or were part of an explicit code.
  for (const m of clause.matchAll(BARE_NUMBER_RE)) {
    if (explicitRanges.some(([s, e]) => m.index >= s && m.index < e)) continue
    const around = clause.slice(Math.max(0, m.index - 4), m.index + 6).toLowerCase()
    if (NOISE_AROUND_RE.test(around)) continue
    pushCode(`${ownPrefix} ${m[0]}`)
  }
  return codes
}

// Parses a course record's `prerequisites` strings into `{ kind, codes }`
// groups. `kind` is `'all'` (every code required) or `'any'` (at least one);
// strings with no recognizable course code (standing, permission, placement)
// are dropped — they can't be checked against a plan.
export function prereqGroups(course, catalog) {
  const catalogSet = toSet(catalog)
  const courseCode = (course && (course.course_code || course.code)) || ''
  const ownPrefix = courseInfo(courseCode).prefixes[0] || ''
  const strings = (course && course.prerequisites) || []
  const groups = []
  for (const raw of strings) {
    // Clauses split on "and"/";" are independent requirements; a clause whose
    // alternatives are joined by "or" is satisfied by any one of them.
    const clauses = raw
      .split(/\s+and\s+|\s*;\s*/i)
      .map((s) => s.replace(EXCEPT_RE, '').trim())
      .filter(Boolean)
    for (const clause of clauses) {
      const codes = codesInPrereqClause(clause, ownPrefix, catalogSet)
      if (!codes.length) continue
      groups.push({ kind: /\bor\b/i.test(clause) ? 'any' : 'all', codes: [...new Set(codes)] })
    }
  }
  return groups
}

function slotIndex(key, order) {
  if (key === 'transfer') return -Infinity
  if (key === 'unassigned' || !order.includes(key)) return null
  return order.indexOf(key)
}

// Checks a placed course's prerequisites against a plan. `slots` maps each
// timeline slot key to the codes in it and `order` lists the slot keys from
// earliest to latest. Returns `{ met, missing, outOfOrder }`:
// - `missing`     — codes not in the plan at all.
// - `outOfOrder`  — codes in the plan but on or after the course's own slot
//   (a prerequisite must be taken *before* the course). `transfer` counts as
//   before every term; `unassigned` courses carry no timing, so ordering isn't
//   judged against them.
export function prereqStatus(slots, course, catalog, order) {
  const groups = prereqGroups(course, catalog)
  // Map each placed code to its timeline index (null when unassigned — present
  // in the plan but carrying no timing).
  const where = {}
  for (const key of Object.keys(slots || {})) {
    const index = slotIndex(key, order)
    for (const code of slots[key] || []) where[code] = index
  }
  const present = (c) => Object.prototype.hasOwnProperty.call(where, c)
  const courseCode = (course && (course.course_code || course.code)) || ''
  const courseRank = present(courseCode) ? where[courseCode] : null

  const missing = []
  const outOfOrder = []
  for (const g of groups) {
    const taken = g.codes.filter(present)
    const satisfied = g.kind === 'any' ? taken.length > 0 : taken.length === g.codes.length
    if (!satisfied) {
      missing.push(...g.codes.filter((c) => !present(c)))
      continue
    }
    if (courseRank == null) continue
    if (g.kind === 'any') {
      const inTime = taken.some((c) => where[c] != null && where[c] < courseRank)
      const unknownTiming = taken.some((c) => where[c] == null)
      if (!inTime && !unknownTiming) {
        outOfOrder.push(...taken.filter((c) => where[c] != null && where[c] >= courseRank))
      }
    } else {
      for (const c of g.codes) {
        if (where[c] == null) continue
        if (where[c] < courseRank) continue
        outOfOrder.push(c)
      }
    }
  }
  return { met: missing.length === 0 && outOfOrder.length === 0, missing, outOfOrder }
}
