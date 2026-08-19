// Real-catalog invariant smoke test.
//
// The synthetic unit tests (planner.test.js) and the capability catalog
// (scenarios.mjs) exercise the engine against controlled inputs; this test runs
// the engine against the ACTUAL committed catalog artifacts — the shapes the
// pipeline emits today — and asserts only *invariants*, never specific counts.
// That keeps it green across catalog churn (new courses, reworded requirements)
// while catching the failure mode synthetic tests can't: a real requirement
// shape the engine can't evaluate without throwing or producing malformed
// output.
//
// The three artifact files live at the repo root. If they're absent (e.g. this
// package lifted onto its own host), the test skips instead of failing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trackReport, trackGaps, expandCode } from '../planner.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')

const artifacts = ['majors.json', 'requirements_parsed.json', 'core_requirements.json']
const present = artifacts.every((f) => {
  try {
    readFileSync(join(root, f))
    return true
  } catch {
    return false
  }
})

const STATUSES = ['satisfied', 'partial', 'unsatisfied', 'unknown']

function load(name) {
  return JSON.parse(readFileSync(join(root, name), 'utf8'))
}

// All codes the engine can ever match against: the global catalog plus every
// per-program list (the same union loadCatalog builds in the browser).
function realCatalog() {
  const majors = load('majors.json')
  const set = new Set(Object.keys(majors.catalog || {}))
  for (const p of majors.programs || []) for (const c of p.courses || []) set.add(c.course_code)
  return set
}

// Every code a requirement literally references (for building a taken set that
// stresses satisfaction on real shapes).
function requirementCodes(requirement) {
  const codes = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.codes === 'string') codes.add(node.codes)
    if (Array.isArray(node.codes)) for (const c of node.codes) codes.add(c)
    if (Array.isArray(node.items)) for (const it of node.items) walk(it)
    if (node.constraints && Array.isArray(node.constraints)) {
      for (const c of node.constraints) if (Array.isArray(c.codes)) for (const x of c.codes) codes.add(x)
    }
    if (node.sections && Array.isArray(node.sections)) for (const s of node.sections) walk(s)
    if (node.requirements && Array.isArray(node.requirements)) for (const r of node.requirements) walk(r)
  }
  walk(requirement)
  return codes
}

// Deterministic pseudo-random subset so the smoke test is stable across runs.
function deterministicSample(catalog, count) {
  const codes = [...catalog].sort()
  const out = []
  for (let i = 0; i < count; i++) {
    const idx = (i * 2654435761) % codes.length
    const c = codes[idx]
    if (c) out.push(c)
  }
  return out
}

function assertReportShape(report, catalog, requirement, taken, known) {
  assert.ok(STATUSES.includes(report.status), `${requirement.label || '?'}: bad status ${report.status}`)
  assert.ok(Number.isInteger(report.satisfied) && Number.isInteger(report.total), 'satisfied/total are integers')
  assert.ok(report.total >= 0 && report.satisfied >= 0, 'tallies are non-negative')
  assert.ok(report.total === report.sections.length, 'total matches section count')
  const isKnown = known || ((c) => catalog.has(c))
  for (const [si, sec] of report.sections.entries()) {
    assert.ok(typeof sec.heading === 'string', `section ${si}: heading is a string`)
    assert.ok(STATUSES.includes(sec.status), `section ${si}: bad status ${sec.status}`)
    assert.ok(sec.done >= 0 && sec.total >= 0, `section ${si}: non-negative counts`)
    assert.ok(sec.done <= sec.total, `section ${si}: done (${sec.done}) ≤ total (${sec.total})`)
    assert.ok(Array.isArray(sec.counted) && Array.isArray(sec.extra) && Array.isArray(sec.codes), 'arrays present')
    assert.ok(
      sec.counted.every((c) => isKnown(c)),
      `section ${si}: counted code not in catalog`,
    )
    assert.ok(
      sec.extra.every((c) => isKnown(c)),
      `section ${si}: extra code not in catalog`,
    )
    assert.deepEqual(
      [...new Set(sec.codes)].sort(),
      [...new Set([...sec.counted, ...sec.extra])].sort(),
      `section ${si}: codes = counted + extra`,
    )
    const countedSet = new Set(sec.counted)
    const disjoint = sec.extra.every((c) => !countedSet.has(c))
    assert.ok(disjoint, `section ${si}: counted and extra are disjoint`)
  }
  for (const g of report.gaps) {
    assertGapShape(g, catalog, requirement.label, isKnown)
  }
}

