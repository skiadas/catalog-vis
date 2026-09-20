// The screenshot manifest — "which PNG represents which state of the app".
//
// One entry per committed screenshot in docs-site/public/screenshots/. Docs
// reference an entry by its
// `file` through the <Shot file="…" /> component; the Vitepress build
// (docs-site/.vitepress/config.mjs, via checkDocsSite) fails if a <Shot>
// names no entry or an entry's PNG is missing on disk, so a stale name can
// never embed a dead image. Regeneration is `npm run docs:shots` (the
// Playwright harness, added with the first real walkthrough).
//
// Documented shape (rendered by <Shot>; the rest drives capture.mjs):
// {
//   file: 'schedule-access.png',        // stable name the docs reference
//   app: 'schedule',                    // launcher | schedule | browse | planner
//   as: 'registrar',                    // demo identity that signs in
//   route: '/#/schedule/<id>/access',   // the access dialog is its own route
//   seed: 'populated-schedule',         // named DATA fixture (API-level)
//   steps: [                            // declarative UI state (not in the URL)
//     { act: 'settle' },
//     { act: 'assert', role: 'dialog', name: 'Access' },
//   ],
//   fullPage: false,
//   alt: 'The access dialog: who can see and suggest changes for a schedule',
// }

export const entries = [
  {
    file: 'browse-programs.png',
    app: 'browse',
    route: '/#/',
    alt: 'The Browse app listing Hanover College academic programs',
    caption: 'Browse — the program and course catalog.',
  },
]
