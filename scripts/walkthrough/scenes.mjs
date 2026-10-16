// Demo scenes: bespoke, choreographed walkthroughs recorded to .webm (unlike
// the docs manifest, which is one PNG-frame per entry). Each scene runs against
// a named fixture's scratch DB, signs in as `as`, loads `route`, then walks
// `steps` using the shared DSL (scripts/walkthrough/harness.mjs).
//
// Steps are the same vocabulary the screenshot manifest uses, plus `text` on a
// selector click (a substring/regex filter) and a `custom` escape hatch whose
// `run(page, pointer)` may drive the animated cursor directly. `ms` overrides
// the recorder's per-step hold; `hold` sets it for the whole scene.
//
// `npm run demo:video`            all scenes
// `npm run demo:video -- suggest  only scenes whose name matches
export const scenes = [
  {
    name: 'suggest-and-edit',
    seed: 'suggest-large',
    as: 'advisor',
    route: '/#/schedules',
    hold: 900,
    steps: [
      // Show the registrar's public schedule, then return to the grid.
      { act: 'assert', text: 'New schedule' },
      { act: 'click', role: 'button', name: 'Show Fall 2026' },
      { act: 'goto', route: '/#/' },
      { act: 'assert', text: 'Fall 2026' },
      { ms: 1200 },

      // Open a busy slot to reveal the courses in it.
      { act: 'click', selector: '.cal-block:not(.off-pattern):not(.cal-dropzone) .cal-block-time' },
      { act: 'assert', selector: '.cal-block.open .filter-offering' },
      { ms: 1400 },

      // Filter to two departments.
      { act: 'click', role: 'button', name: /Departments/ },
      { act: 'click', selector: '.filter-chip', text: /^CS$/ },
      { act: 'click', selector: '.filter-chip', text: /^MAT$/ },
      { act: 'assert', selector: '.filter-chip.active' },
      { ms: 1200 },

      // Start a suggestion session on the public schedule.
      { act: 'click', selector: '.schedule-pill-suggest' },
      { act: 'assert', text: 'Suggesting' },
      { ms: 1000 },

      // Edit interaction in place of a drag: open CS 220 and move it to TR.
      {
        act: 'custom',
        run: async (page, pointer) => {
          const pencil = page
            .locator('.filter-offering', { hasText: 'CS 220' })
            .first()
            .locator('.filter-offering-edit')
          await pointer.moveTo(pencil)
          await pencil.click()
        },
      },
      { act: 'assert', selector: '#course-edit-title' },
      { ms: 1200 },
      { act: 'click', role: 'button', name: 'Time slot' },
      { act: 'click', role: 'button', name: 'TR', exact: true },
      { act: 'click', selector: '.slot-time-btn', text: '10:00-11:45' },
      { ms: 1000 },
      { act: 'click', role: 'button', name: 'Save changes' },
      { act: 'detach', selector: '.modal[aria-labelledby="course-edit-title"]' },
      { ms: 1200 },

      // Round it off in the table view: change an instructor in place.
      { act: 'click', role: 'button', name: 'Table', exact: true },
      { act: 'assert', text: 'Suggesting' },
      {
        act: 'custom',
        run: async (page, pointer) => {
          const button = page.locator('button[aria-label^="Edit instructor of"]').first()
          const current = (await button.innerText()).trim()
          await pointer.moveTo(button)
          await button.click()
          const combo = page.locator('.schedule-table-combo-dropdown')
          // Widen from the row's department to every instructor so the pick is
          // not limited to the same few names.
          const scope = combo.locator('.course-picker-scope')
          if (await scope.count()) await scope.click()
          await page.locator('.schedule-table-input').fill('')
          const options = combo.locator('.course-picker-option')
          await options.first().waitFor({ timeout: 10_000 })
          let pick = options.first()
          for (let i = 0, n = await options.count(); i < n; i++) {
            const text = (await options.nth(i).innerText()).trim()
            if (text && !current.includes(text)) {
              pick = options.nth(i)
              break
            }
          }
          await pointer.moveTo(pick)
          await pick.click()
        },
      },
      { ms: 1500 },
    ],
  },
]
