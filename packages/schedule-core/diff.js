// Suggested-change diffing for schedule term parts.
//
// A "suggestion" is a list of operations that takes a term's offerings from
// `before` to `after`. Operations are identity-based (an offering's
// prefix/number/section is stable; an app-assigned id, when present, takes
// precedence) and carry per-field before/after so they read naturally ("CS 220:
// change instructor from Wahl to Skiadas"). This is the pure counterpart to the
// server's apply logic; both the browser (draft edits -> suggestion) and the
// server (approve -> apply) use it.
//
// Operations never carry state: review status lives on the *suggestion* — a
// stored suggestion's `operations` are entries `{ id, op, resolution }`, where
// `op` is byte-identical to what `diffOfferings` produces. `pureOps` unwraps
// entries (or passes bare ops through) for the stateless core functions, and
// `suggestionStatus` derives the row-level status from entry resolutions.

import { addOfferingToSchedule, removeOfferingFromSchedule, updateOfferingInSchedule } from './schedule.js'

// Tuple key identifying an offering by id (preferred) or prefix/number/section.
export function offeringKey(o) {
  if (o.id != null && o.id !== '') return `id:${o.id}`
  return `${o.prefix || ''} ${o.number || ''} ${o.section || ''}`
}

// The editable fields considered when diffing two offerings.
export const EDITABLE_FIELDS = ['instructor', 'section', 'days', 'time']

// Build the operation list that turns `before` into `after`. Returns
// add/remove/update ops; update ops carry `changes` (new values, for applying)
// and a `diff` detail array of { field, from, to } for readable descriptions.
export function diffOfferings(before, after) {
  const beforeList = before || []
  const afterList = after || []
  const beforeByKey = new Map(beforeList.map((o) => [offeringKey(o), o]))

  const operations = []
  const seen = new Set()
  for (const a of afterList) {
    const key = offeringKey(a)
    seen.add(key)
    const b = beforeByKey.get(key)
    if (!b) {
      operations.push({ kind: 'add', offering: { ...a } })
      continue
    }
    const changes = {}
    const diff = []
    for (const field of EDITABLE_FIELDS) {
      const from = normalize(b[field])
      const to = normalize(a[field])
      if (from !== to) {
        changes[field] = a[field]
        diff.push({ field, from: b[field] ?? '', to: a[field] ?? '' })
      }
    }
    if (diff.length) {
      operations.push({ kind: 'update', cur: keyOf(b), changes, diff })
    }
  }
  for (const b of beforeList) {
    const key = offeringKey(b)
    if (seen.has(key)) continue
    operations.push({ kind: 'remove', cur: keyOf(b) })
  }
  return operations
}

// Identity object used by update/remove ops (what the apply side matches on).
function keyOf(o) {
  return { prefix: o.prefix, number: o.number, section: o.section }
}

function normalize(v) {
  if (v == null) return ''
  return String(v).trim()
}

// Apply a list of operations to an offerings array, returning a new array.
// Unknown/mismatched ops are skipped so a stale suggestion can't corrupt a term;
// add ops that duplicate an existing offering (same prefix/number/section) are
// skipped so concurrent approvals can't create duplicates. Pure: ops carry no
// state — callers decide which ops to apply.
export function applyOperations(offerings, operations) {
  if (!Array.isArray(operations)) return offerings
  const existing = new Set((offerings || []).map(offeringKey))
  let list = offerings
  for (const op of operations) {
    if (!op) continue
    if (op.kind === 'add' && op.offering) {
      if (existing.has(offeringKey(op.offering))) continue
      list = addOfferingToSchedule(list, { ...op.offering })
      existing.add(offeringKey(op.offering))
    } else if (op.kind === 'remove' && op.cur) {
      list = removeOfferingFromSchedule(list, op.cur)
      existing.delete(offeringKey(op.cur))
    } else if (op.kind === 'update' && op.cur && op.changes) {
      const next = updateOfferingInSchedule(list, op.cur, op.changes)
      list = next
    }
  }
  return list
}

// The op payloads of a suggestion's entries, or the ops themselves when handed
// a bare operations array (`diffOfferings` output). Entries are
// `{ id?, op, resolution }` — this unwraps the payload so the stateless core
// (apply/diff/describe/render) never sees review state.
export function pureOps(entries) {
  return (entries || []).filter(Boolean).map((e) => (e && typeof e === 'object' && e.op ? e.op : e))
}

// Derives the suggestion-level status from an entry list. Returns null while
// any op is unresolved (the proposal is still live); otherwise:
//   'approved'  — some accepted op actually changed the term
//   'moot'      — accepted ops changed nothing (e.g. already applied elsewhere)
//   'withdrawn' — the proposer pulled the remaining ops; outranks 'rejected'
//                 in mixed rows (the owner accepted nothing)
//   'rejected'  — the owner rejected everything.
// An empty entry list is 'moot' (it can never change anything).
export function suggestionStatus(entries) {
  const list = entries || []
  if (!list.length) return 'moot'
  const statusOf = (e) => (e && e.resolution && e.resolution.status) || 'pending'
  if (list.some((e) => statusOf(e) === 'pending')) return null
  if (list.some((e) => statusOf(e) === 'accepted' && e.resolution.applied === true)) return 'approved'
  if (list.some((e) => statusOf(e) === 'accepted')) return 'moot'
  if (list.some((e) => statusOf(e) === 'withdrawn')) return 'withdrawn'
  return 'rejected'
}

// Human-readable single-op description, e.g.
//   "CS 220: change instructor from Wahl to Skiadas"
//   "add CS 101 A"
//   "remove BIO 161 A"
export function describeChange(op) {
  if (!op) return ''
  if (op.kind === 'add') {
    return `add ${fmtCode(op.offering)}`
  }
  if (op.kind === 'remove') {
    return `remove ${fmtCode(op.cur)}`
  }
  if (op.kind === 'update') {
    let parts
    if (op.diff && op.diff.length) {
      parts = op.diff.map((d) => {
        if (d.from === '') return `${d.field} set to ${d.to}`
        if (d.to === '') return `${d.field} cleared`
        return `${d.field} from ${d.from} to ${d.to}`
      })
    } else {
      // No per-field diff detail (e.g. a hand-written op): describe the changes.
      parts = Object.entries(op.changes || {}).map(([field, to]) => `${field} set to ${to}`)
    }
    return `${fmtCode(op.cur)}: ${parts.join(', ') || 'no changes'}`
  }
  return JSON.stringify(op)
}

function fmtCode(o) {
  if (!o) return ''
  const s = `${o.prefix || ''} ${o.number || ''}`.trim()
  return o.section ? `${s} ${o.section}` : s
}

// Render a list of operations as plain lines, markdown bullets, or CSV.
// `format`: 'text' | 'md' | 'csv'.
export function renderChanges(operations, format = 'text') {
  const lines = (operations || []).map(describeChange)
  if (format === 'md') return lines.map((l) => `- ${l}`).join('\n') || '_No changes._'
  if (format === 'csv') {
    const rows = [['change']]
    for (const l of lines) rows.push([l])
    return rows.map((r) => r.map(csvCell).join(',')).join('\n')
  }
  return lines.join('\n') || '(no changes)'
}

function csvCell(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
