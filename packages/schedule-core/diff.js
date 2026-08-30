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
// Each operation may carry a per-op `resolution` marker ('pending' | 'accepted'
// | 'rejected', absent = pending) so the owner of a schedule can accept or
// reject the individual changes of one suggestion. `applyOperations` and
// `proposeOverlay` honor the marker (rejected ops are never applied or shown);
// `resolutionStatus` derives the row-level status once every op is resolved.

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
// skipped so concurrent approvals can't create duplicates. Ops the owner already
// rejected (resolution === 'rejected') are skipped, so a partially-resolved
// suggestion can never reapply a rejected change (nor re-propose it from a draft
// that replays the ops).
export function applyOperations(offerings, operations) {
  if (!Array.isArray(operations)) return offerings
  const existing = new Set((offerings || []).map(offeringKey))
  let list = offerings
  for (const op of operations) {
    if (!op || op.resolution === 'rejected') continue
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

// The effective resolution of an op ('pending' when the marker is absent).
export function opResolution(op) {
  if (!op || op.resolution === 'pending' || op.resolution == null) return 'pending'
  return op.resolution
}

// Derives the row-level status of a suggestion once every operation has a
// resolution: 'approved' when at least one accepted op actually changed the
// term, 'moot' when accepted ops changed nothing (e.g. already applied by
// another suggestion), 'rejected' when all were rejected. Returns null while
// any op is still pending — the row stays live until fully resolved.
export function resolutionStatus(operations) {
  const ops = operations || []
  // An empty suggestion changed nothing and never will; it is 'moot' outright.
  if (!ops.length) return 'moot'
  if (!ops.every((op) => opResolution(op) !== 'pending')) return null
  const anyAccepted = ops.some((op) => opResolution(op) === 'accepted')
  if (!anyAccepted) return 'rejected'
  return ops.some((op) => opResolution(op) === 'accepted' && op.applied === true) ? 'approved' : 'moot'
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
