// Schedule domain model + helpers.
// Data source is sample-schedule.csv parsed in the browser.

export const WEEKDAYS = ['M', 'T', 'W', 'R', 'F']
export const WEEKDAY_NAMES = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', R: 'Thursday', F: 'Friday' }

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
    const h12 = (min / 60) % 12 || 12
    const hour = Math.floor(h12)
    const mm = String(min % 60).padStart(2, '0')
    const ap = min < 720 ? 'AM' : 'PM'
    return `${hour}:${mm} ${ap}`
  }
  return `${fmt(a)} - ${fmt(b)}`
}

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
    return { o, code, sectionLabel: `Section ${o.section}`, start, end, days }
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

  return { byCourse, byDay, bySlot, byInstructor }
}

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
  return result
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

export function slotKey(day, time) {
  return `${day}|${time}`
}

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

// Sorted list of distinct instructors present in the schedule.
export function instructorsInSchedule(index) {
  if (!index) return []
  return Object.keys(index.byInstructor).sort()
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
