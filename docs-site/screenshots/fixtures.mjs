// Named, UI-independent data seeds for the screenshot harness.
//
// A fixture talks to the scratch-DB server through the Playwright context's
// API request (same cookie jar as the page), signs in via the username auth
// route, and creates the schedules / terms / directory users a shot needs.
// It returns tokens that the manifest's route template interpolates —
// `<id>`, `<code>`, `<instructor>` — so the manifest stays declarative.
//
// Demo data only: fictional usernames, courses drawn from the real (public)
// catalog so names resolve. Never the live DB.

const TERM = 'F'

// Course codes are real catalog codes (so names/instructors render); times are
// the app's stored 24h compact form ("8:00-9:10"), formatted for display by
// the views.
const offering = (prefix, number, section, days, time, instructor, extra = {}) => ({
  prefix,
  number,
  section,
  days,
  time,
  instructor,
  secondaryInstructors: [],
  ...extra,
})

// A conflict-free, populated Fall: a mix of MWF/TR patterns across departments
// so the grid, day, slot, and instructor views all have real content.
const POPULATED = [
  offering('BIO', '165', 'A', 'MWF', '8:00-9:10', 'Smith'),
  offering('CS', '220', 'A', 'MWF', '9:20-10:30', 'Jones'),
  offering('MAT', '121', 'A', 'MWF', '10:40-11:50', 'Lee'),
  offering('PSY', '111', 'A', 'TR', '8:00-9:45', 'Nguyen'),
  offering('ENG', '113', 'A', 'TR', '10:00-11:45', 'Garcia'),
  offering('HIS', '160', 'A', 'MWF', '12:00-13:10', 'Brown'),
  offering('CHE', '160', 'A', 'MWF', '13:20-14:30', 'Patel'),
  offering('ECO', '113', 'A', 'TR', '12:20-14:05', 'Adams'),
]

async function login(request, username) {
  const res = await request.post('/api/auth/login', { data: { username } })
  if (!res.ok()) throw new Error(`login ${username} failed: ${res.status()}`)
}

async function createSchedule(request, { name, year = '', owner, visibility, suggestMode, offerings = [] }) {
  await login(request, owner)
  const created = await request.post('/api/schedules', { data: { name, year } })
  if (!created.ok()) throw new Error(`create "${name}" failed: ${created.status()}`)
  const { schedule } = await created.json()
  if (offerings.length) {
    const put = await request.put(`/api/schedules/${schedule.id}/terms/${TERM}`, {
      data: { offerings },
    })
    if (!put.ok()) throw new Error(`populate "${name}" failed: ${put.status()}`)
  }
  const patch = {}
  if (visibility) patch.visibility = visibility
  if (suggestMode) patch.suggestMode = suggestMode
  if (Object.keys(patch).length) {
    const res = await request.patch(`/api/schedules/${schedule.id}`, { data: patch })
    if (!res.ok()) throw new Error(`share "${name}" failed: ${res.status()}`)
  }
  return schedule
}

async function setDirectory(request, username, { displayName, departments }) {
  const res = await request.post('/api/admin/users', { data: { username, displayName, departments } })
  if (!res.ok()) throw new Error(`directory ${username} failed: ${res.status()}`)
}

// `request` is the Playwright APIRequestContext (context.request); it shares
// cookies with the page, so capture re-logs in as the entry's `as` afterwards.
export const fixtures = {
  // Registrar's populated Fall 2026 — the workhorse for grid/views/add/csv.
  populated: async (request) => {
    const schedule = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      offerings: POPULATED,
    })
    return { id: schedule.id }
  },

  // The "Your schedules" page: an own schedule plus a public one owned by
  // someone else, so the "Your schedules" and "Public" sections both populate.
  manage: async (request) => {
    const own = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      offerings: POPULATED,
    })
    await createSchedule(request, {
      name: 'Advising sample',
      owner: 'advisor',
      visibility: 'public',
      offerings: POPULATED.slice(0, 4),
    })
    return { id: own.id }
  },

  // Where courses hide: a normal pair, a no-meeting course, a custom time
  // inside the calendar's hours (a dashed rail), and one past closing time
  // (only reachable through the "No meeting times" strip).
  hiding: async (request) => {
    const schedule = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      offerings: [
        offering('BIO', '165', 'A', 'MWF', '8:00-9:10', 'Smith'),
        offering('CS', '220', 'A', 'MWF', '9:20-10:30', 'Jones'),
        offering('BIO', '185', 'A', '', '', 'Smith'),
        offering('ENG', '161', 'A', 'MW', '14:00-15:00', 'Garcia'),
        offering('PSY', '201', 'A', 'M', '18:00-18:50', 'Nguyen'),
      ],
    })
    return { id: schedule.id }
  },

  // Two courses meeting at the same time with the same instructor: a
  // student-side conflict for CS 220 and a double-booking for Smith.
  conflicts: async (request) => {
    const schedule = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      offerings: [
        offering('CS', '220', 'A', 'MWF', '9:20-10:30', 'Smith'),
        offering('MAT', '121', 'A', 'MWF', '9:20-10:30', 'Smith'),
        offering('BIO', '165', 'A', 'MWF', '10:40-11:50', 'Jones'),
      ],
    })
    return { id: schedule.id, code: 'CS 220', instructor: 'Smith' }
  },

  // A lecture with no lab yet, so the editor's "Add lab section" action shows.
  'lab-lecture': async (request) => {
    const schedule = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      offerings: [offering('BIO', '165', 'A', 'MWF', '10:40-11:50', 'Smith')],
    })
    return { id: schedule.id, code: 'BIO 165' }
  },

  // A public schedule the advisor may propose on, for the suggest-session shot.
  suggest: async (request) => {
    const schedule = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      visibility: 'public',
      suggestMode: 'public',
      offerings: POPULATED,
    })
    return { id: schedule.id }
  },

  // Registrar's schedule with a pending proposal from the advisor, so the
  // owner's suggestions panel has something to review.
  'suggest-pending': async (request) => {
    const schedule = await createSchedule(request, {
      name: 'Fall 2026',
      year: '2026-27',
      owner: 'registrar',
      visibility: 'public',
      suggestMode: 'public',
      offerings: POPULATED,
    })
    await setDirectory(request, 'advisor', { displayName: 'A. Advisor', departments: ['MAT', 'CS'] })
    await login(request, 'advisor')
    const res = await request.post(`/api/schedules/${schedule.id}/suggestions`, {
      data: {
        term: TERM,
        baseVersion: 0,
        note: 'MAT 121 to TR, and add CS 223.',
        operations: [
          {
            kind: 'update',
            cur: { prefix: 'MAT', number: '121', section: 'A' },
            changes: { instructor: 'Nguyen', days: 'TR', time: '10:00-11:45' },
          },
          {
            kind: 'add',
            offering: offering('CS', '223', 'A', 'TR', '12:20-14:05', 'Jones'),
          },
        ],
      },
    })
    if (!res.ok()) throw new Error(`propose on "${schedule.name}" failed: ${res.status()}`)
    return { id: schedule.id }
  },
}
