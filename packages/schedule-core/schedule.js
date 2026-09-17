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

// Whether an offering's meeting pattern is a standard one for the term: all its
// day letters sit in one day group and its `time` band is one of that group's
// assignable bands (compared by minute values — a band's spelling like
// `08:00-09:10` never matters). Anything else (custom times, mixed day groups,
// blank days/time, unparseable or reversed bands) is off-pattern and rendered
// with the distinct off-pattern cue.
export function isStandardPattern(termKey, days, time) {
  if (!days || !time) return false
  const letters = String(days)
    .split('')
    .filter((d) => 'MTWRF'.includes(d))
  if (!letters.length) return false
  const config = termConfig(termKey)
  const group = config.dayGroups.find((g) => letters.every((d) => g.label.includes(d)))
  if (!group) return false
  const band = toBandMinutes(time)
  if (!band) return false
  return termSlotOptions(termKey, group.label[0]).some((s) => s.start === band.start && s.end === band.end)
}

// Parse a time band into minute values — the single parse for every
// time-band decision (standard-pattern test, slot keys, canonical strings), so
// no logic ever re-compares band spellings. Tolerates leading zeros,
// surrounding whitespace, and trailing seconds (`08:00:00`). Returns null for
// blank, unparseable, or reversed bands (end <= start) — callers treat those
// as off-pattern.
function toBandMinutes(time) {
  const s = String(time ?? '')
  const [a, b] = s.split('-')
  if (!a || !b) return null
  const start = toMinutes(a.trim())
  const end = toMinutes(b.trim())
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

// The canonical string form of a band (`8:00-9:10`), used when a band string
// is stored or exported. Valid bands are reformatted; invalid or reversed
// bands pass through unchanged — they stay visible data (rendered off-pattern,
// never silently blanked into "No meeting time").
export function normalizeBand(time) {
  const m = toBandMinutes(time)
  if (!m) return time
  return `${minutesToHHMM(m.start)}-${minutesToHHMM(m.end)}`
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
  if (!time) return 'No meeting time'
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
  const band = toBandMinutes(time)
  return band ? `${day}|${minutesToHHMM(band.start)}-${minutesToHHMM(band.end)}` : `${day}|${time ?? ''}`
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

// Normalize a raw CSV cell: blank/whitespace or a literal NULL (case-
// insensitive) means "no value" — the registrar feed writes NULL where a course
// has no assigned time slot or instructor.
function cellValue(v) {
  const s = String(v ?? '').trim()
  return !s || /^null$/i.test(s) ? '' : s
}

// Split a comma-separated instructor cell into distinct names: whitespace
// tolerated around commas, trimmed, empties dropped, duplicates removed. A
// blank/NULL cell (or NULL token inside a list) is "no instructor". The
// registrar's `secondary_instr` column uses `, ` between names.
function instructorList(cell) {
  const src = cellValue(cell)
  if (!src) return []
  const names = src
    .split(/,\s*/)
    .map((n) => n.trim())
    .filter((n) => n && !/^null$/i.test(n))
  return [...new Set(names)]
}

// The distinct instructors on an offering: the lead (`instructor`) followed by
// the secondary instructors, with empties, literal NULLs, and duplicates
// dropped (a person may appear as both lead and secondary of the same
// offering). Records written before the multi-instructor model carry no
// `secondaryInstructors`.
export function instructorsOf(o) {
  if (!o) return []
  const out = instructorList(o.instructor)
  for (const n of o.secondaryInstructors || []) {
    const name = String(n || '').trim()
    if (name && !/^null$/i.test(name) && !out.includes(name)) out.push(name)
  }
  return out
}

// Parse a schedule CSV into offering records. The header is the round-trip /
// registrar form `dept_prefix,course_number,course_section,instructor,
// secondary_instr,days,times` (optionally an extra `term` column, `F|W|S`) or
// use alternate synonyms for the time column (`time`). The optional
// `secondary_instr` column is a comma-separated list (quoted by the registrar)
// of additional instructors; it becomes the `secondaryInstructors` array.
// Blank/NULL `days`/`times` mark an unscheduled offering.
// A trailing `L` on the course number marks a lab section of that course
// (`166L` is a lab of 166); the lab's sequence is part of the section cell
// (`A2` = section A, lab 2). A lab row with a plain-letter section gets
// labSeq 1; colliding rows (identical `A1` rows serving one lecture) are
// renumbered 1..n in first-seen order so every record stays distinct.
/** @returns {Array<{ id?: string; prefix: string; number: string; section: string; instructor: string; secondaryInstructors: string[]; days: string; time: string; term?: string; lab?: boolean; labSeq?: number }>} */
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
    let time = cellValue(rec['times'] != null && rec['times'] !== '' ? rec['times'] : rec['time'] || '')
    let days = cellValue(rec['days'])
    // The contract only defines scheduled (both set) and unscheduled (both
    // blank) offerings — a row missing either side is unscheduled.
    if (!days || !time) {
      days = ''
      time = ''
    }
    // Store the band in the canonical string form (`8:00-9:10`); anything the
    // registrar sends in another spelling (`08:00-09:10`) normalizes here, and
    // invalid/reversed bands pass through for off-pattern rendering.
    time = normalizeBand(time)
    let number = rec['course_number']
    const out = {
      prefix: rec['dept_prefix'],
      number,
      section: rec['course_section'],
      instructor: cellValue(rec['instructor']),
      secondaryInstructors: instructorList(rec['secondary_instr']),
      days,
      time,
    }
    // `166L` / `166l` -> number `166`, lab. The L is the only lab marker in
    // the course number (the sequence lives in the section cell); anything
    // else — including the legacy `166L2` shape — passes through verbatim.
    const labMatch = number && /^(\d+)[Ll]$/.exec(number)
    if (labMatch) {
      out.number = labMatch[1]
      out.lab = true
    }
    // The lab's sequence is part of the section cell (`A2` -> section A, lab
    // 2). Lectures keep their section verbatim — digits in a section never
    // make a non-lab row a lab.
    if (out.lab && out.section) {
      const secMatch = /^([A-Za-z])(\d+)$/.exec(out.section)
      if (secMatch) {
        out.section = secMatch[1]
        out.labSeq = Number(secMatch[2])
      }
    }
    if (rec['term'] != null && rec['term'] !== '') out.term = rec['term']
    rows.push(out)
  }
  // Deterministic labSeq: plain-letter lab sections default to 1, and
  // colliding rows (two identical `A1` rows for one lecture) are renumbered
  // in first-seen order so every lab record stays distinct.
  const labCounts = new Map()
  for (const r of rows) {
    if (!r.lab) continue
    const key = `${r.prefix}|${r.number}|${r.section}`
    const used = labCounts.get(key) || new Set()
    let n = r.labSeq != null ? r.labSeq : 1
    while (used.has(n)) n++
    used.add(n)
    labCounts.set(key, used)
    r.labSeq = n
  }
  // Stable per-row identity: rows sharing a section tuple (split meetings,
  // e.g. MW and R each at their own band) get distinct content ids, so the
  // diff/move/edit machinery never confuses them. Re-parsing the same file
  // yields the same ids.
  assignOfferingIds(rows)
  return rows
}

