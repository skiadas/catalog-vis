// The screenshot manifest — "which PNG represents which state of the app".
//
// One entry per committed screenshot in docs-site/public/screenshots/. Docs
// reference an entry by its `file` through the <Shot file="…" /> component;
// the Vitepress build (docs-site/.vitepress/config.mjs, via checkDocsSite)
// fails if a <Shot> names no entry or an entry's PNG is missing on disk, so a
// stale name can never embed a dead image. Regenerate with `npm run docs:shots`
// (docs-site/screenshots/capture.mjs) against a fresh scratch-DB server.
//
// Entry shape:
//   file      stable name the docs reference
//   app       launcher | schedule | browse | planner (only schedule is captured)
//   as        demo identity that signs in (fixtures create it)
//   route     app URL, with <token>s interpolated from the fixture's return
//   seed      named DATA fixture (fixtures.mjs)
//   steps     declarative UI state that is not in the URL (dialogs, menus)
//   fullPage  capture the whole scrollable page, not just the viewport
//   selector  crop the shot to this element (a zoom-in), instead of the viewport
//   padding   px of margin around `selector` (default 12)
//   deviceScaleFactor  device-pixel ratio, for a crisp small crop (default 1)
//   alt       accessible description (rendered by <Shot>)
//   caption   figure caption
//
// Most schedule states are plain routes (the UX route redesign made them so);
// `steps` only cover dialogs/menus. A shot is written only if every `assert`
// passed, so "this PNG = this state" is a checked claim.

