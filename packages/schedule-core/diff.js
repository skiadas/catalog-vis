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

import {
  addOfferingToSchedule,
  offeringIdentity,
  removeOfferingFromSchedule,
  updateOfferingInSchedule,
  courseNumberLabel,
  offeringSectionLabel,
} from './schedule.js'

// Tuple key identifying an offering by id (preferred) or prefix/number/section
// (plus the lab marker, so a lab section never matches the lecture section it
// mirrors). Delegates to the shared id-first identity so diff/apply and the
// overlay agree on what "the same row" means (split meetings).
export function offeringKey(o) {
  return offeringIdentity(o)
}

// The editable fields considered when diffing two offerings. `seats` is a
// number; `canonical` stringifies it for comparison. `title` is the offering's
// own title ('' = fall back to the catalog name). `crossListOwner` is the
// cross-list group's owning department prefix ('' = ungrouped/unowned): it must
// travel in the op's `changes` so a first edit that claims an imported group
// survives propose/approve, but it is metadata — never shown in the
// human-readable diff (see `diffOfferings`).
export const EDITABLE_FIELDS = [
  'title',
  'instructor',
  'secondaryInstructors',
  'section',
  'days',
  'time',
  'seats',
  'crossListOwner',
]

// Editable fields that are state metadata rather than course content: they ride
// in `changes` (so apply sets them) but are kept out of the readable diff.
const METADATA_FIELDS = new Set(['crossListOwner'])

// Canonical comparison form of a field value: arrays (secondaryInstructors)
// compare element-wise, everything else trims the string.
function canonical(v) {
  if (Array.isArray(v)) return v.map((n) => String(n || '').trim()).join('|')
  return normalize(v)
}

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
      const from = canonical(b[field])
      const to = canonical(a[field])
      if (from !== to) {
        changes[field] = a[field]
        if (!METADATA_FIELDS.has(field)) diff.push({ field, from: b[field] ?? '', to: a[field] ?? '' })
      }
    }
    if (diff.length || Object.keys(changes).length) {
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
// Carries the lab marker so ops target the exact row — and the content `id`
// when the offering has one, so an op always lands on the exact meeting row
// even when a sibling shares the section tuple (split meetings). A cross-listed
// row's `crossListOwner` rides along so the server's dept rule can see the
// group owner (apply ignores it; it is not part of identity).
function keyOf(o) {
  const k = { prefix: o.prefix, number: o.number, section: o.section, lab: o.lab, labSeq: o.labSeq }
  if (o.crossListOwner) k.crossListOwner = o.crossListOwner
  if (o.id != null && o.id !== '') k.id = o.id
  // The meeting band rides along as display metadata only — matching ignores it
  // (the id wins, and the tuple key excludes days/time) — so a history or
  // proposal label can name which meeting a split-meeting op touches.
  k.days = o.days || ''
  k.time = o.time || ''
  return k
}

// The raw meeting band of an offering (`R 13:00-14:30`), or '' for an
// unscheduled row. Labels split-meeting ops only.
export function meetingBand(o) {
  if (!o || !o.days || !o.time) return ''
  return `${o.days} ${o.time}`
}

// The `${prefix}|${number}|${section}` group key of an op's row: the added
// offering, or the course an update/remove targets.
export function opGroupKey(op) {
  if (!op) return ''
  const o = op.kind === 'add' ? op.offering : op.cur
  if (!o) return ''
  return `${o.prefix || ''}|${o.number || ''}|${o.section || ''}`
}

// The section keys carrying split meetings in `offerings`: a non-lab section
// with more than one distinct row (same course code). History/proposal labels
// name the meeting only where it actually disambiguates.
export function splitGroups(offerings) {
  const bySection = new Map()
  for (const o of offerings || []) {
    if (!o || o.lab) continue
    const key = `${o.prefix || ''}|${o.number || ''}|${o.section || ''}`
    const id = o.id != null && o.id !== '' ? o.id : `${o.days || ''}|${o.time || ''}`
    if (!bySection.has(key)) bySection.set(key, new Set())
    bySection.get(key).add(id)
  }
  const out = new Set()
  for (const [key, ids] of bySection) if (ids.size > 1) out.add(key)
  return out
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
//   "CS 220: other instructors from Xu to Xu, Ray"
//   "add CS 101 A"
//   "remove BIO 161 A"
// With `showMeeting`, a split-meeting op's subject names its band so two rows
// for one section read apart: "add CS 220 A · R 13:00-14:30". Callers pass it
// only for sections that actually carry more than one meeting (`splitGroups`).
export function describeChange(op, { showMeeting = false } = {}) {
  if (!op) return ''
  if (op.kind === 'add') {
    return `add ${fmtCode(op.offering)}${bandSuffix(op.offering, showMeeting)}`
  }
  if (op.kind === 'remove') {
    return `remove ${fmtCode(op.cur)}${bandSuffix(op.cur, showMeeting)}`
  }
  if (op.kind === 'update') {
    // Name the meeting the change lands on, using the new band when the edit
    // changed it (else the row's current band).
    const after = {
      days: op.changes && op.changes.days !== undefined ? op.changes.days : op.cur && op.cur.days,
      time: op.changes && op.changes.time !== undefined ? op.changes.time : op.cur && op.cur.time,
    }
    let parts
    if (op.diff && op.diff.length) {
      parts = op.diff.map((d) => {
        const label = FIELD_LABEL[d.field] || d.field
        const from = fmtValue(d.from)
        const to = fmtValue(d.to)
        if (from === '') return `${label} set to ${to}`
        if (to === '') return `${label} cleared`
        return `${label} from ${from} to ${to}`
      })
    } else {
      // No per-field diff detail (e.g. a hand-written op): describe the changes.
      parts = Object.entries(op.changes || {}).map(
        ([field, to]) => `${FIELD_LABEL[field] || field} set to ${fmtValue(to)}`,
      )
    }
    return `${fmtCode(op.cur)}${bandSuffix(after, showMeeting)}: ${parts.join(', ') || 'no changes'}`
  }
  return JSON.stringify(op)
}

// The ` · <band>` suffix for a split-meeting label, or '' when the label isn't
// naming a meeting (unsplit sections, or an unscheduled row).
function bandSuffix(o, showMeeting) {
  if (!showMeeting) return ''
  const band = meetingBand(o)
  return band ? ` · ${band}` : ''
}

// Readable field names for the diff detail (arrays join as a comma list).
const FIELD_LABEL = { secondaryInstructors: 'other instructors' }

function fmtValue(v) {
  if (Array.isArray(v)) return v.map((n) => String(n ?? '')).join(', ')
  return String(v ?? '')
}

function fmtCode(o) {
  if (!o) return ''
  const s = `${o.prefix || ''} ${courseNumberLabel(o)}`.trim()
  return offeringSectionLabel(o) ? `${s} ${offeringSectionLabel(o)}` : s
}

// Render a list of operations as plain lines, markdown bullets, or CSV.
// `format`: 'text' | 'md' | 'csv'. `options.splitGroups` (a `splitGroups` set)
// names the meeting on split-meeting rows so they read apart.
/**
 * @param {Array<any>} operations
 * @param {'text' | 'md' | 'csv'} [format]
 * @param {{ splitGroups?: Set<string> }} [options]
 */
export function renderChanges(operations, format = 'text', { splitGroups: groups } = {}) {
  const lines = (operations || []).map((op) =>
    describeChange(op, { showMeeting: Boolean(groups && groups.has(opGroupKey(op))) }),
  )
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