function assertGapShape(g, catalog, label, isKnown) {
  const context = `${label || '?'}`
  assert.ok(typeof g === 'object', `${context}: gap is an object`)
  assert.ok(
    g.label || g.codes || g.note || g.alternatives,
    `${context}: gap has label, codes, note, or alternatives`,
  )
  if (g.codes) {
    assert.ok(Array.isArray(g.codes), `${context}: codes is an array`)
    for (const c of g.codes) assert.ok(isKnown(c), `${context}: gap code ${c} not in catalog`)
  }
  if (g.alternatives) {
    for (const alt of g.alternatives) {
      assert.ok(Array.isArray(alt.slots), `${context}: alternative has slots`)
      for (const slot of alt.slots) for (const c of slot.codes || []) {
        assert.ok(isKnown(c), `${context}: slot code ${c} not in catalog`)
      }
    }
  }
}

test('real parsed requirements evaluate without throwing or producing malformed output', { skip: !present && 'catalog artifacts not present at repo root' }, () => {
  const catalog = realCatalog()
  const parsed = load('requirements_parsed.json')
  const core = load('core_requirements.json')
  const requirements = [
    ...parsed.programs.flatMap((p) => p.requirements || []),
    ...(core.programs || []).flatMap((p) => p.requirements || []),
  ]
  assert.ok(requirements.length > 0, 'expected real requirements to load')
  const sample = deterministicSample(catalog, 24)
  const takenSets = [new Set(), new Set(sample)]
  for (const requirement of requirements) {
    const label = requirement.label || '?'
    // Gap candidates may come from the requirement's own text or an aliased
    // spelling (e.g. GNDR 499 → GNDS 499) even when the canonical code isn't
    // the indexed course, so accept codes that expand to a catalog or declared
    // code.
    const declared = requirementCodes(requirement)
    const known = (code) =>
      catalog.has(code) || declared.has(code) || [...expandCode(code)].some((c) => catalog.has(c) || declared.has(c))
    for (const taken of takenSets) {
      let report
      // gaps: false keeps this fast: the candidates loop in gapGroups walks
      // every untaken universe course (an open Gender Studies pool is the whole
      // catalog), which the per-candidate completion search makes pathologically
      // slow on large pools. Section/evaluation shape is still fully checked;
      // gap shape is covered by the bounded test below.
      assert.doesNotThrow(() => {
        report = trackReport(requirement, taken, catalog, { gaps: false })
      }, `${label} with ${taken.size} taken`)
      assertReportShape(report, catalog, requirement, taken, known)
    }
    // Taken = a capped slice of the codes the requirement references: walks a
    // requirement toward satisfied/partial on its own vocabulary without the
    // exhaustive DFS cost of feeding it everything at once.
    const refs = requirementCodes(requirement)
    const refTaken = new Set([...refs].filter((c) => catalog.has(c)).slice(0, 24))
    if (refTaken.size > 0) {
      let report
      assert.doesNotThrow(() => {
        report = trackReport(requirement, refTaken, catalog, { gaps: false })
      }, `${label} with all referenced codes taken`)
      assertReportShape(report, catalog, requirement, refTaken, known)
    }
  }
})

test('real-track gap suggestions stay within the known universe (bounded subset)', { skip: !present && 'catalog artifacts not present at repo root' }, () => {
  const catalog = realCatalog()
  const parsed = load('requirements_parsed.json')
  const core = load('core_requirements.json')
  const all = [
    ...parsed.programs.flatMap((p) => p.requirements || []),
    ...(core.programs || []).flatMap((p) => p.requirements || []),
  ]
  assert.ok(all.length > 0, 'expected real requirements to load')
  // An electives pool declared by note (no explicit codes) is the whole catalog,
  // and gap enumeration pays per-candidate DFS across it — check gap shape only
  // where the pool is bounded, plus a deterministic index-based subset, so the
  // gate stays fast while the evaluate test above still runs every requirement.
  const hasOpenPool = (req) =>
    (req.sections || []).some((s) =>
      (s.items || []).some(
        (it) => it.type === 'electives' && (it.constraints || []).some((c) => c.type === 'from' && !Array.isArray(c.codes)),
      ),
    )
  const sample = new Set(deterministicSample(catalog, 24))
  let checked = 0
  for (const [i, req] of all.entries()) {
    const hash = (i * 2654435761) % 4
    if (hasOpenPool(req) || hash !== 0) continue
    const gaps = trackGaps(req, sample, catalog)
    const declared = requirementCodes(req)
    const isKnown = (c) =>
      catalog.has(c) || declared.has(c) || [...expandCode(c)].some((x) => catalog.has(x) || declared.has(x))
    for (const g of gaps) assertGapShape(g, catalog, req.label || 'core', isKnown)
    checked += 1
  }
  assert.ok(checked >= 8, `expected a meaningful subset (${checked} checked)`)
})