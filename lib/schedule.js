// Schedule domain model + helpers.
//
// Sections:
//   1. Weekday constants
//   2. Slot blocks + time formatting (toMinutes, formatTime)
//   3. CSV parsing + derived index (parseCsv, buildIndex)
//   4. Conflicts (daysOverlap, conflictsBetween, conflictsForCourse, instructorConflicts)
//   5. Calendar layout + time scale (hourMarks, formatHour, daySlotBlocks, blockStyle)
//   6. Display helpers (briefInstructor, dept/instructor colors)
//   7. Filters (instructorsInSchedule, departmentsInSchedule, buildFilter)

// ---------------------------------------------------------------------------
// 1. Weekday constants
// ---------------------------------------------------------------------------

export const WEEKDAYS = ['M', 'T', 'W', 'R', 'F']
export const WEEKDAY_NAMES = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday' }

// ---------------------------------------------------------------------------
// 2. Slot blocks + time formatting
// ---------------------------------------------------------------------------

// Slot blocks: (days, time, startMin, endMin). Times in 24h.
const MWF_BLOCK = [
  ['MWF', '8:00-9:10', 480, 550],
  ['MWF', '9:20-10:30', 560, 630],
  ['MWF', '10:40-11:50', 640, 710],
  ['MWF', '12:00-13:10', 720, 790],
  ['MWF', '13:20-14:30', 800, 870],
  ['MWF', '14:40-15:50', 880, 950],
]
const TR_BLOCK = [
  ['TR', '8:00-9:45', 480, 585],
  ['TR', '10:00-11:45', 600, 705],
  ['TR', '12:20-14:05', 740, 845],
  ['TR', '14:15-16:00', 855, 960],
]

export const SLOT_BLOCKS = [
  { label: 'MWF', slots: MWF_BLOCK.map(([days, time, start, end]) => ({ days, time, start, end })) },
  { label: 'TR', slots: TR_BLOCK.map(([days, time, start, end]) => ({ days, time, start, end })) },
]

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function formatTime(time) {
  // "8:00-9:10" -> "8:00 AM - 9:10 AM"
  const [a, b] = time.split('-')
  const fmt = (t) => {
    const min = toMinutes(t)
    const h24 = Math.floor(min / 60)
    const hour = h24 % 12 || 12
    const mm = String(min % 60).padStart(2, '0')
    const ap = min < 720 ? 'AM' : 'PM'
    return `${hour}:${mm} ${ap}`
  }
  return `${fmt(a)} - ${fmt(b)}`
}

export function slotKey(day, time) {
  return `${day}|${time}`
}

// Chronological time strings for a given day (e.g. 'M' -> the MWF block times).
export function daySlotTimes(day) {
  const times = new Set()
  for (const block of SLOT_BLOCKS) {
    if (!block.label.includes(day)) continue
    for (const slot of block.slots) times.add(slot.time)
  }
  return Array.from(times).sort((a, b) => toMinutes(a.split('-')[0]) - toMinutes(b.split('-')[0]))
}

// ---------------------------------------------------------------------------
// 3. CSV parsing + derived index
// ---------------------------------------------------------------------------

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const header = lines[0].split(',').map((h) => h.trim())
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = line.split(',')
    const rec = {}
    header.forEach((h, idx) => {
      rec[h] = (cells[idx] || '').trim()
    })
    rows.push({
      prefix: rec['dept-prefix'],
      number: rec['course-number'],
      section: rec['section'],
      instructor: rec['instructor'],
      days: rec['days'],
      time: rec['times'],
    })
  }
  return rows
}

// Order two schedule items consistently: dept prefix, then course number
// (numeric), then section.
export function compareItems(a, b) {
  if (a.o.prefix !== b.o.prefix) return a.o.prefix < b.o.prefix ? -1 : 1
  const na = Number(a.o.number)
  const nb = Number(b.o.number)
  if (na !== nb) return na - nb
  return a.o.section < b.o.section ? -1 : a.o.section > b.o.section ? 1 : 0
}

// Order two course-code strings (e.g. "COM 251") by prefix, then number.
export function compareCodes(a, b) {
  const [pa, na] = a.split(' ')
  const [pb, nb] = b.split(' ')
  if (pa !== pb) return pa < pb ? -1 : 1
  return Number(na) - Number(nb)
}

