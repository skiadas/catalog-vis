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
/** @type {Array<[string, string, number, number]>} */
const MWF_BLOCK = [
  ['MWF', '8:00-9:10', 480, 550],
  ['MWF', '9:20-10:30', 560, 630],
  ['MWF', '10:40-11:50', 640, 710],
  ['MWF', '12:00-13:10', 720, 790],
  ['MWF', '13:20-14:30', 800, 870],
  ['MWF', '14:40-15:50', 880, 950],
]
/** @type {Array<[string, string, number, number]>} */
const TR_BLOCK = [
  ['TR', '8:00-9:45', 480, 585],
  ['TR', '10:00-11:45', 600, 705],
  ['TR', '12:20-14:05', 740, 845],
  ['TR', '14:15-16:00', 855, 960],
]
// Spring term: all days identical (MTWRF), four base slots. A course may occupy
// up to `maxConsecutiveSlots` consecutive base slots (e.g. 8:00-10:15 means the
// first two slots; the assignable bands below derive those combinations).
// Spring term: all days identical (MTWRF), four base slots. A course may occupy
// up to `maxConsecutiveSlots` consecutive base slots (e.g. 8:00-10:15 means the
// first two slots; the assignable bands below derive those combinations).
/** @type {Array<[string, string, number, number]>} */
const SPRING_BLOCK = [
  ['MTWRF', '8:00-10:15', 480, 615],
  ['MTWRF', '10:15-12:30', 615, 750],
  ['MTWRF', '12:30-14:45', 750, 885],
  ['MTWRF', '14:45-17:00', 885, 1020],
]

export const SLOT_BLOCKS = [
  { label: 'MWF', slots: MWF_BLOCK.map(([days, time, start, end]) => ({ days, time, start, end })) },
  { label: 'TR', slots: TR_BLOCK.map(([days, time, start, end]) => ({ days, time, start, end })) },
]

// Per-term calendar configurations. A term config carries its day groups (each a
// base slot block), the calendar's day range, and how many consecutive base
// slots a course may span (`maxConsecutiveSlots`). Fall and Winter share the
// standard MWF/TR set; Spring has one MTWRF group of four slots that courses may
// occupy in pairs. `termConfig(key)` is the lookup the app views use.
const SPRING_SLOTS = SPRING_BLOCK.map(([days, time, start, end]) => ({ days, time, start, end }))
export const TERM_CONFIGS = [
  { key: 'F', label: 'Fall', dayGroups: SLOT_BLOCKS, dayStart: 480, dayEnd: 960, maxConsecutiveSlots: 1 },
  { key: 'W', label: 'Winter', dayGroups: SLOT_BLOCKS, dayStart: 480, dayEnd: 960, maxConsecutiveSlots: 1 },
  {
    key: 'S',
    label: 'Spring',
    dayGroups: [{ label: 'MTWRF', slots: SPRING_SLOTS }],
    dayStart: 480,
    dayEnd: 1020,
    maxConsecutiveSlots: 2,
  },
]
export const TERM_KEYS = ['F', 'W', 'S']
export const TERM_LABELS = { F: 'Fall', W: 'Winter', S: 'Spring' }

export function termConfig(key) {
  return TERM_CONFIGS.find((t) => t.key === key) || TERM_CONFIGS[0]
}

// The day-group label a day belongs to under a term (e.g. 'MWF' for Monday in
// Fall, 'MTWRF' for any day in Spring).
export function termDayGroup(termKey, day) {
  const config = termConfig(termKey)
  const group = config.dayGroups.find((g) => g.label.includes(day))
  return group ? group.label : day
}

// The assignable time bands for one day under a term config: each base slot's
// time, plus every run of consecutive base slots up to `maxConsecutiveSlots`
// (e.g. Spring allows 8:00-12:30 = the first two). `maxConsecutiveSlots` of 1
// yields just the base slots. Returns `[{ time, start, end }]`.
export function termSlotOptions(termKey, day) {
  const config = termConfig(termKey)
  const group = config.dayGroups.find((g) => g.label.includes(day))
  if (!group) return []
  const slots = group.slots
  const max = config.maxConsecutiveSlots || 1
  const out = []
  for (let i = 0; i < slots.length; i++) {
    for (let len = 1; len <= Math.min(max, slots.length - i); len++) {
      const start = slots[i].start
      const end = slots[i + len - 1].end
      out.push({ time: bandTime(start, end), start, end })
    }
  }
  return out
}

// Bands may combine consecutive base slots (e.g. 8:00-10:15 + 10:15-12:30 ->
// 8:00-12:30). Build the time string from start/end minutes.
function bandTime(start, end) {
  return `${minutesToHHMM(start)}-${minutesToHHMM(end)}`
}

function minutesToHHMM(min) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

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

