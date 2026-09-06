// E2E suite for the schedule app's core flows, ported from the old
// smoke.mjs script onto Playwright Test. Each test gets a fresh browser
// context (no cookies, empty localStorage), so each signs itself in; the
// suite is sequential (workers: 1) against one shared server, whose scratch
// DB the webServer config provisions. The suite fails on unexpected page
// errors and console errors (the pre-sign-in 401s and favicon misses are
// expected noise and filtered), exactly like the smoke script did.
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Runs an axe scan and keeps only the violations that block WCAG AA (serious
// and critical). The schedule app's contrast, focus, and labeling work is
// gate-kept here so regressions fail the suite.
const seriousViolations = async (page) => {
  const results = await new AxeBuilder({ page }).analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}
// Target-size gate. axe ships `target-size` disabled and it doesn't engage
// reliably, so assert the rendered boxes directly: the known small controls
// must measure >= 24x24 CSS px (WCAG 2.5.8) wherever they render.
async function assertTargetSize(page, selectors, label) {
  for (const sel of selectors) {
    const el = page.locator(sel).first()
    await el.waitFor({ timeout: 5000 })
    const box = await el.boundingBox()
    expect(box, `${label}: ${sel} must have a box`).not.toBeNull()
    if (box) {
      expect(box.width, `${label}: ${sel} must be >= 24 wide`).toBeGreaterThanOrEqual(24)
      expect(box.height, `${label}: ${sel} must be >= 24 tall`).toBeGreaterThanOrEqual(24)
    }
  }
}
const brief = (violations) =>
  violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .slice(0, 3)
        .map((n) => (n.target || []).join(' '))
        .join(' | ')}`,
  )
// axe can sample colors mid-transition (a button fading between states scans
// far below its real ratio); settle like the rest of the suite before scanning.
const settle = (page) => page.waitForTimeout(400)

// Collects page errors + console errors for a page; the signed-in flows by
// definition hit 401s before login and favicon misses, so filter those.
function trackErrors(page, { signedIn = true } = {}) {
  const pageErrors = []
  const consoleErrors = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (signedIn && text.includes('401')) return
    if (text.includes('favicon')) return
    consoleErrors.push(text)
  })
  return { pageErrors, consoleErrors }
}

function assertClean(errors) {
  expect(errors.pageErrors, 'page errors').toEqual([])
  expect(errors.consoleErrors, 'console errors').toEqual([])
}

// The boot prompt (login or offline) appears on every fresh visit before any
// app state. Signing in closes it and pins the identity in the header.
async function signIn(page, username = 'registrar') {
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 10000 })
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await dialog.getByLabel('Username').fill(username)
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText(`Signed in as ${username}`).waitFor({ timeout: 10000 })
}

// Creates a named schedule and closes the manage modal (backdrop click) so
// the header pills are reachable.
async function createSchedule(page, name) {
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill(name)
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.getByText(name).first().waitFor({ timeout: 10000 })
  await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } })
}

test('sign-in and schedule creation', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Smoke schedule')
  assertClean(errors)
})

test('edit/suggest modes and the meeting-pattern guards + strip/rail', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Patterns schedule')

  // --- Edit mode via the pencil menu ---
  await page.locator('.schedule-pill-edit').first().click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  expect(box && box.height >= 20, 'mode-menu actually visible').toBe(true)
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // --- Suggest mode via the pencil menu ---
  await page.locator('.schedule-pill-edit').first().click()
  await menu.getByRole('button', { name: 'Suggest changes' }).click()
  await page.getByText('Suggestion mode:').first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // --- Edit mode: the TR->MWF guard ---
  await page.locator('.schedule-pill-edit').first().click()
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })

  // Add a course: its editor opens immediately, pre-slotted MWF 8:00-9:10.
  // The add modal and the editor are both `.modal`, so scope each by its
  // aria-labelledby to stay unambiguous.
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('BIO')
  await addm.locator('.schedule-add-option').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  const saveBtn = em.getByRole('button', { name: 'Save changes' })
  await expect(saveBtn).toBeEnabled()

  // Switching day groups clears the stale band and disables Save until a slot
  // of the new group is picked (MWF 8:00-9:10 -> TR must re-pick).
  await em.getByRole('button', { name: 'TR', exact: true }).click()
  await em.getByText('Pick a time slot for TR.').first().waitFor({ timeout: 5000 })
  await expect(saveBtn).toBeDisabled()
  // 8:00-9:45 is a TR-only band: the first slot of the newly-active TR row.
  await em.locator('.slot-time-btn', { hasText: '8:00-9:45' }).click()
  await em.getByText('Pick a time slot for TR.').first().waitFor({ state: 'detached', timeout: 5000 })

  // "No meeting time" lands the course in the strip under the grid.
  await em.getByRole('button', { name: 'No meeting time' }).click()
  await saveBtn.click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByText('No meeting times').first().waitFor({ timeout: 5000 })
  await page.locator('.no-meeting-pattern', { hasText: 'No meeting time' }).first().waitFor({ timeout: 5000 })

  // Reopen from the strip; a custom time past 16:00 needs a day picked first
  // (Save stays disabled without one) and renders as a clipped off-pattern
  // rail: dashed 'custom' block with a clipped-bottom notch.
  await page.locator('.no-meeting-strip .slot-pill-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Custom time' }).click()
  await expect(saveBtn).toBeDisabled()

  // The air-datepicker popover must step minutes by 5 only (00/05/.../55).
  await em.getByLabel('Start time').click()
  const picker = page.locator('.air-datepicker')
  await picker.waitFor({ state: 'visible', timeout: 5000 })
  const minSlider = picker.locator('input[name="minutes"]')
  await minSlider.waitFor({ timeout: 5000 })
  await expect(minSlider).toHaveAttribute('step', '5')
  await minSlider.evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el)
    input.value = '30'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(150)
  await expect(em.getByLabel('Start time')).toHaveValue(/:30$/)
  // Time sliders never auto-close the popover; dismiss it with a header click
  // so it cannot intercept the later picks, then choose a day and type the
  // final custom times (focusing a field reopens its popover, so dismiss the
  // end-time one again before saving).
  await page.locator('.modal-head h3').click()

  await em.locator('.day-chip').first().click()
  await em.getByLabel('Start time').fill('15:00')
  await em.getByLabel('End time').fill('18:00')
  await page.locator('.modal-head h3').click()
  await saveBtn.click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.locator('.cal-block.off-pattern.clipped-bottom').first().waitFor({ timeout: 5000 })
  await page.locator('.cal-block-tag', { hasText: 'custom' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  assertClean(errors)
})

test('history panel lists session edits; Undo to here reverts and Redo replays', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'History schedule')

  // Enter edit mode.
  await page.locator('.schedule-pill-edit').first().click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })

  // A fresh session's History panel is empty.
  await page.getByRole('button', { name: /History/ }).click()
  const h = page.locator('.modal[aria-labelledby="history-title"]')
  await h.waitFor({ state: 'visible', timeout: 5000 })
  await expect(h.getByText('No changes yet this session.')).toBeVisible()
  await h.getByRole('button', { name: 'Close' }).click()
  await h.waitFor({ state: 'detached', timeout: 5000 })

  // Add a course: its editor opens pre-slotted. Saving with no field changes
  // writes nothing, so the add is the session's single history entry.
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('BIO')
  await addm.locator('.schedule-add-option').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByRole('button', { name: /History/ }).click()
  await h.waitFor({ state: 'visible', timeout: 5000 })
  const row = h.locator('.history-row').first()
  await expect(row).toHaveText(/add/)
  await expect(h.locator('.history-row')).toHaveCount(1)

  // Undo to here reverts the change (the row flips to "undone"); Redo replays.
  await row.getByRole('button', { name: 'Undo to here' }).click()
  await expect(row).toHaveClass(/undone/)
  await h.getByRole('button', { name: 'Redo' }).click()
  await expect(row).not.toHaveClass(/undone/)

  await h.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  assertClean(errors)
})

test('lab sections: add lab from the editor (auto-close), strip lab chip, schedule it, cascade remove', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Labs schedule')

  // Edit mode, then add a course — its editor opens pre-slotted.
  await page.locator('.schedule-pill-edit').first().click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  // ANTH 160 is in the catalog but never in the seeded sample schedule, so
  // every ANTH 160 block on the grid is this test's course.
  await addm.getByPlaceholder('Search code or name…').fill('ANTH 160')
  await addm.locator('.schedule-add-option', { hasText: 'ANTH 160' }).first().click()

  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })

  // "Add lab section": the button flips to an in-editor confirmation and —
  // with no other edits pending — the editor closes itself.
  await em.getByRole('button', { name: 'Add lab section' }).click()
  await em
    .getByText(/Lab added — ANTH 160L A1/)
    .first()
    .waitFor({ timeout: 5000 })
  await em.waitFor({ state: 'detached', timeout: 5000 })

  // The lab is unscheduled: it sits in the strip, marked with a LAB chip.
  const strip = page.locator('.no-meeting-strip')
  const labPill = strip.locator('.slot-pill:has(.lab-chip)')
  await labPill.first().waitFor({ timeout: 5000 })
  await expect(labPill.first()).toContainText('ANTH 160')

  // Reopen the lab from the strip: the editor marks it as a lab and offers no
  // "Add lab section" (a lab cannot spawn labs).
  await labPill.first().locator('.slot-pill-edit').click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('.lab-chip')).toHaveText('LAB')
  await expect(em.getByRole('button', { name: 'Add lab section' })).toHaveCount(0)

  // Give it a meeting time and save: it leaves the strip for the grid. The
  // unscheduled lab opens in "No meeting time" mode, so switch to Time slot
  // first to reveal the day-group bands.
  await em.getByRole('button', { name: 'Time slot' }).click()
  await em.getByRole('button', { name: 'TR', exact: true }).click()
  await em.locator('.slot-time-btn', { hasText: '10:00-11:45' }).click()
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(strip.locator('.slot-pill')).toHaveCount(0)
  await page.locator('.cal-block').filter({ hasText: 'ANTH 160' }).first().waitFor({ timeout: 5000 })

  // Remove the lecture from its block: its lab is removed with it (no
  // orphan labs are left behind). Grid offerings render as `.filter-offering`.
  const lectureBlock = page.locator('.cal-block').filter({ hasText: 'ANTH 160' }).first()
  await lectureBlock
    .locator('.filter-offering', { hasText: 'ANTH 160' })
    .locator('.filter-offering-edit')
    .first()
    .click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Remove course' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(page.locator('.cal-block').filter({ hasText: 'ANTH 160' })).toHaveCount(0)

  assertClean(errors)
})

test('main views and dialogs have no serious/critical accessibility violations', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  // Its own account: this test generates a dense random schedule, which would
  // pollute the shared 'registrar' collection and break sibling tests' slot
  // assertions.
  await signIn(page, 'axe-user')
  await createSchedule(page, 'Axe schedule')

  // The grid with a generated schedule: colored blocks, pills, and filters.
  await settle(page)
  const gridViolations = await seriousViolations(page)
  expect(brief(gridViolations), 'grid view').toEqual([])
  await assertTargetSize(page, ['.schedule-pill-edit', '.schedule-pill-hide'], 'grid view')

  // The manage dialog and the create dialog it opens.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await settle(page)
  const manageViolations = await seriousViolations(page)
  expect(brief(manageViolations), 'manage dialog').toEqual([])
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await settle(page)
  const createViolations = await seriousViolations(page)
  expect(brief(createViolations), 'create dialog').toEqual([])
  // Populate it ("All departments") so the grid actually has colored blocks
  // for the slot-view scan; the default Empty schedule renders nothing.
  await page.getByRole('button', { name: 'All departments' }).click()
  await page.locator('#schedule-create-name').fill('Axe create')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } })
  await settle(page)

  // Edit mode surfaces the small inline edit pencils on offering rows; open a
  // block so they render, scan their target sizes, then close both. Use this
  // user's own (populated) schedule — the shared collection's other pills
  // aren't owned, so their "Edit schedule" is disabled, and the empty
  // "Axe schedule" has no rows to size.
  await page
    .locator('.schedule-pill', { hasText: 'Axe create' })
    .locator('.schedule-pill-edit')
    .first()
    .click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  const blockTime = page.locator('.cal-block:not(.off-pattern) .cal-block-time').first()
  await blockTime.click()
  await settle(page)
  await assertTargetSize(page, ['.filter-offering-edit', '.cal-block-view'], 'edit-mode grid')
  await blockTime.click()
  await page.getByRole('button', { name: 'Done' }).click()

  // A day view (buttons on cards) after opening a block's slot.
  await page.locator('.cal-block:not(.off-pattern) .cal-block-time').first().click()
  await page.locator('.cal-block-view').first().click()
  await page.waitForURL(/#\/slot\//, { timeout: 5000 })
  await settle(page)
  const slotViolations = await seriousViolations(page)
  expect(brief(slotViolations), 'slot view').toEqual([])

  // The schedule collection is shared server-wide (ownership gates editing, not
  // visibility), so this test's populated random schedule would pollute later
  // tests' slot assertions. Clean up both schedules it created.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  for (const name of ['Axe create', 'Axe schedule']) {
    await page
      .locator('.schedule-manage-row', { hasText: name })
      .getByRole('button', { name: `Delete ${name}` })
      .click()
    await page.waitForTimeout(250)
  }
  await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } })

  assertClean(errors)
})

test('offline boot: a fresh visitor works locally with no authenticated calls', async ({ page }) => {
  // This test's fresh context has no session cookie and empty localStorage:
  // the prompt must appear, choosing offline shows the persistent badge and
  // the local sample, and boot makes no authenticated calls (no 401s).
  const errors = trackErrors(page, { signedIn: false })
  await page.goto('/', { waitUntil: 'networkidle' })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 10000 })
  await dialog.getByRole('button', { name: 'Work offline' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByText('Offline — testing only').first().waitFor({ timeout: 5000 })
  await page.getByText('Sample schedule').first().waitFor({ timeout: 5000 })
  assertClean(errors)
})

// Import registrar CSV: the create modal offers "Import CSV…", the file is
// parsed into a summary (never imported directly), and Import always creates
// a NEW schedule named after the file — rows route into its F/W/S parts by
// the term column. Existing schedules are never touched.
test('import registrar CSV creates a new schedule and routes rows by term', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', 'apps/schedule/e2e/import.csv')

  // The summary names the file, pre-fills the schedule name from it, and shows
  // the term parts the rows would fill — with no import happening yet. The
  // file carries a split-meeting pair (MUS 001 A on MW and R at two custom
  // times), which exercises the per-row content ids end-to-end.
  await expect(page.locator('#schedule-create-name')).toHaveValue('import')
  await expect(page.getByText(/Imported 9 course row\(s\)/)).toBeVisible()
  await expect(page.getByText(/into Fall \+ Winter \+ Spring/)).toBeVisible()

  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })

  // The manage list shows the per-term counts the import routed (F: 4 = the
  // two original rows + the split-meeting pair, W: 2, S: 3 = lectures + lab +
  // unscheduled row).
  const row = page.locator('.schedule-manage-row', { hasText: 'import' })
  await row.waitFor({ timeout: 10000 })
  await expect(row).toContainText('Fall: 4, Winter: 2, Spring: 3')
  await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } })

  // The new schedule is auto-selected as a header pill.
  await page.locator('.schedule-pill', { hasText: 'import' }).first().waitFor({ timeout: 10000 })

  // --- Opened blocks: a click reveals the course list in the same footprint ---
  // Standard count block (Fall: CS 220 at 9:20-10:30) opens in place — no
  // navigation — and its rows carry real schedule colors (never white-on-white).
  // (Selection is by the block's stable title: an opened block's text no longer
  // contains the word "course", so text-based locators would drift to a sibling.)
  const bar = page.locator('.cal-block[title="CS 220"]').first()
  await bar.waitFor({ timeout: 10000 })
  await expect(bar).toHaveCSS('z-index', '1')
  // Toggle the in-place list via the block's header (the time label); clicking
  // the block's middle would land on an offering row and navigate instead.
  await bar.locator('.cal-block-time').click()
  await expect(page).toHaveURL(/#\/$/)
  const barRow = bar.locator('.filter-offering').first()
  await expect(barRow).toBeVisible()
  await expect(barRow).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // Click again: the list closes back to the count view.
  await bar.locator('.cal-block-time').click()
  await expect(barRow).not.toBeVisible()

  // Off-pattern rail (Fall: MAT 131 at 14:20-16:05) layers below the bars and
  // opens the same way.
  const rail = page.locator('.cal-block.off-pattern').first()
  await rail.waitFor({ timeout: 10000 })
  await expect(rail).toHaveCSS('z-index', '0')
  await rail.locator('.cal-block-time').click()
  await expect(page).toHaveURL(/#\/$/)
  const railRow = rail.locator('.filter-offering').first()
  await expect(railRow).toBeVisible()
  await expect(railRow).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  // The opened card's background holds while the mouse is on it (the rail's
  // hover tint must not repaint over the open list). The card fades in over
  // the 150ms background transition, so settle before capturing.
  const bgOf = (loc) =>
    loc.evaluate((el) => el.ownerDocument.defaultView.getComputedStyle(el).backgroundColor)
  await page.waitForTimeout(300)
  const hoveredBg = await bgOf(rail)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(300)
  expect(await bgOf(rail)).toBe(hoveredBg)

  // --- Block-type view mode: All · Normal · Custom ---
  const modeGroup = page.getByRole('group', { name: 'Show blocks' })
  await modeGroup.getByRole('button', { name: 'Custom' }).click()
  await expect(page.locator('.cal-block[title="CS 220"]')).toHaveCount(0)
  await expect(page.locator('.cal-block.off-pattern[title="MAT 131"]').first()).toBeVisible()
  await modeGroup.getByRole('button', { name: 'Normal' }).click()
  await expect(page.locator('.cal-block[title="CS 220"]').first()).toBeVisible()
  await expect(page.locator('.cal-block.off-pattern[title="MAT 131"]')).toHaveCount(0)
  await modeGroup.getByRole('button', { name: 'All' }).click()
  await expect(page.locator('.cal-block[title="CS 220"]').first()).toBeVisible()
  await expect(page.locator('.cal-block.off-pattern[title="MAT 131"]').first()).toBeVisible()

  // "View slot" still reaches the slot page from an opened rail.
  await rail.locator('.cal-block-view').click()
  await expect(page).toHaveURL(/#\/slot\//)

  assertClean(errors)
})

// Grid blocks expand in place on click (no navigation away); the expanded
// block shows its course list, click-again collapses, and the "View slot"
// link still reaches the slot page.
test('grid block click expands the course list in place; View slot navigates', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)

  // A generated schedule (All departments) fills the grid with blocks.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'All departments' }).click()
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } })

  const block = page.locator('.cal-block:not(.off-pattern)').first()
  await block.waitFor({ timeout: 10000 })
  await block.locator('.cal-block-time').click()
  // Still on the grid — the click expanded, it did not navigate away.
  await expect(page).toHaveURL(/#\/$/)
  const rows = block.locator('.filter-offering')
  await expect(rows.first()).toBeVisible()

  // Clicking the block again collapses the list back to the count view.
  await block.locator('.cal-block-time').click()
  await expect(rows.first()).not.toBeVisible()

  // The expanded block's "View slot" link still reaches the slot page.
  await block.locator('.cal-block-time').click()
  await block.locator('.cal-block-view').click()
  await expect(page).toHaveURL(/#\/slot\//)

  assertClean(errors)
})