// Reschedules the offering matching `prefix`/`number`/`section` within a
// schedule's `offerings` array into the given `days`/`time`. Returns a new array
// (or the same array with the offering replaced). Callers persist the result.
export function moveOfferingInSchedule(offerings, { prefix, number, section }, days, time) {
  const idx = (offerings || []).findIndex(
    (o) => o.prefix === prefix && o.number === number && o.section === section,
  )
  if (idx < 0) return offerings
  const next = offerings.slice()
  next[idx] = { ...next[idx], days, time }
  return next
}

// Computes the day-set string for a course after an edit-mode drag. `days` is
// the offering's current day letters (e.g. "MW"), `fromDay` the specific day
// the drag started from, `toGroup` the target slot's day group ("MWF"/"TR"),
// `toDay` the specific target day. Rules:
//   1. Different day group -> adopt the target group's full day set ("TR"/"MWF")
//   2. Same group (or same day / unknown source day) -> keep the current days,
//      only the time changes
//   3. Same group, different day -> swap `fromDay` for `toDay` (deduped and
//      ordered by the week), e.g. "MW" dragged onto Friday becomes "WF"
export function rescheduleDays(days, fromDay, toGroup, toDay) {
  const cur = (days || '').split('').filter((d) => 'MTWRF'.includes(d))
  if (!cur.length) return toGroup
  const curGroup = cur.includes('T') || cur.includes('R') ? 'TR' : 'MWF'
  if (toGroup !== curGroup) return toGroup
  if (!fromDay || fromDay === toDay) return cur.join('')
  const seen = new Set()
  const out = []
  for (const d of cur) {
    const v = d === fromDay ? toDay : d
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  out.sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b))
  return out.join('')
}

// Like `moveOfferingInSchedule` but recomputes `days` from the drag context
// (`fromDay`/`toDay`/`toGroup`) instead of taking a raw day string.
export function moveOfferingSmart(offerings, { prefix, number, section }, { fromDay, toDay, group, time }) {
  const idx = (offerings || []).findIndex(
    (o) => o.prefix === prefix && o.number === number && o.section === section,
  )
  if (idx < 0) return offerings
  const days = rescheduleDays((offerings[idx] || {}).days, fromDay, group, toDay)
  const next = offerings.slice()
  next[idx] = { ...next[idx], days, time }
  return next
}

// Rewrites fields (instructor / section / days / time) on the offering matching
// `cur` (its current identity, since `section` may itself be edited). Returns a
// new array, or the same array when nothing matches.
export function updateOfferingInSchedule(offerings, cur, changes) {
  const idx = (offerings || []).findIndex(
    (o) => o.prefix === cur.prefix && o.number === cur.number && o.section === cur.section,
  )
  if (idx < 0) return offerings
  const next = offerings.slice()
  next[idx] = { ...next[idx], ...changes }
  return next
}

// The default landing slot for a newly-added course (the first MWF band).
export const DEFAULT_SLOT = {
  days: SLOT_BLOCKS[0].label,
  time: SLOT_BLOCKS[0].slots[0].time,
}

// The first unused section letter for a course, so a hand-added section never
// collides with an existing one of the same course.
export function nextSectionLetter(offerings, prefix, number) {
  const used = new Set()
  for (const o of offerings || []) {
    if (o.prefix === prefix && o.number === number) used.add(o.section)
  }
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i)
    if (!used.has(letter)) return letter
  }
  return 'Z'
}

// Appends a brand-new offering to a schedule's `offerings` array.
export function addOfferingToSchedule(offerings, offering) {
  return [...(offerings || []), offering]
}

// Removes the offering matching `prefix`/`number`/`section` from a schedule's
// `offerings` array. Returns a new array, or the same array when nothing matches.
export function removeOfferingFromSchedule(offerings, { prefix, number, section }) {
  const list = offerings || []
  const next = list.filter((o) => !(o.prefix === prefix && o.number === number && o.section === section))
  return next.length === list.length ? list : next
}