// Tokenize one CSV line into fields, honoring double-quoted fields (with
// "" escapes). A trailing-backslash/newline inside a quoted field is not
// supported (registrar feeds are single-line per record).
function csvFields(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields.map((f) => f.trim())
}

// Parse a schedule CSV into offering records. The header may be the round-trip /
// registrar form `dept-prefix,course-number,section,instructor,days,times`
// (optionally an extra `term` column, `F|W|S`) or use alternate synonyms for the
// time column (`time`). Blank `days`/`times` mark an unscheduled offering.
/** @returns {Array<{ prefix: string; number: string; section: string; instructor: string; days: string; time: string; term?: string }>} */
export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/)
  const header = csvFields(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cells = csvFields(line)
    const rec = {}
    header.forEach((h, idx) => {
      rec[h] = (cells[idx] || '').trim()
    })
    const time = rec['times'] != null && rec['times'] !== '' ? rec['times'] : rec['time'] || ''
    const out = {
      prefix: rec['dept-prefix'],
      number: rec['course-number'],
      section: rec['section'],
      instructor: rec['instructor'],
      days: rec['days'],
      time,
    }
    if (rec['term'] != null && rec['term'] !== '') out.term = rec['term']
    rows.push(out)
  }
  return rows
}

// Serialize offerings back to the importable CSV form (an exact round-trip of
// `parseCsv`). `rows` are offering records; an optional `term` per row is written
// when the caller provides it. Header is `dept-prefix,course-number,section,
// instructor,days,times` plus `term` when any non-empty term is present.
export function renderCsv(offerings) {
  const includesTerm = offerings.some((o) => o.term != null && o.term !== '')
  const header = ['dept-prefix', 'course-number', 'section', 'instructor', 'days', 'times']
  if (includesTerm) header.push('term')
  const quote = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [header.join(',')]
  for (const o of offerings) {
    const isTime = o.time != null && o.time !== '' ? o.time : o.times || ''
    const rec = [o.prefix, o.number, o.section, o.instructor, o.days, isTime]
    if (includesTerm) rec.push(o.term || '')
    lines.push(rec.map(quote).join(','))
  }
  return lines.join('\n')
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

// Computes the day-set string for a course after an edit-mode drag. `days` is
// the offering's current day letters (e.g. "MW"), `fromDay` the specific day
// the drag started from, `toGroup` the target slot's day group, `toDay` the
// specific target day. `termKey` selects the term's day groups (defaults to
// Fall's MWF/TR behavior). Rules:
//   1. Different day group -> adopt the target group's full day set
//   2. Same group (or same day / unknown source day) -> keep the current days,
//      only the time changes
//   3. Same group, different day -> swap `fromDay` for `toDay` (deduped and
//      ordered by the week), e.g. "MW" dragged onto Friday becomes "WF"
export function rescheduleDays(days, fromDay, toGroup, toDay, termKey) {
  const config = termConfig(termKey)
  const cur = (days || '').split('').filter((d) => 'MTWRF'.includes(d))
  if (!cur.length) return toGroup
  // The group a set of days belongs to, per this term's groups.
  const groupFor = (set) => {
    for (const g of config.dayGroups) {
      if (set.every((d) => g.label.includes(d))) return g.label
    }
    return toGroup
  }
  const curGroup = groupFor(cur)
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

// Reschedules an offering and recomputes `days` from the drag context
// (`fromDay`/`toDay`/`toGroup`) instead of taking a raw day string.
export function moveOfferingSmart(
  offerings,
  { prefix, number, section },
  { fromDay, toDay, group, time },
  termKey,
) {
  const idx = (offerings || []).findIndex(
    (o) => o.prefix === prefix && o.number === number && o.section === section,
  )
  if (idx < 0) return offerings
  const days = rescheduleDays((offerings[idx] || {}).days, fromDay, group, toDay, termKey)
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

// The drag-and-drop payload contract for moving an offering between slots
// (edit mode). A serialized `{ sid, prefix, number, section, fromDay }` — the
// offering's identity plus the day column the drag started from, so a same-group
// drop can swap that specific day (see `rescheduleDays`). Shared by the schedule
// grid/day views and the planner timeline (which only parses).
export function buildDragPayload(it, fromDay) {
  return JSON.stringify({
    sid: it.sid,
    prefix: it.o.prefix,
    number: it.o.number,
    section: it.o.section,
    fromDay: fromDay || '',
  })
}

export function dragPayloadFrom(e) {
  try {
    return JSON.parse(e.dataTransfer.getData('text/plain'))
  } catch {
    return null
  }
}

// Build derived index once schedule data is available. Offerings with no
// meeting time (blank `days` or `time`) are "unscheduled" (e.g. independent
// studies): they still group by course and instructor but appear only in the
// `unscheduled` list, never on the calendar or in conflict detection. The rest
// are indexed by course / day / slot / instructor.
export function buildIndex(offerings) {
  const byCourse = {}
  const byDay = { M: [], T: [], W: [], R: [], F: [] }
  const bySlot = {}
  const byInstructor = {}
  const unscheduled = []

  const eachItem = (o) => {
    const code = `${o.prefix} ${o.number}`
    const days = (o.days || '').split('').filter((d) => 'MTWRF'.includes(d))
    const t = o.time || ''
    const [startStr, endStr] = t.split('-')
    const start = t ? toMinutes(startStr) : null
    const end = t ? toMinutes(endStr) : null
    return { o, code, sid: o.$sid, sectionLabel: `Section ${o.section}`, start, end, days }
  }

  for (const o of offerings) {
    const item = eachItem(o)
    const scheduled = Boolean(item.o.days && item.o.time && item.start != null && item.end != null)

    if (!byCourse[item.code]) byCourse[item.code] = []
    byCourse[item.code].push(item)

    if (!byInstructor[o.instructor]) byInstructor[o.instructor] = []
    byInstructor[o.instructor].push(item)

    if (!scheduled) {
      unscheduled.push(item)
      continue
    }

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
  unscheduled.sort(compareItems)

  return { byCourse, byDay, bySlot, byInstructor, unscheduled }
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

// The day range to render, computed from the offered blocks so classes with
// arbitrary (early/late) times are visible. Falls back to the standard range
// when nothing is scheduled.
export function calendarDayRange(index) {
  let min = Infinity
  let max = -Infinity
  const walk = (items) => {
    for (const it of items || []) {
      if (it.start < min) min = it.start
      if (it.end > max) max = it.end
    }
  }
  walk(index && index.byDay.M)
  if (min === Infinity) min = DAY_START_MIN
  if (max === -Infinity) max = DAY_END_MIN
  return { start: min, end: max }
}

export function hourMarks(start = DAY_START_MIN, end = DAY_END_MIN) {
  const marks = []
  for (let m = start; m <= end; m += 60) {
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

// The visual filter used while a schedule is in edit/suggest mode. Edit mode
// must always render individual course pills (so the edited schedule's courses
// stay draggable), but a department/instructor filter still holds: when one is
// active its match/color rules apply to everything, exactly like the plain
// views; otherwise every course shows, colored by `colorFn` (the schedule
// color). Returns { active: true, matches, color }.
export function buildEditVisual(mode, depts, instructors, colorFn) {
  const filter = buildFilter(mode, depts, instructors)
  if (filter.active) return filter
  return { active: true, matches: () => true, color: colorFn || (() => '') }
}

// The calendar overlay for a term's pending suggestions: every pending
// suggestion's ops are interpreted against the current term independently, so
// concurrent proposals from different proposers each yield their own overlay
// entries (two departments moving a course into the same slot show two
// proposed blocks). Each entry carries its suggestion id and proposer for
// labeling.
//
// Returns:
//   proposed: [{ offering, kind: 'add' | 'move', from, suggestionId, proposer }]
//     — offered blocks to render (dashed). `offering` carries the proposed
//       days/time; `from` is the current identity for moves.
//   removals: [{ cur, suggestionId, proposer }]
//     — offered removals: markers for the course's current block.
//
// Update ops that don't move the course on the calendar (instructor/section
// changes) are omitted here — they stay visible in the suggestions panel.
export function proposeOverlay(baseOfferings, pendingSuggestions) {
  const baseByKey = new Map()
  for (const o of baseOfferings || []) {
    baseByKey.set(`${o.prefix} ${o.number} ${o.section}`, o)
  }
  const proposed = []
  const removals = []
  for (const sug of pendingSuggestions || []) {
    for (const op of sug.operations || []) {
      if (!op) continue
      if (op.kind === 'add' && op.offering) {
        proposed.push({
          offering: { ...op.offering },
          kind: 'add',
          from: null,
          suggestionId: sug.id,
          proposer: sug.proposer,
        })
      } else if (op.kind === 'update' && op.cur) {
        const cur =
          baseByKey.get(offeringKeyOf(op.cur)) ||
          { ...op.cur, days: '', time: '' }
        const next = { ...cur, ...(op.changes || {}) }
        const moved =
          (next.days || '') !== (cur.days || '') || (next.time || '') !== (cur.time || '')
        if (!moved || !next.days || !next.time) continue
        proposed.push({
          offering: next,
          kind: 'move',
          from: { prefix: cur.prefix, number: cur.number, section: cur.section },
          suggestionId: sug.id,
          proposer: sug.proposer,
        })
      } else if (op.kind === 'remove' && op.cur) {
        removals.push({ cur: { ...op.cur }, suggestionId: sug.id, proposer: sug.proposer })
      }
    }
  }
  return { proposed, removals }
}

function offeringKeyOf(o) {
  return `${o.prefix} ${o.number} ${o.section}`
}
