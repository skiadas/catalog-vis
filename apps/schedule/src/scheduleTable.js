// Pure helpers for the table ("spreadsheet") view: row department grouping and
// the inline-cell parsers. Kept out of the component so they unit-test without
// a DOM (see `test/scheduleTable.test.mjs`). The parsers return the canonical
// value, `''` for a deliberately blank cell, or `null` for invalid input the
// caller should revert.
import { WEEKDAYS, normalizeBand, termConfig, termSlotOptions } from '@major-vis/schedule-core'

// The department a row belongs to for the table's filter: its own course
// prefix. (Cross-list ownership gates *editing*, not which department's list a
// row appears in — every sibling version keeps its own prefix.)
export function departmentOf(o) {
  return String((o && o.prefix) || '').toUpperCase()
}

// The distinct department prefixes present in a set of offering rows, sorted.
export function departmentsInOfferings(offerings) {
  const set = new Set()
  for (const o of offerings || []) {
    const d = departmentOf(o)
    if (d) set.add(d)
  }
  return [...set].sort()
}

// Whether a row is in `dept`; '' is the "All departments" view (every row).
export function inDepartment(o, dept) {
  const want = String(dept || '').toUpperCase()
  return !want || departmentOf(o) === want
}

// The table's stable order: department, then course number (numeric), then
// section; a lecture precedes its labs, and labs order by sequence.
export function compareTableRows(a, b) {
  const da = departmentOf(a)
  const db = departmentOf(b)
  if (da !== db) return da < db ? -1 : 1
  if (a.prefix !== b.prefix) return a.prefix < b.prefix ? -1 : 1
  const na = Number(a.number)
  const nb = Number(b.number)
  if (na !== nb) return na - nb
  const sa = a.section || ''
  const sb = b.section || ''
  if (sa !== sb) return sa < sb ? -1 : 1
  const la = a.lab ? 1 : 0
  const lb = b.lab ? 1 : 0
  if (la !== lb) return la - lb
  return (a.labSeq || 0) - (b.labSeq || 0)
}

// Parse the seats cell into a positive integer, or null when it isn't one.
export function parseSeatsInput(text) {
  const s = String(text ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n > 0 ? n : null
}

// Parse the days cell into the canonical weekday order (MTWRF), '' for blank
// (unscheduled), or null when it holds anything but weekday letters.
export function parseDaysInput(text) {
  const s = String(text ?? '')
    .trim()
    .toUpperCase()
  if (!s) return ''
  if (!/^[MTWRF]+$/.test(s)) return null
  const seen = new Set(s.split(''))
  if (seen.size !== s.length) return null
  return WEEKDAYS.filter((d) => seen.has(d)).join('')
}

const BAND_RE = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/

// Parse the time cell into schedule-core's canonical band (`8:00-9:10`), ''
// for blank (unscheduled), or null when it isn't a valid start-before-end band.
export function parseTimeInput(text) {
  const s = String(text ?? '').trim()
  if (!s) return ''
  const m = s.match(BAND_RE)
  if (!m) return null
  const start = Number(m[1]) * 60 + Number(m[2])
  const end = Number(m[3]) * 60 + Number(m[4])
  if (!(start < end)) return null
  return normalizeBand(s)
}

// The term's assignable standard bands, labeled by their day group and in the
// term's order: Fall/Winter yield 10 (six MWF + four TR), Spring 7 (the four
// MTWRF base slots plus the allowed two-slot runs).
export function standardBands(termKey) {
  const config = termConfig(termKey)
  const out = []
  for (const group of config.dayGroups) {
    for (const slot of termSlotOptions(termKey, group.label[0])) {
      out.push({ days: group.label, time: slot.time })
    }
  }
  return out
}

// The standard band matching an exact days/time pair (time normalized), or null.
export function standardBandFor(bands, days, time) {
  if (!days || !time) return null
  const want = normalizeBand(time)
  return (bands || []).find((b) => b.days === days && b.time === want) || null
}

// Parse the table's one-field meeting input (`MW 8:00-9:10`) into
// `{ days, time }` (both canonicalized), or null when it isn't a weekday set
// followed by a valid band. A blank days set or blank band is rejected — the
// caller commits "no meeting time" through the picker instead.
export function parseMeetingInput(text) {
  const s = String(text ?? '').trim()
  const parts = s.split(/\s+/)
  if (parts.length < 2) return null
  const days = parseDaysInput(parts[0])
  const time = parseTimeInput(parts.slice(1).join(''))
  if (!days || !time) return null
  return { days, time }
}