// Build derived index once schedule data is available.
export function buildIndex(offerings) {
  const byCourse = {}
  const byDay = { M: [], T: [], W: [], R: [], F: [] }
  const bySlot = {}
  const byInstructor = {}

  const eachItem = (o) => {
    const code = `${o.prefix} ${o.number}`
    const days = o.days.split('')
    const [startStr, endStr] = o.time.split('-')
    const start = toMinutes(startStr)
    const end = toMinutes(endStr)
    return { o, code, sid: o.$sid, sectionLabel: `Section ${o.section}`, start, end, days }
  }

  for (const o of offerings) {
    const item = eachItem(o)

    if (!byCourse[item.code]) byCourse[item.code] = []
    byCourse[item.code].push(item)

    if (!byInstructor[o.instructor]) byInstructor[o.instructor] = []
    byInstructor[o.instructor].push(item)

    for (const d of item.days) {
      byDay[d].push(item)
      const key = `${d}|${o.time}`
      if (!bySlot[key]) bySlot[key] = []
      bySlot[key].push(item)
    }
  }

  for (const list of Object.values(byCourse)) list.sort(compareItems)
  for (const list of Object.values(byInstructor)) list.sort(compareItems)
  for (const list of Object.values(byDay)) list.sort(compareItems)
  for (const list of Object.values(bySlot)) list.sort(compareItems)

  return { byCourse, byDay, bySlot, byInstructor }
}

// ---------------------------------------------------------------------------
// 4. Conflicts
// ---------------------------------------------------------------------------

// Two days overlap if they share at least one weekday letter.
function daysOverlap(a, b) {
  return a.some((d) => b.includes(d))
}

// Two offerings conflict from a student perspective if they share a day
// AND their time ranges overlap.
export function conflictsBetween(a, b) {
  return daysOverlap(a.days, b.days) && a.start < b.end && b.start < a.end
}

// All other distinct courses (by code) conflicting with any section of `code`.
export function conflictsForCourse(code, index) {
  const mine = index.byCourse[code] || []
  if (!mine.length) return []
  const seen = new Set()
  const result = []
  for (const otherCode of Object.keys(index.byCourse)) {
    if (otherCode === code) continue
    if (seen.has(otherCode)) continue
    const theirSections = index.byCourse[otherCode]
    let conflicted = false
    for (const m of mine) {
      for (const theirs of theirSections) {
        if (conflictsBetween(m, theirs)) {
          conflicted = true
          break
        }
      }
      if (conflicted) break
    }
    if (conflicted) {
      result.push(otherCode)
      seen.add(otherCode)
    }
  }
  return result.sort(compareCodes)
}

// Detect instructor double-bookings (same instructor, overlapping day+time).
export function instructorConflicts(index) {
  const results = []
  for (const [instructor, items] of Object.entries(index.byInstructor)) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (conflictsBetween(items[i], items[j])) {
          results.push({ instructor, a: items[i], b: items[j] })
        }
      }
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// 5. Calendar layout + time scale
// ---------------------------------------------------------------------------

// Shared vertical time scale for the weekly calendar.
export const DAY_START_MIN = 480 // 8:00
export const DAY_END_MIN = 960 // 16:00
export const PX_PER_MIN = 1

export function hourMarks() {
  // Hour ruler marks between 8:00 and 16:00, as { label, min }.
  const marks = []
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 60) {
    marks.push({ label: formatHour(m), min: m })
  }
  return marks
}

export function formatHour(min) {
  const h12 = (min / 60) % 12 || 12
  return `${h12}${min < 720 ? 'a' : 'p'}`
}

// Group a single weekday's offerings into unique slots (day,time).
// Returns [{ time, start, end, items }] sorted by start time.
export function daySlotBlocks(day, index) {
  if (!index || !index.byDay[day]) return []
  const byTime = {}
  for (const item of index.byDay[day]) {
    const key = item.o.time
    if (!byTime[key]) {
      byTime[key] = { time: item.o.time, start: item.start, end: item.end, items: [] }
    }
    byTime[key].items.push(item)
  }
  return Object.values(byTime).sort((a, b) => a.start - b.start)
}

// Inline style for an absolutely-positioned block on the calendar.
export function blockStyle(slot) {
  return {
    top: (slot.start - DAY_START_MIN) * PX_PER_MIN + 'px',
    height: (slot.end - slot.start) * PX_PER_MIN + 'px',
  }
}

// ---------------------------------------------------------------------------
// 6. Display helpers
// ---------------------------------------------------------------------------

// "M. Vosmeier" -> "Vosmeier M", "Eiriksson" -> "Eiriksson"
export function briefInstructor(name) {
  const m = (name || '').trim().match(/^([A-Za-z])\.\s+(.+)$/)
  return m ? `${m[2]} ${m[1]}` : (name || '').trim()
}

