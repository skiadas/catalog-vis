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
    alt: 'The course-conflicts view, listing a course that overlaps another',
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
    steps: [{ act: 'assert', text: 'No meeting times' }, { act: 'assert', text: 'custom' }],
    fullPage: true,
    alt: 'The grid showing a dashed custom rail, with the No meeting times strip below it',
    caption: 'Courses that fall outside the standard times: a dashed "custom" rail, or the strip below.',
  },
  {
    file: 'schedule-suggest-session.png',
    app: 'schedule',
    as: 'advisor',
    route: '/#/?mode=suggest&id=<id>',
    seed: 'suggest',
    steps: [{ act: 'assert', text: 'Suggesting' }],
    alt: 'A suggest session: the Suggesting bar with Propose changes and Done',
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
    alt: 'The course editor: section, instructor, days, and meeting time',
    caption: 'The course editor — every setting for one section.',
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
      { act: 'assert', text: 'Lab added' },
      // The editor auto-closes after adding; the new lab (unscheduled, so
      // attached but not yet on the calendar) shows up in the strip below.
      { act: 'detach', selector: '.modal[aria-labelledby="course-edit-title"]' },
      { act: 'assert', text: 'BIO 165L' },
    ],
    fullPage: true,
    alt: 'The grid after adding a lab section, with the attached lab in the strip below',
    caption: 'Adding a lab: a lab section is attached to its lecture.',
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