// The course-number cell for a record: labs always re-append the L (`166L`);
// lectures write the plain number. The lab's sequence is written into the
// section cell by `offeringSectionLabel`.
export function courseNumberLabel(o) {
  if (!o || !o.lab) return o && o.number ? o.number : ''
  return `${o.number}L`
}

// The registrar-shaped course code for a record (`BIO 166`, `BIO 166L`): the
// code renderers display (the schedule/client `code` is the parent's plain
// `BIO 166`). Labs are identified by the L in the course number, exactly as
// the registrar writes them — no separate lab marker is needed.
export function offeringCodeLabel(o) {
  if (!o) return ''
  return `${o.prefix} ${courseNumberLabel(o)}`
}

// The section cell for a record: labs carry their sequence in the section
// (`A2` = section A, lab 2), lectures write the plain section letter.
export function offeringSectionLabel(o) {
  if (!o) return ''
  return o.lab && o.labSeq ? `${o.section}${o.labSeq}` : o.section || ''
}

// Serialize offerings back to the importable CSV form (an exact round-trip of
// `parseCsv`). `rows` are offering records; an optional `term` per row is written
// when the caller provides it. Header is `dept_prefix,course_number,
// course_section,instructor,secondary_instr,days,times` plus `term` when any
// non-empty term is present.
export function renderCsv(offerings) {
  const includesTerm = offerings.some((o) => o.term != null && o.term !== '')
  const header = [
    'dept_prefix',
    'course_number',
    'course_section',
    'instructor',
    'secondary_instr',
    'days',
    'times',
  ]
  if (includesTerm) header.push('term')
  const quote = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [header.join(',')]
  for (const o of offerings) {
    const isTime = o.time != null && o.time !== '' ? o.time : o.times || ''
    const rec = [
      o.prefix,
      courseNumberLabel(o),
      offeringSectionLabel(o),
      o.instructor,
      (o.secondaryInstructors || []).join(', '),
      o.days,
      isTime,
    ]
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

// The stable identity key of an offering record: prefix/number/section plus
// the lab marker (and labSeq), so a lab section A is never confused with the
// lecture section A it mirrors. Every identity match (update/remove/move/
// diff/overlay) uses this — except rows carrying a content-derived `id`,
// which match on the id first (see `matchOffering`), so two rows sharing the
// same section tuple (split meetings: MW and R each at their own time) stay
// distinguishable.
export function offeringKey(o) {
  if (!o) return ''
  return `${o.prefix || ''}|${o.number || ''}|${o.section || ''}${o.lab ? '|L' : ''}${o.lab ? o.labSeq || '' : ''}`
}

// Deterministic content hash — the stable `id` producers assign at import or
// creation (the `id`-preferred key in the diff machinery). Two rows with the
// same section tuple but different day/time bands hash differently, so split
// meetings stay distinct identities; `assignOfferingIds` suffixes identical
// duplicates so even two exactly-equal rows differ.
export function offeringIdFor(o) {
  const s = [
    o.prefix || '',
    o.number || '',
    o.section || '',
    o.lab ? 'L' : '',
    o.lab ? o.labSeq || '' : '',
    o.days || '',
    o.time || '',
  ].join('|')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return 'o' + (h >>> 0).toString(36)
}

// Fills `id` on rows that don't carry one (legacy data loaded from storage or
// a feed), deterministically from the row's content. Rows that hash the same
// (two identical rows for one section) get a first-seen `-1`/`-2` suffix so
// every row stays a distinct identity; existing ids are never rewritten, so
// editing a row keeps its id across sessions and re-syncs. Mutates `rows` and
// returns it.
export function assignOfferingIds(rows) {
  if (!Array.isArray(rows)) return rows
  const missing = rows.filter((r) => !r || r.id == null || r.id === '')
  if (!missing.length) return rows
  const counts = new Map()
  for (const r of missing) {
    const base = offeringIdFor(r)
    counts.set(base, (counts.get(base) || 0) + 1)
  }
  const seen = new Map()
  for (const r of missing) {
    const base = offeringIdFor(r)
    if (counts.get(base) > 1) {
      const n = (seen.get(base) || 0) + 1
      seen.set(base, n)
      r.id = `${base}-${n}`
    } else {
      r.id = base
    }
  }
  return rows
}

// Whether `o` is the exact row `cur` targets: by content id when present
// (split-meeting rows, distinct ids), else by the section tuple. Legacy callers
// that pass tuple-only `cur` keep matching — the fallback.
export function matchOffering(o, cur) {
  if (cur && cur.id != null && cur.id !== '') return Boolean(o) && o.id === cur.id
  return offeringKey(o) === offeringKey(cur)
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
// (`fromDay`/`toDay`/`toGroup`) instead of taking a raw day string. `cur` may
// carry an `id` (from the drag payload) so a row sharing its section tuple
// with a sibling (split meetings) is the one that moves.
export function moveOfferingSmart(
  offerings,
  { prefix, number, section, lab = false, labSeq = 0, id = '' },
  { fromDay, toDay, group, time },
  termKey,
) {
  const cur = { prefix, number, section, lab, labSeq, id }
  const idx = (offerings || []).findIndex((o) => matchOffering(o, cur))
  if (idx < 0) return offerings
  const days = rescheduleDays((offerings[idx] || {}).days, fromDay, group, toDay, termKey)
  const next = offerings.slice()
  next[idx] = { ...next[idx], days, time }
  return next
}

// The next free labSeq for a lecture's labs (max existing + 1), so a second
// lab for the same lecture section never collides with the first.
export function nextLabSeq(offerings, prefix, number, section) {
  let max = 0
  for (const o of offerings || []) {
    if (o.lab && o.prefix === prefix && o.number === number && o.section === section) {
      max = Math.max(max, o.labSeq || 0)
    }
  }
  return max + 1
}

// Rewrites fields (instructor / section / days / time) on the offering matching
// `cur` (its current identity, since `section` may itself be edited). Returns a
// new array, or the same array when nothing matches. A half-set meeting time
// (`days` without `time` or vice versa) is normalized to the no-meeting-time
// shape (both blank), since the contract only defines scheduled (both set) and
// unscheduled (both blank) offerings. Renaming a lecture's section letter also
// renames its labs' letters (lab letters mirror the lecture's), re-deriving
// labSeq so the renamed labs never collide with labs already on the target
// letter.
export function updateOfferingInSchedule(offerings, cur, changes) {
  const list = offerings || []
  const idx = list.findIndex((o) => matchOffering(o, cur))
  if (idx < 0) return list
  const next = list.slice()
  const merged = { ...next[idx], ...changes }
  if (!merged.days || !merged.time) {
    merged.days = ''
    merged.time = ''
  }
  next[idx] = merged
  if (!cur.lab && changes.section && changes.section !== cur.section) {
    // Rename the lecture's labs to the new letter. labSeq is re-derived
    // (after the target letter's existing labs) so renamed labs never
    // collide with labs already on the new letter.
    const moved = []
    for (let i = 0; i < next.length; i++) {
      const o = next[i]
      if (o.lab && o.prefix === cur.prefix && o.number === cur.number && o.section === cur.section)
        moved.push(i)
    }
    if (moved.length) {
      let seq = 0
      for (const o of next) {
        if (o.lab && o.prefix === cur.prefix && o.number === cur.number && o.section === changes.section) {
          seq = Math.max(seq, o.labSeq || 0)
        }
      }
      for (const i of moved) {
        seq++
        next[i] = { ...next[i], section: changes.section, labSeq: seq }
      }
    }
  }
  return next
}

// The default landing slot for a newly-added course (the first MWF band).
export const DEFAULT_SLOT = {
  days: SLOT_BLOCKS[0].label,
  time: SLOT_BLOCKS[0].slots[0].time,
}

// The first unused section letter for a course, so a hand-added section never
// collides with an existing one of the same course. Lab sections are ignored —
// their letters mirror the lecture's, so they never consume a lecture letter.
export function nextSectionLetter(offerings, prefix, number) {
  const used = new Set()
  for (const o of offerings || []) {
    if (o.lab) continue
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

// Removes the offering matching `cur` (its full identity — the content `id`
// when present, else prefix/number/section and the lab marker) from a
// schedule's `offerings` array. Removing a lecture section also removes its
// labs: a lab without its lecture is meaningless. A split-meeting row (two
// rows sharing a section) removes only that row. Returns a new array, or the
// same array when nothing matches.
export function removeOfferingFromSchedule(offerings, cur) {
  const list = offerings || []
  const next = list.filter((o) => {
    if (matchOffering(o, cur)) return false
    if (
      !cur.lab &&
      o.lab &&
      o.prefix === cur.prefix &&
      o.number === cur.number &&
      o.section === cur.section
    ) {
      return false
    }
    return true
  })
  return next.length === list.length ? list : next
}

// The drag-and-drop payload contract for moving an offering between slots
// (edit mode). A serialized `{ sid, id, prefix, number, section, lab, labSeq,
// fromDay }` — the offering's identity (its content `id` so a split-meeting
// row moves itself, not its sibling) plus the day column the drag started
// from, so a same-group drop can swap that specific day (see
// `rescheduleDays`). Shared by the schedule grid/day views and the planner
// timeline (which only parses).
export function buildDragPayload(it, fromDay) {
  return JSON.stringify({
    sid: it.sid,
    id: it.o.id || '',
    prefix: it.o.prefix,
    number: it.o.number,
    section: it.o.section,
    lab: it.o.lab || false,
    labSeq: it.o.labSeq || 0,
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
// are indexed by course / day / slot / instructor (every instructor — the lead
// plus any secondary — so filters and the per-instructor view cover all).
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
    // Lab sections label with their registrar section (letter + sequence:
    // `Lab A2`); lectures label with the plain section letter.
    const sectionLabel = o.lab ? `Lab ${offeringSectionLabel(o)}` : `Section ${o.section}`
    return { o, code, sid: o.$sid, sectionLabel, start, end, days, lab: o.lab, instructors: instructorsOf(o) }
  }

  for (const o of offerings) {
    const item = eachItem(o)
    const scheduled = Boolean(item.o.days && item.o.time && item.start != null && item.end != null)

    if (!byCourse[item.code]) byCourse[item.code] = []
    byCourse[item.code].push(item)

    for (const name of item.instructors) {
      if (!byInstructor[name]) byInstructor[name] = []
      byInstructor[name].push(item)
    }

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

// Shared vertical time scale for the weekly calendar (px per minute). 1.5
// keeps time-proportional sizing while giving a 70-minute class ~105px — room
// for the header plus a few touch-target-sized course rows instead of one.
export const DAY_START_MIN = 480 // 8:00
export const DAY_END_MIN = 960 // 16:00
export const PX_PER_MIN = 1.5

// The day range to render: anchored to the term's standard hours (Fall/Winter
// 8:00-16:00, Spring 8:00-17:00) so an off-pattern early/late class never
// stretches the whole grid or hides normal classes. Off-range parts of
// off-pattern classes are clamped by `clipBand` instead.
export function calendarDayRange(termKey) {
  const config = termConfig(termKey)
  return { start: config.dayStart, end: config.dayEnd }
}

// Clamps a band to the rendered day range, so an off-pattern class starting
// before or ending after the ruled hours keeps its in-range portion. Returns
// null when nothing of the band falls inside the range.
export function clipBand(band, range) {
  const start = Math.max(band.start, range.start)
  const end = Math.min(band.end, range.end)
  if (end <= start) return null
  return {
    start,
    end,
    clippedTop: band.start < range.start,
    clippedBottom: band.end > range.end,
  }
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

// Group a single weekday's offerings into blocks. A band is standard for the
// day when its time is one of the day-group's assignable bands; every course
// in a band shares the band's minutes, so a band is uniformly standard or
// off-pattern — blocks never mix patterns, and each block's count, custom
// flag, and title stay coherent. Off-pattern bands (custom times, or a band
// belonging to another day group) render as the grid's "custom" rail; a
// course that coincides with a standard band of the day renders in the normal
// block even when its overall day pattern is unusual (an MR course at an
// MWF-band time merges into Monday's block; on Thursday it is a rail).
// Blocks sort by start time with longer spans first, so a contained rail
// paints above the spanning one that touches it.
// Returns [{ time, start, end, items, offPattern }].
export function daySlotBlocks(day, index, termKey = 'F') {
  if (!index || !index.byDay[day]) return []
  const byTime = {}
  for (const item of index.byDay[day]) {
    const key = item.o.time
    if (!byTime[key]) {
      byTime[key] = { time: item.o.time, start: item.start, end: item.end, items: [] }
    }
    byTime[key].items.push(item)
  }
  const bands = termSlotOptions(termKey, day)
  const out = []
  for (const b of Object.values(byTime)) {
    out.push({ ...b, offPattern: !bands.some((s) => s.start === b.start && s.end === b.end) })
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end)
}

// Inline style for an absolutely-positioned block on the calendar.
export function blockStyle(slot) {
  return {
    top: (slot.start - DAY_START_MIN) * PX_PER_MIN + 'px',
    height: (slot.end - slot.start) * PX_PER_MIN + 'px',
  }
}

// Assign time blocks to side-by-side lanes so overlapping bands stay readable
// (the day timeline's generalization of the grid's bar/rail split). Blocks
// sorted by start time (longer spans first on ties); each takes the first lane
// whose last occupant ends at-or-before its start — touching bands share a
// lane, so consecutive standard slots stay stacked flush — else a new lane is
// opened. Lanes are scoped to overlap clusters: once a gap opens (no active
// lane reaches the next block's start), the cluster's lane count is fixed and
// later blocks start fresh at full width.
//
// Within a cluster, blocks order by their `laneRank` (default 0) before start
// time, so a caller can pin a class of blocks to the leftmost lanes — the day
// timeline ranks standard bands 0 and off-pattern/custom bands 1, matching the
// grid's rails, which anchor right. Returns a new array with `lane`
// and `laneCount` on every block (`laneCount` = that cluster's share of lanes,
// for symmetric widths).
export function assignLanes(blocks) {
  const sorted = [...(blocks || [])].sort((a, b) => a.start - b.start || b.end - a.end)
  const clusters = []
  let cur = []
  let clusterEnd = -Infinity
  for (const b of sorted) {
    if (b.start >= clusterEnd) {
      if (cur.length) clusters.push(cur)
      cur = []
      clusterEnd = -Infinity
    }
    cur.push(b)
    clusterEnd = Math.max(clusterEnd, b.end)
  }
  if (cur.length) clusters.push(cur)
  const out = []
  for (const cluster of clusters) {
    const ordered = [...cluster].sort(
      (a, b) => (a.laneRank || 0) - (b.laneRank || 0) || a.start - b.start || b.end - a.end,
    )
    const laneEnds = []
    for (const b of ordered) {
      let lane = laneEnds.findIndex((end) => end <= b.start)
      if (lane < 0) {
        lane = laneEnds.length
        laneEnds.push(b.end)
      } else {
        laneEnds[lane] = b.end
      }
      out.push({ ...b, lane })
    }
    const count = laneEnds.length
    for (let i = out.length - cluster.length; i < out.length; i++) out[i].laneCount = count
  }
  return out
}

// The hour range a single-day timeline renders: the term's standard range at
// minimum, expanded outward (snapped to half-hours) to cover the day's
// earliest and latest meetings, so an early/evening custom class renders in
// full instead of clipping. A day with no meetings renders the standard range.
export function dayTimelineRange(termKey, index, day) {
  const base = calendarDayRange(termKey)
  if (!index || !index.byDay || !index.byDay[day]) return base
  let min = Infinity
  let max = -Infinity
  for (const it of index.byDay[day]) {
    if (it.start == null || it.end == null) continue
    if (it.start < min) min = it.start
    if (it.end > max) max = it.end
  }
  if (!Number.isFinite(min)) return base
  return {
    start: Math.min(base.start, Math.floor(min / 30) * 30),
    end: Math.max(base.end, Math.ceil(max / 30) * 30),
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

// The one-name label for a course chip on the busy grid: the lead instructor's
// brief name, with a `*` appended when other instructors are also attached so a
// team-taught course doesn't crowd the view. The full roster is available via
// `instructorsOf(o)` for tooltips.
export function instructorChip(o) {
  const names = instructorsOf(o)
  if (!names.length) return { label: '', hasOthers: false }
  const label = briefInstructor(names[0])
  const hasOthers = names.length > 1
  return { label: hasOthers ? `${label}*` : label, hasOthers }
}

// Distinct colors assigned deterministically per department. Every entry keeps
// a WCAG AA contrast ratio >= 4.5:1 against white so the 10-12px white text
// rendered on them (calendar rows, filter chips, pills) stays readable.
const DEPT_PALETTE = [
  '#1b4965',
  '#bf360c',
  '#7b2d8b',
  '#00695c',
  '#c62828',
  '#01579b',
  '#8e24aa',
  '#2e7d32',
  '#b45309',
  '#5d4037',
  '#d81b60',
  '#3949ab',
  '#004d40',
  '#6a1b9a',
  '#9a3412',
  '#33691e',
  '#4527a0',
  '#ad1457',
  '#1565c0',
  '#1b5e20',
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
  '#9a3412',
  '#7b1d8b',
  '#004d40',
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
      // An item counts when any of its instructors (lead or secondary) is
      // selected; it colors by the first selected one it matches, so a
      // team-taught block takes the color of the person you filtered on.
      matches: (it) => (it.instructors || []).some((n) => instructors.includes(n)),
      color: (it) => {
        const hit = (it.instructors || []).find((n) => instructors.includes(n))
        return colorForInstructor(hit || it.o.instructor || (it.instructors || [])[0] || '')
      },
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
// Pure: the caller filters which ops are still live (the store passes only
// unresolved entries' payloads).
export function proposeOverlay(baseOfferings, pendingSuggestions) {
  const baseByKey = new Map()
  for (const o of baseOfferings || []) {
    baseByKey.set(offeringKey(o), o)
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
        const cur = baseByKey.get(offeringKeyOf(op.cur)) || { ...op.cur, days: '', time: '' }
        const next = { ...cur, ...(op.changes || {}) }
        const moved = (next.days || '') !== (cur.days || '') || (next.time || '') !== (cur.time || '')
        if (!moved || !next.days || !next.time) continue
        proposed.push({
          offering: next,
          kind: 'move',
          from: {
            prefix: cur.prefix,
            number: cur.number,
            section: cur.section,
            lab: cur.lab,
            labSeq: cur.labSeq,
          },
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
  return offeringKey(o)
}