export const entries = [
  {
    file: 'browse-programs.png',
    app: 'browse',
    route: '/#/',
    alt: 'The Browse app listing Hanover College academic programs',
    caption: 'Browse — the program and course catalog.',
  },
  {
    file: 'schedule-overview.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/',
    seed: 'populated',
    steps: [{ act: 'assert', text: 'Fall' }],
    alt: 'The weekly grid with colored course blocks, the term buttons, and the schedule pills',
    caption: 'The week at a glance — one colored block per meeting.',
  },
  {
    file: 'schedule-your-schedules.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/schedules',
    seed: 'manage',
    steps: [{ act: 'assert', text: 'New schedule' }],
    alt: 'The Your schedules page: own schedules, shared schedules, and public ones',
    caption: 'Your schedules — everything you own or can see.',
  },
  {
    file: 'schedule-access.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/schedule/<id>/access',
    seed: 'populated',
    steps: [{ act: 'assert', text: 'Who can see this schedule?' }],
    alt: 'The Access dialog, choosing who can see and who can suggest changes',
    caption: 'Sharing: who can see it, and who can propose changes.',
  },
  {
    file: 'schedule-day.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/day/M',
    seed: 'populated',
    steps: [{ act: 'assert', text: 'Monday' }],
    alt: 'A single day on a vertical timeline, with each meeting placed by time',
    caption: 'The day view — one day, in order.',
  },
  {
    file: 'schedule-instructor.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/instructor/Smith',
    seed: 'populated',
    steps: [{ act: 'assert', text: 'Weekly timetable' }],
    alt: "One instructor's weekly timetable",
    caption: "The instructor view — one person's week.",
  },
  {
    file: 'schedule-conflicts-course.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/course/CS%20220',
    seed: 'conflicts',
    steps: [{ act: 'assert', text: 'Conflicts' }],
    alt: "The course-conflicts view, listing a course's offerings (with seat counts) that overlap another",
    caption: 'Course conflicts — everything that collides with one course.',
  },
  {
    file: 'schedule-conflicts-instructor.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/instructor/Smith',
    seed: 'conflicts',
    steps: [{ act: 'assert', text: 'double-booked' }],
    alt: 'The instructor view flagging a double-booked teacher',
    caption: 'Instructor view — double-bookings are flagged in red.',
  },
  {
    file: 'schedule-no-meeting.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/',
    seed: 'hiding',
    steps: [
      { act: 'assert', text: 'No meeting times' },
      { act: 'assert', text: 'custom' },
    ],
    fullPage: true,
    alt: 'The grid showing a dashed custom rail, with the No meeting times strip below it',
    caption: 'Courses that fall outside the standard times: a dashed "custom" rail, or the strip below.',
  },
  {
    file: 'schedule-pill-bubble.png',
    app: 'schedule',
    as: 'advisor',
    route: '/#/schedules',
    seed: 'suggest',
    steps: [
      // Show the public (registrar-owned) schedule, then return to the grid so
      // the pill — with the suggest bubble, and no pencil (not the owner) —
      // renders. A non-owned schedule is not selected by default.
      { act: 'click', role: 'button', name: 'Show All depts 2027-2028' },
      { act: 'goto', route: '/#/' },
      { act: 'assert', role: 'button', name: 'Suggest changes for All depts 2027-2028' },
    ],
    selector: '.schedule-pill',
    padding: 8,
    deviceScaleFactor: 3,
    alt: 'A close-up of the schedule pill, with the speech-bubble button that starts a suggest session',
    caption: 'The speech bubble on the schedule pill starts a suggest session.',
  },
  {
    file: 'schedule-suggest-session.png',
    app: 'schedule',
    as: 'advisor',
    route: '/#/?mode=suggest&id=<id>',
    seed: 'suggest',
    steps: [{ act: 'assert', text: 'Suggesting' }],
    alt: 'A suggest session: the Suggesting bar with the Propose changes button and the Leave exit',
    caption: 'Suggesting — your changes wait as a draft until the owner approves.',
  },
  {
    file: 'schedule-add-course.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/?mode=edit&id=<id>',
    seed: 'populated',
    steps: [
      { act: 'click', role: 'button', name: '＋ Add course' },
      { act: 'assert', text: 'Add a course to' },
    ],
    alt: 'The Add a course dialog with a search box and matching sections',
    caption: 'Adding a course: search by code or name, then pick a section.',
  },
  {
    file: 'schedule-course-editor.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/schedule/<id>/course/CS%20220/edit',
    seed: 'populated',
    steps: [{ act: 'assert', text: 'Edit CS 220' }],
    alt: 'The course editor: section, title, seats, instructor, days, and meeting time',
    caption: 'The course editor — every setting for one section.',
  },
  {
    file: 'schedule-split-meeting.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/schedule/<id>/course/MUS%20001/edit',
    seed: 'split-meeting',
    steps: [{ act: 'assert', text: 'This section also meets:' }],
    alt: 'A section editor with two meeting times: an Add another meeting time button and a note listing the other meeting',
    caption: 'A section can meet more than once — add another meeting time and set each separately.',
  },
  {
    file: 'schedule-add-lab.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/schedule/<id>/course/BIO%20165/edit',
    seed: 'lab-lecture',
    steps: [
      { act: 'assert', text: 'Edit BIO 165' },
      { act: 'click', role: 'button', name: 'Add lab section' },
      // The editor switches to the new lab so its meeting time can be set
      // right away — no dragging (the grid is behind the modal).
      { act: 'assert', text: 'Edit BIO 165L A1' },
    ],
    alt: "The lab's own editor after adding it: section A1, ready for a meeting time",
    caption: 'Adding a lab opens its editor — give it a time and save.',
  },
  {
    file: 'schedule-copy-courses.png',
    app: 'schedule',
    as: 'advisor',
    route: '/#/?mode=suggest&id=<id>',
    seed: 'copy-suggest',
    steps: [
      { act: 'click', role: 'button', name: 'Copy courses…' },
      { act: 'assert', text: 'Copy courses into' },
      {
        act: 'custom',
        run: async (page) => {
          // Leave MUS selected (untick CS) and open the review step, so the shot
          // shows the candidate list with its new/update tags and bulk select.
          const modal = page.locator('.modal[aria-labelledby="schedule-copy-title"]')
          await modal.locator('.schedule-copy-prefixes button', { hasText: 'CS' }).click()
          await modal.getByText('1 new · 1 updated').waitFor({ timeout: 10_000 })
          await modal.getByRole('button', { name: 'Review 2 courses' }).click()
          await modal.getByText('2 of 2 selected').waitFor({ timeout: 10_000 })
        },
      },
    ],
    alt: 'The Copy courses review step in a suggest session: each matching course with a checkbox and a new or update tag, plus Select all and Deselect all',
    caption: 'Copy courses — review the courses from a past schedule before copying them.',
  },
  {
    file: 'schedule-table.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/table',
    seed: 'populated',
    steps: [{ act: 'assert', text: 'Read-only' }],
    alt: 'The table view: one compact row per offering with departments and instructors filters and columns for title, instructor, meeting, seats, core areas, and schedule',
    caption: 'The table view — one row per offering, ready for in-place edits.',
  },
  {
    file: 'schedule-table-edit.png',
    app: 'schedule',
    as: 'advisor',
    route: '/#/table?mode=suggest&id=<id>',
    seed: 'suggest',
    steps: [
      {
        act: 'assert',
        text: 'Suggesting — edits are limited to your departments and become proposals.',
      },
    ],
    alt: "The table view in a suggest session: editable cells on the advisor's department rows",
    caption: "The table view in a suggest session — your department's cells edit in place.",
  },
  {
    file: 'schedule-proposals.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/schedule/<id>/proposals',
    seed: 'suggest-pending',
    steps: [{ act: 'assert', text: 'Suggested changes' }],
    alt: 'The Suggested changes panel with pending proposals to approve or reject',
    caption: 'The owner reviews each proposed change.',
  },
  {
    file: 'schedule-proposals-grid.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/',
    seed: 'suggest-pending',
    steps: [
      { act: 'assert', role: 'button', name: 'Show proposals' },
      {
        act: 'custom',
        run: async (page) => {
          await page.locator('.filter-offering.proposed').first().waitFor({ timeout: 10_000 })
          await page.locator('.filter-offering.removed').first().waitFor({ timeout: 10_000 })
        },
      },
    ],
    alt: 'The weekly grid with pending proposals overlaid: proposed classes dashed — a move shows only at its new slot — and a class a proposal would remove struck through',
    caption: 'Pending proposals on the week — additions and moves dashed, removals struck through.',
  },
  {
    file: 'schedule-csv.png',
    app: 'schedule',
    as: 'registrar',
    route: '/#/',
    seed: 'populated',
    steps: [
      { act: 'click', role: 'button', name: 'CSV' },
      { act: 'assert', text: 'Download summary CSV' },
    ],
    alt: 'The CSV menu with the summary and registrar download options',
    caption: 'Downloads: the summary CSV and the full registrar CSV.',
  },
]