// Distinct colors assigned deterministically per department.
const DEPT_PALETTE = [
  '#1b4965',
  '#e67e22',
  '#7b2d8b',
  '#00695c',
  '#c62828',
  '#0288d1',
  '#8e24aa',
  '#2e7d32',
  '#fb8c00',
  '#5d4037',
  '#d81b60',
  '#3949ab',
  '#00897b',
  '#6a1b9a',
  '#ef6c00',
  '#7cb342',
  '#4527a0',
  '#ad1457',
  '#1565c0',
  '#558b2f',
]
const DEPT_COLORS = new Map()
let paletteCursor = 0

export function colorForDept(prefix) {
  if (!DEPT_COLORS.has(prefix)) {
    DEPT_COLORS.set(prefix, DEPT_PALETTE[paletteCursor % DEPT_PALETTE.length])
    paletteCursor++
  }
  return DEPT_COLORS.get(prefix)
}

const INSTRUCTOR_COLORS = new Map()
let instructorPaletteCursor = 0

export function colorForInstructor(name) {
  if (!INSTRUCTOR_COLORS.has(name)) {
    INSTRUCTOR_COLORS.set(name, DEPT_PALETTE[instructorPaletteCursor % DEPT_PALETTE.length])
    instructorPaletteCursor++
  }
  return INSTRUCTOR_COLORS.get(name)
}

// Distinct color assigned deterministically per schedule id, used when multiple
// schedules are displayed at once and no department/instructor filter is active.
const SCHEDULE_PALETTE = [
  '#d81b60',
  '#1565c0',
  '#2e7d32',
  '#ef6c00',
  '#7b1d8b',
  '#00897b',
  '#3949ab',
  '#c62828',
]
const SCHEDULE_COLORS = new Map()
let schedulePaletteCursor = 0

export function colorForSchedule(sid) {
  const key = String(sid == null ? '' : sid)
  if (!SCHEDULE_COLORS.has(key)) {
    SCHEDULE_COLORS.set(key, SCHEDULE_PALETTE[schedulePaletteCursor % SCHEDULE_PALETTE.length])
    schedulePaletteCursor++
  }
  return SCHEDULE_COLORS.get(key)
}

// ---------------------------------------------------------------------------
// 7. Filters
// ---------------------------------------------------------------------------

// Sort key for an instructor name, based on the last name (last token).
// Handles "A. Smith" -> "Smith", "Rodriguez Villar" -> "Villar", "Adams" -> "Adams".
export function instructorSortKey(name) {
  return String(name).trim().split(/\s+/).pop().toLowerCase()
}

// Compare two instructor names by last name (stable tie-break on full name).
export function compareInstructors(a, b) {
  const ka = instructorSortKey(a)
  const kb = instructorSortKey(b)
  if (ka !== kb) return ka < kb ? -1 : 1
  return String(a).localeCompare(String(b))
}

// Sorted list of distinct instructors present in the schedule.
export function instructorsInSchedule(index) {
  if (!index) return []
  return Object.keys(index.byInstructor).sort(compareInstructors)
}

// Sorted list of distinct department prefixes present in the schedule.
export function departmentsInSchedule(index) {
  if (!index) return []
  const set = new Set()
  for (const code of Object.keys(index.byCourse)) {
    set.add(code.split(' ')[0])
  }
  return Array.from(set).sort()
}

// Centralized filter selection: 'dept' or 'instructor' mode.
// Returns { active, matches(item), color(item) }.
export function buildFilter(mode, depts, instructors) {
  if (mode === 'instructor') {
    return {
      active: instructors.length > 0,
      matches: (it) => instructors.includes(it.o.instructor),
      color: (it) => colorForInstructor(it.o.instructor),
    }
  }
  return {
    active: depts.length > 0,
    matches: (it) => depts.includes(it.o.prefix),
    color: (it) => colorForDept(it.o.prefix),
  }
}

// Unified visual coloring for schedule views. A department/instructor filter takes
// priority; otherwise, when `colorSchedules` is on and at least one schedule is
// displayed, every course block is colored by which schedule it belongs to (with a
// single schedule this shows the actual course list rather than a count summary).
export function buildVisual(mode, depts, instructors, scheduleIds, colorSchedules) {
  const filter = buildFilter(mode, depts, instructors)
  if (filter.active) return filter
  const ids = (scheduleIds || []).filter(Boolean)
  if (colorSchedules && ids.length > 0) {
    return {
      active: true,
      matches: () => true,
      color: (it) => colorForSchedule(it.sid),
    }
  }
  return { active: false, matches: () => true, color: () => '' }
}
