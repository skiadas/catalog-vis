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
const seriousViolations = async (page, scope) => {
  const builder = scope ? new AxeBuilder({ page }).include(scope) : new AxeBuilder({ page })
  const results = await builder.analyze()
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

// Leaves the "/schedules" management page. It is a route now (not a modal),
// so closing means navigating back to whatever view opened it.
async function closeManage(page) {
  await page.getByRole('button', { name: '← Back' }).click()
  await page.locator('.schedule-manage-page').waitFor({ state: 'detached', timeout: 5000 })
  await expect(page).not.toHaveURL(/#\/schedules/)
}

// Creates a named schedule and leaves the manage page so the header pills are
// reachable. An optional year exercises the manage page's year filter.
async function createSchedule(page, name, year = '') {
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill(name)
  if (year) await page.locator('#schedule-create-year').fill(year)
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.getByText(name).first().waitFor({ timeout: 10000 })
  await closeManage(page)
}

// Creates a populated schedule ("All departments") and leaves the manage page.
// Used where the grid needs real rows rather than an empty schedule.
async function createPopulatedSchedule(page, name) {
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill(name)
  await page.getByRole('button', { name: 'All departments' }).click()
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.getByText(name).first().waitFor({ timeout: 10000 })
  await closeManage(page)
}

test('sign-in and schedule creation', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Smoke schedule')
  // Manage is a route now: opening "Your schedules" lands on /#/schedules and
  // the browser back button closes it (deep-linkable, like the other views).
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await expect(page).toHaveURL(/#\/schedules$/)
  await expect(page.locator('.schedule-manage-page')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('.schedule-manage-page')).toHaveCount(0)
  // A direct visit opens the same page without a prior view.
  await page.goto('/#/schedules', { waitUntil: 'networkidle' })
  await expect(page.locator('.schedule-manage-page')).toBeVisible()
  // A freshly created schedule is private with owner-only suggestions; the row
  // leads with the owner and spells out the two share statuses.
  const smokeRow = page.locator('.schedule-manage-row', { hasText: 'Smoke schedule' })
  await expect(smokeRow.locator('.schedule-manage-owner')).toHaveText('You')
  await expect(smokeRow.locator('.schedule-manage-access')).toHaveText('private')
  await expect(smokeRow.locator('.schedule-manage-suggest')).toHaveText('can suggest: only you')
  // Make it public so the sibling tests can treat it as a shared schedule
  // (schedules are private by default; the Access overlay route is the owner's
  // control surface for opening one up).
  await page.getByRole('button', { name: 'Control access to Smoke schedule' }).click()
  await expect(page).toHaveURL(/#\/schedule\/[^/]+\/access$/)
  const access = page.locator('.modal[aria-labelledby="schedule-access-title"]')
  await access.waitFor({ state: 'visible', timeout: 5000 })
  await access.locator('#access-visibility').selectOption('public')
  await access.getByRole('button', { name: 'Save' }).click()
  await access.waitFor({ state: 'detached', timeout: 5000 })
  // Save closes the overlay, returning to the manage page it floated over.
  await expect(page).toHaveURL(/#\/schedules$/)
  await closeManage(page)
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

  // The day view is a single-day timeline on the grid's shared scale: the
  // custom 15:00-18:00 band (above, on the first day chip = M) renders as an
  // off-pattern block whose top/height map exactly to its clock time — the
  // axis is anchored at 8:00 (range.start 480) at 1.5px/min, so 15:00 sits at
  // (900-480)*1.5 = 630px and the 3-hour span is 270px tall. Monday is the
  // first weekday column.
  await page.locator('.cal-dayhead').first().click()
  await page.waitForURL(/#\/day\/M/, { timeout: 5000 })
  await settle(page)
  const tlBlock = page.locator('.day-timeline .cal-block.off-pattern')
  await tlBlock.first().waitFor({ timeout: 5000 })
  await expect(tlBlock.first()).toContainText('custom')
  await expect(tlBlock.first().locator('.filter-offering').first()).toBeVisible()
  await expect(tlBlock.first()).toHaveCSS('top', '630px')
  await expect(tlBlock.first()).toHaveCSS('height', '270px')
  // The standard 8:00-9:10 zone shades the timeline behind the blocks.
  await expect(page.locator('.day-timeline .tl-stdzone').first()).toBeVisible()
  const dayViolations = await seriousViolations(page)
  expect(brief(dayViolations), 'day view').toEqual([])

  // The timeline block's "View slot" link reaches the slot page, and the
  // slot page's back link returns to the day view.
  const viewSlot = page.locator('.day-timeline .cal-block-view').first()
  await viewSlot.waitFor({ timeout: 5000 })
  await viewSlot.click()
  await page.waitForURL(/#\/slot\/M\/15:00-18:00/, { timeout: 5000 })
  await page.locator('.back-btn').click()
  await page.waitForURL(/#\/day\/M/, { timeout: 5000 })
  await settle(page)

  // Entering edit mode from the day view stays on the day view (the session
  // rides in the query): no grid redirect, the timeline's edit pencils appear,
  // and the old "switch to the grid" hint is gone.
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await expect(page).toHaveURL(/#\/day\/M\?.*mode=edit/)
  await expect(page.locator('.day-timeline .filter-offering-edit').first()).toBeVisible()
  await expect(page.getByText('Switch to the grid view')).toHaveCount(0)

  assertClean(errors)
})

// The edit/suggest session is a focused mode: the edited schedule is live, the
// other selected schedules are dimmed read-only references, manage is
// unreachable, and leaving (Done, back, header link) ends the session.
test('edit session: dimmed references, reduced strip, and leaving ends the session', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  // Its own account so the shared collection's schedules do not become
  // references and break the row assertions.
  await signIn(page, 'edit-session-user')
  await createPopulatedSchedule(page, 'Session A')
  await createPopulatedSchedule(page, 'Session B')

  // Make sure both are shown (creating B may have changed the selection).
  await page.getByRole('button', { name: /Your schedules/ }).click()
  for (const name of ['Session A', 'Session B']) {
    const show = page
      .locator('.schedule-manage-row', { hasText: name })
      .getByRole('button', { name: `Show ${name}` })
    if (await show.count()) await show.click()
  }
  await closeManage(page)

  // Enter edit on Session A from its pill.
  const pillA = page.locator('.schedule-pill', { hasText: 'Session A' })
  await pillA.locator('.schedule-pill-edit').click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await expect(page).toHaveURL(/\?mode=edit&id=/)
  const editUrl = page.url()
  // The strip tags the edited pill and demotes Session B to a reference.
  await expect(pillA.locator('.schedule-pill-editing')).toHaveText('Editing')
  await expect(page.locator('.schedule-pill', { hasText: 'Session B' })).toHaveClass(/reference/)
  // Manage is unreachable while editing.
  await expect(page.getByRole('button', { name: /Your schedules/ })).toHaveCount(0)
  // Reference rows are dimmed and have no edit pencil; Session A's are live.
  await expect(page.locator('.filter-offering.reference').first()).toBeVisible()
  await expect(page.locator('.filter-offering.reference .filter-offering-edit')).toHaveCount(0)
  await expect(page.locator('.filter-offering:not(.reference) .filter-offering-edit').first()).toBeVisible()
  // The reference's eye drops it from the view (and its dimmed rows vanish).
  await page.locator('.schedule-pill', { hasText: 'Session B' }).locator('.schedule-pill-hide').click()
  await expect(page.locator('.schedule-pill', { hasText: 'Session B' })).toHaveCount(0)
  await expect(page.locator('.filter-offering.reference')).toHaveCount(0)

  // Done leaves the session (query stripped) but stays on the view.
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).not.toHaveURL(/mode=edit/)
  await expect(page.getByRole('button', { name: /Your schedules/ })).toBeVisible()

  // The session is deep-linkable: reloading that URL resumes it.
  await page.goto(editUrl, { waitUntil: 'networkidle' })
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await expect(page).toHaveURL(/\?mode=edit&id=/)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page).not.toHaveURL(/mode=edit/)

  // Clean up this account's schedules for later tests.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  for (const name of ['Session A', 'Session B']) {
    await page
      .locator('.schedule-manage-row', { hasText: name })
      .getByRole('button', { name: `Delete ${name}` })
      .click()
  }
  await closeManage(page)
  assertClean(errors)
})

test('suggest session: leaving with an unsaved draft asks first', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'suggest-exit-user')
  await createPopulatedSchedule(page, 'Suggest exit')

  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Suggest changes' }).click()
  await page.getByText('Suggestion mode:').first().waitFor({ timeout: 5000 })

  // Make a change: it lands in the draft, not the schedule.
  await page.locator('.filter-offering:not(.reference) .filter-offering-edit').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.locator('#course-edit-instructor').fill('Draft Person')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(page.getByRole('button', { name: /Propose changes/ })).toContainText('●')

  // Declining the discard confirm keeps the session put.
  page.once('dialog', (d) => d.dismiss())
  await page.goBack()
  await page.waitForTimeout(200)
  await expect(page).toHaveURL(/mode=suggest/)
  await expect(page.getByText('Suggestion mode:')).toBeVisible()

  // Accepting discards the draft and leaves the session.
  page.once('dialog', (d) => d.accept())
  await page.goBack()
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.getByText('Suggestion mode:')).toHaveCount(0)

  // Clean up this account's schedule.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Suggest exit' })
    .getByRole('button', { name: 'Delete Suggest exit' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

test('edit session guard: deep links you cannot edit bounce back to the view', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'guard-user')
  // A missing schedule id leaves the mode.
  await page.goto('/#/?mode=edit&id=does-not-exist', { waitUntil: 'networkidle' })
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.getByText('Edit mode:')).toHaveCount(0)
  // A schedule this user does not own refuses the direct edit deep link (the
  // registrar's public 'Smoke schedule' from the earlier test).
  const all = await page.evaluate(() => fetch('../../api/schedules').then((r) => r.json()))
  const smoke = all.schedules.find((s) => s.name === 'Smoke schedule')
  await page.goto(`/#/?mode=edit&id=${smoke.id}`, { waitUntil: 'networkidle' })
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.getByText('Edit mode:')).toHaveCount(0)
  assertClean(errors)
})

// The suggested-changes panel is its own overlay route: openable from the
// toolbar (pending review) and deep-linkable; back closes it.
test('proposals overlay route: opens from the toolbar, back closes, deep links', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'proposals-route-user')
  await createPopulatedSchedule(page, 'Proposals route')

  await page.getByRole('button', { name: 'Suggested changes' }).click()
  const panel = page.locator('.modal[aria-labelledby="suggested-title"]')
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  await expect(page).toHaveURL(/#\/schedule\/[^/]+\/proposals$/)
  const proposalsUrl = page.url()
  await expect(panel.getByText('Suggested changes — Proposals route')).toBeVisible()
  await page.goBack()
  await panel.waitFor({ state: 'detached', timeout: 5000 })
  await expect(page).not.toHaveURL(/proposals/)

  // A direct visit opens the same panel (pending review, no session needed).
  await page.goto(proposalsUrl, { waitUntil: 'networkidle' })
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  await expect(panel.getByText('No suggestions yet.')).toBeVisible()
  await panel.getByLabel('Close').click()
  await panel.waitFor({ state: 'detached', timeout: 5000 })

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Proposals route' })
    .getByRole('button', { name: 'Delete Proposals route' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// The course editor is its own overlay route named by the course code; its
// header switches between the course's sections and labs, and switching with
// unsaved changes asks before discarding.
test('course editor overlay route: section switcher saves the section you leave', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'editor-route-user')
  await createPopulatedSchedule(page, 'Editor route')

  // Enter edit mode and open the editor on the first offering row.
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await page.locator('.filter-offering:not(.reference) .filter-offering-edit').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(page).toHaveURL(/#\/schedule\/[^/]+\/course\/[^/]+\/edit$/)
  const editorUrl = page.url()
  const lectureTitle = await em.locator('#course-edit-title').innerText()
  // A single-section course has no switcher yet.
  await expect(em.locator('select[aria-label="Section"]')).toHaveCount(0)

  // Add a lab (the editor closes itself when nothing else was edited), then
  // reopen: the course now has two sections and the header offers a switcher.
  await em.getByRole('button', { name: 'Add lab section' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.locator('.filter-offering:not(.reference) .filter-offering-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('select[aria-label="Section"]')).toBeVisible()
  await expect(em.locator('select[aria-label="Section"] option')).toHaveCount(2)

  // Edit a field, then switch: the switch commits the edit (no discard ask) and
  // moves to the other section.
  await em.locator('#course-edit-instructor').fill('Section Person')
  await em.locator('select[aria-label="Section"]').selectOption({ index: 1 })
  await expect(em.getByText('Discard your unsaved changes?')).toHaveCount(0)
  await expect(em.locator('#course-edit-title')).not.toHaveText(lectureTitle)
  // Switching back shows the value that was saved on the way out.
  await em.locator('select[aria-label="Section"]').selectOption({ index: 0 })
  await expect(em.locator('#course-edit-title')).toHaveText(lectureTitle)
  await expect(em.locator('#course-edit-instructor')).toHaveValue('Section Person')

  // Closing returns to the session view (the overlay is session-transparent).
  await page.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(page).not.toHaveURL(/course\/.*\/edit/)
  await expect(page.getByText('Edit mode:')).toBeVisible()

  // The editor URL is referential: a fresh visit auto-starts the session and
  // opens the editor (checked in a new page so it is a real document load).
  const deep = await page.context().newPage()
  await deep.goto(editorUrl, { waitUntil: 'networkidle' })
  const deepEditor = deep.locator('.modal[aria-labelledby="course-edit-title"]')
  await deepEditor.waitFor({ state: 'visible', timeout: 5000 })
  await deep.getByRole('button', { name: 'Cancel' }).click()
  await deepEditor.waitFor({ state: 'detached', timeout: 5000 })
  await expect(deep).not.toHaveURL(/course\/.*\/edit/)
  await deep.close()

  // Clean up: leave the session and delete the schedule.
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Editor route' })
    .getByRole('button', { name: 'Delete Editor route' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

test('history panel lists session edits; Cancel removes one change, Restore brings it back, Edit jumps', async ({
  page,
}) => {
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
  // writes nothing, so the add is the session's single history row.
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

  // Cancel drops just this change; the row flips to cancelled (restorable).
  await row.getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toHaveClass(/cancelled/)
  await expect(row.getByText('(cancelled)')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Restore' })).toBeVisible()

  // Restore brings it back to a live row.
  await row.getByRole('button', { name: 'Restore' }).click()
  await expect(row).not.toHaveClass(/cancelled/)
  await expect(row.getByRole('button', { name: 'Cancel' })).toBeVisible()

  // The Edit action jumps straight into that course's editor (the history
  // panel closes itself first).
  await row.getByRole('button', { name: 'Edit' }).click()
  const em2 = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em2.waitFor({ state: 'visible', timeout: 5000 })
  await h.waitFor({ state: 'detached', timeout: 5000 })
  await em2.getByRole('button', { name: 'Save changes' }).click()
  await em2.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByRole('button', { name: 'Done' }).click()
  assertClean(errors)
})

test('course editor guards unsaved changes, pins its actions, and completes instructor autocomplete', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)

  // Build an 'Editor roster' schedule via CSV import: the instructor
  // autocomplete pools come from the schedule's own term, so the rows must
  // carry real instructors.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', 'apps/schedule/e2e/import.csv')
  await expect(page.getByText(/Imported 9 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Editor roster')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Editor roster' }).first().waitFor({ timeout: 10000 })

  // Enter edit mode and open the course editor on the first offering row.
  await page
    .locator('.schedule-pill', { hasText: 'Editor roster' })
    .locator('.schedule-pill-edit')
    .first()
    .click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await page.locator('.cal-block:not(.off-pattern) .cal-block-time').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await page.locator('.filter-offering-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })

  // The action bar is pinned to the dialog's foot: Save changes never scrolls
  // out of view, whatever the content height.
  const saveBtn = em.getByRole('button', { name: 'Save changes' })
  await expect(saveBtn).toBeInViewport()

  // Change a field, then dismiss by clicking the overlay outside the dialog:
  // the foot asks before discarding.
  await em.locator('#course-edit-secondary').fill('Test Person')
  const box = await em.boundingBox()
  await page.mouse.click(box.x + box.width / 2, Math.max(2, box.y - 10))
  await expect(em.getByText('Discard your unsaved changes?')).toBeVisible()

  // Keep editing stays in the editor with the change intact.
  await em.getByRole('button', { name: 'Keep editing' }).click()
  await expect(em.getByText('Discard your unsaved changes?')).toHaveCount(0)
  await expect(em.getByRole('button', { name: 'Save changes' })).toBeVisible()

  // Escape also asks while dirty; a second Escape backs out of the ask. The
  // instructor field is a combobox now: focus opens its suggestions, and the
  // same Escape that closes them also raises the discard ask (the input's esc
  // handler and the modal's both fire on the keypress).
  await em.locator('#course-edit-instructor').focus()
  await expect(em.locator('.course-picker-dropdown')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(em.locator('.course-picker-dropdown')).toHaveCount(0)
  await expect(em.getByText('Discard your unsaved changes?')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(em.getByText('Discard your unsaved changes?')).toHaveCount(0)

  // Discard closes the editor without writing anything.
  await em.locator('#course-edit-instructor').focus()
  await page.keyboard.press('Escape')
  await em.getByRole('button', { name: 'Discard' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: /History/ }).click()
  const h = page.locator('.modal[aria-labelledby="history-title"]')
  await h.waitFor({ state: 'visible', timeout: 5000 })
  await expect(h.getByText('No changes yet this session.')).toBeVisible()
  await h.getByRole('button', { name: 'Close' }).click()
  await h.waitFor({ state: 'detached', timeout: 5000 })

  // Reopen the editor: the roster autocomplete suggests term instructors on
  // focus and fills the free-text field on pick.
  await page.locator('.filter-offering-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  const sec = em.locator('#course-edit-secondary')
  await sec.focus()
  const firstSuggestion = em.locator('.course-picker-dropdown .course-picker-option').first()
  await expect(firstSuggestion).toBeVisible()
  const name = (await firstSuggestion.innerText()).trim()
  await firstSuggestion.click()
  await expect(sec).toHaveValue(name)
  await expect(em.locator('.course-picker-dropdown')).toHaveCount(0)

  await em.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // Delete the roster schedule: later tests' shared-server expectations (the
  // fresh-context first-pill selection) must not see this test's leftovers.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Editor roster' })
    .getByRole('button', { name: 'Delete Editor roster' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

test('instructor combobox suggests catalog faculty on a fresh schedule and accepts any typed name', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)

  // A brand-new empty schedule has no offerings, so a term-derived pool would
  // offer no names; the combobox seeds from the catalog's department rosters.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill('Fresh roster')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Fresh roster' }).first().waitFor({ timeout: 10000 })

  // Edit mode, add BIO 161 — the editor opens on it directly.
  await page
    .locator('.schedule-pill', { hasText: 'Fresh roster' })
    .locator('.schedule-pill-edit')
    .first()
    .click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('BIO 161')
  await addm.locator('.schedule-add-option', { hasText: 'BIO 161' }).first().click()

  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  const inst = em.locator('#course-edit-instructor')
  await inst.focus()
  // The department pool is the catalog BIO roster — a real faculty name is
  // suggested with nothing else in the schedule.
  await expect(em.locator('.course-picker-dropdown .course-picker-option', { hasText: 'Gall' })).toBeVisible()
  // Typing a name from nobody's roster closes the suggestions and stays legal.
  await inst.fill('Ada Lovelace')
  await expect(em.locator('.course-picker-dropdown')).toHaveCount(0)
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  // The saved free-text instructor is on the row: reopen the editor and check.
  await page
    .locator('.cal-block')
    .filter({ hasText: 'BIO 161' })
    .locator('.filter-offering-edit')
    .first()
    .click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(inst).toHaveValue('Ada Lovelace')
  await em.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // Clean up the shared server collection for later tests.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Fresh roster' })
    .getByRole('button', { name: 'Delete Fresh roster' })
    .click()
  await closeManage(page)
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

  // The lab is unscheduled: it sits in the strip, identified by the
  // registrar's shapes (course number 160L, section A1) — no LAB chip.
  const strip = page.locator('.no-meeting-strip')
  const labPill = strip.locator('.slot-pill', { hasText: 'ANTH 160L' })
  await labPill.first().waitFor({ timeout: 5000 })
  await expect(labPill.first()).toContainText('ANTH 160L')
  await expect(labPill.first()).toContainText('A1')

  // Reopen the lab from the strip: the editor marks it as a lab and offers no
  // "Add lab section" (a lab cannot spawn labs). Its title names the offering
  // by the registrar shapes, not a LAB label.
  await labPill.first().locator('.slot-pill-edit').click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-title')).toHaveText('Edit ANTH 160L A1')
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
  // The scheduled lab shows the same registrar shapes on the grid row and on
  // the day timeline row: course number 160L + section A1, like the pill.
  const labBlock = page.locator('.cal-block').filter({ hasText: 'ANTH 160L' })
  await labBlock.first().waitFor({ timeout: 5000 })
  await expect(labBlock.first().locator('.filter-offering', { hasText: 'ANTH 160L' })).toHaveCount(1)
  await page.locator('.cal-dayhead').nth(1).click() // T: the lab meets TR 10:00-11:45
  await page.waitForURL(/#\/day\/T/, { timeout: 5000 })
  await settle(page)
  await expect(page.locator('.day-timeline .filter-offering', { hasText: 'ANTH 160L' })).toHaveCount(1)
  await page.getByRole('button', { name: 'Grid', exact: true }).click()

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

test('no-meeting strip keys a lecture and its labs apart and survives filter toggles', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Strip test')

  // Edit mode; add ANTH 160 (pre-slotted) with a lab (auto-close lands the
  // unscheduled lab in the strip), then a second department's course.
  await page.locator('.schedule-pill-edit').first().click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  const addCourse = async (code) => {
    await page.getByRole('button', { name: '＋ Add course' }).click()
    const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
    await addm.waitFor({ state: 'visible', timeout: 5000 })
    await addm.getByPlaceholder('Search code or name…').fill(code)
    await addm.locator('.schedule-add-option', { hasText: code }).first().click()
    const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
    await em.waitFor({ state: 'visible', timeout: 5000 })
  }
  const saveAndClose = async () => {
    const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
    await em.getByRole('button', { name: 'Save changes' }).click()
    await em.waitFor({ state: 'detached', timeout: 5000 })
  }
  const unschedule = async (code) => {
    const block = page.locator('.cal-block').filter({ hasText: code }).first()
    await block.locator('.filter-offering', { hasText: code }).locator('.filter-offering-edit').click()
    const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
    await em.waitFor({ state: 'visible', timeout: 5000 })
    await em.getByRole('button', { name: 'No meeting time' }).click()
    await saveAndClose()
  }

  await addCourse('ANTH 160')
  await page
    .locator('.modal[aria-labelledby="course-edit-title"]')
    .getByRole('button', { name: 'Add lab section' })
    .click()
  await page
    .getByText(/Lab added — ANTH 160L A1/)
    .first()
    .waitFor({ timeout: 5000 })
  await page
    .locator('.modal[aria-labelledby="course-edit-title"]')
    .waitFor({ state: 'detached', timeout: 5000 })
  await addCourse('BIO 160')
  await saveAndClose()
  // Unschedule both lectures: the lecture + lab now share the strip (the
  // plain code+section key is identical for a lecture and its lab, which used
  // to make this list ghost rows on updates).
  await unschedule('ANTH 160')
  await unschedule('BIO 160')

  const strip = page.locator('.no-meeting-strip')
  await expect(strip).toBeVisible()
  await expect(strip.locator('.no-meeting-row')).toHaveCount(3)
  await expect(strip.locator('.no-meeting-count')).toHaveText('3')
  await expect(strip.locator('.slot-pill', { hasText: 'ANTH 160L' })).toHaveCount(1)
  await expect(strip.locator('.slot-pill', { hasText: /ANTH 160A/ })).toHaveCount(1)

  // Toggle the ANTH filter on and off: the strip must track the filtered list
  // exactly (no duplicated rows), and the count badge must match the rows.
  const anthChip = page.locator('.filter-chip', { hasText: 'ANTH' })
  await page.getByRole('button', { name: /Departments/ }).click()
  await anthChip.waitFor({ state: 'visible', timeout: 5000 })
  await anthChip.click()
  await settle(page)
  await expect(strip.locator('.no-meeting-row')).toHaveCount(2)
  await expect(strip.locator('.no-meeting-count')).toHaveText('2')
  await expect(strip.locator('.slot-pill', { hasText: 'ANTH 160L' })).toHaveCount(1)
  await expect(strip.locator('.slot-pill', { hasText: 'BIO 160' })).toHaveCount(0)
  await anthChip.click()
  await settle(page)
  await expect(strip.locator('.no-meeting-row')).toHaveCount(3)
  await anthChip.click()
  await settle(page)
  await expect(strip.locator('.no-meeting-row')).toHaveCount(2)
  await expect(strip.locator('.no-meeting-count')).toHaveText('2')

  assertClean(errors)
})

test('main views and dialogs have no serious/critical accessibility violations', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  // Its own account: this test generates a dense random schedule, which would
  // pollute the shared 'registrar' collection and break sibling tests' slot
  // assertions.
  await signIn(page, 'axe-user')
  // Give this schedule a year so the manage page's year filter has options.
  await createSchedule(page, 'Axe schedule', '2026-27')

  // The grid with a generated schedule: colored blocks, pills, and filters.
  await settle(page)
  const gridViolations = await seriousViolations(page)
  expect(brief(gridViolations), 'grid view').toEqual([])
  await assertTargetSize(page, ['.schedule-pill-edit', '.schedule-pill-hide'], 'grid view')

  // The manage page and the create dialog it opens.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await settle(page)
  const manageViolations = await seriousViolations(page)
  expect(brief(manageViolations), 'manage page').toEqual([])

  // The access dialog (owner-only visibility/suggester controls) opens on top
  // of the manage list.
  await page.getByRole('button', { name: 'Control access to Axe schedule' }).click()
  await settle(page)
  const accessViolations = await seriousViolations(page, '.modal[aria-labelledby="schedule-access-title"]')
  expect(brief(accessViolations), 'access dialog').toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page
    .locator('.modal[aria-labelledby="schedule-access-title"]')
    .waitFor({ state: 'detached', timeout: 5000 })
  // Own schedules come first, then what is shared. This account owns one row
  // (with a delete button); the registrar's public schedule shows up in its
  // own section, with no delete button.
  await expect(page.locator('.schedule-manage-owner', { hasText: 'You' })).toHaveCount(1)
  await expect(page.locator('.schedule-manage-del')).toHaveCount(1)
  await expect(page.locator('.schedule-manage-section-title', { hasText: 'Public' })).toHaveCount(1)
  await expect(page.locator('.schedule-manage-owner', { hasText: 'by registrar' }).first()).toBeVisible()
  // The registrar's public schedule allows only the owner to suggest, phrased
  // for this non-owner reader.
  await expect(
    page.locator('.schedule-manage-row', { hasText: 'Smoke schedule' }).locator('.schedule-manage-suggest'),
  ).toHaveText('can suggest: the owner')
  // Search matches the OWNER's username, not just schedule names: typing
  // 'registrar' leaves only the public row.
  await page.locator('.schedule-manage-search').fill('registrar')
  await expect(page.locator('.schedule-manage-row', { hasText: 'Axe schedule' })).toHaveCount(0)
  await expect(page.locator('.schedule-manage-row', { hasText: 'Smoke schedule' })).toHaveCount(1)
  await page.locator('.schedule-manage-search').fill('')
  // The year filter narrows the sections: the registrar's schedule has no
  // year, so selecting 2026-27 leaves only this user's row.
  await page.locator('#schedule-manage-year').selectOption('2026-27')
  await expect(page.locator('.schedule-manage-row', { hasText: 'Smoke schedule' })).toHaveCount(0)
  await expect(page.locator('.schedule-manage-row', { hasText: 'Axe schedule' })).toHaveCount(1)
  await page.locator('#schedule-manage-year').selectOption('')
  // The picker pills label shared schedules too: toggle one of the
  // registrar's into the view, assert the owner suffix, toggle it back off.
  await page
    .locator('.schedule-manage-row', { hasText: 'Smoke schedule' })
    .getByRole('button', { name: 'Show Smoke schedule' })
    .click()
  await closeManage(page)
  await settle(page)
  await expect(
    page.locator('.schedule-pill', { hasText: 'Smoke schedule' }).locator('.schedule-pill-owner'),
  ).toHaveText('(by registrar)')
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Smoke schedule' })
    .getByRole('button', { name: 'Hide Smoke schedule' })
    .click()
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
  await closeManage(page)
  await settle(page)
  // The freshly generated schedule is auto-selected, so the grid now shows
  // populated count blocks — scan it: the collapsed-block text must stay AA
  // against the accent tint (this also gates the day timeline's card text).
  const populatedGridViolations = await seriousViolations(page)
  expect(brief(populatedGridViolations), 'populated grid view').toEqual([])

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

  // The whole offering row is draggable (its native drag image is the row), but
  // only the grip advertises it: the grip carries the grab cursor and is not
  // itself a drag source.
  const offeringRows = page.locator('.filter-offering')
  await expect(offeringRows.first()).toBeVisible()
  await expect(offeringRows.first()).toHaveAttribute('draggable', 'true')
  const grips = page.locator('.filter-offering-handle')
  expect(await grips.count()).toBeGreaterThan(0)
  await expect(grips.first()).not.toHaveAttribute('draggable')
  await expect(grips.first()).toHaveCSS('cursor', 'grab')

  // The course editor: scan it open, then in its discard-confirm state.
  await page.locator('.filter-offering-edit').first().click()
  await settle(page)
  const editDialog = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await editDialog.waitFor({ state: 'visible', timeout: 5000 })
  const editViolations = await seriousViolations(page, '.modal[aria-labelledby="course-edit-title"]')
  expect(brief(editViolations), 'course editor dialog').toEqual([])
  await editDialog.locator('#course-edit-secondary').fill('Test Person')
  await page.keyboard.press('Escape')
  await settle(page)
  const confirmViolations = await seriousViolations(page, '.modal[aria-labelledby="course-edit-title"]')
  expect(brief(confirmViolations), 'course editor discard confirm').toEqual([])
  await editDialog.getByRole('button', { name: 'Keep editing' }).click()
  await editDialog.getByRole('button', { name: 'Cancel' }).click()
  await editDialog.waitFor({ state: 'detached', timeout: 5000 })

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
  await closeManage(page)

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

  // The import routed rows into the schedule's term parts (asserted through
  // the API — the manage row no longer prints per-term counts): F: 4 = the
  // two original rows + the split-meeting pair, W: 2, S: 3 = lectures + lab +
  // unscheduled row.
  await page.locator('.schedule-manage-row', { hasText: 'import' }).waitFor({ timeout: 10000 })
  const imported = await page.evaluate(() => fetch('../../api/schedules').then((r) => r.json()))
  const importedSchedule = imported.schedules.find((s) => s.name === 'import')
  expect(importedSchedule.terms.F.offerings.length).toBe(4)
  expect(importedSchedule.terms.W.offerings.length).toBe(2)
  expect(importedSchedule.terms.S.offerings.length).toBe(3)
  await closeManage(page)

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

test('day view: a crowded slot lays courses side by side and the scale control resizes the axis', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)

  // Import a Fall schedule whose Monday 9:20-10:30 band holds seven courses, so
  // both the side-by-side layout and the crowding heuristic have something to
  // act on (and 1x leaves more rows than the band fits). The imported schedule
  // is auto-selected as the header pill.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'crowd.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times,term\n' +
        'CS,220,A,Wahl,,MWF,9:20-10:30,F\n' +
        'MAT,131,A,Aydogan,,MWF,9:20-10:30,F\n' +
        'BIO,161,A,Patterson,,MWF,9:20-10:30,F\n' +
        'ENG,111,A,Poole,,MWF,9:20-10:30,F\n' +
        'CS,101,A,Vosmeier,,MWF,9:20-10:30,F\n' +
        'BIO,166,A,Patterson,,MWF,9:20-10:30,F\n' +
        'MUS,001,A,Smith,,MWF,9:20-10:30,F\n',
    ),
  })
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.locator('.schedule-manage-row', { hasText: 'crowd' }).waitFor({ timeout: 10000 })
  await closeManage(page)

  // Into Monday's day view (Fall, 8:00-16:00 => 480min at 1.5px/min = 720px).
  await page.locator('.cal-dayhead').first().click()
  await expect(page).toHaveURL(/#\/day\/M$/)
  const day = page.locator('.day-timeline')
  await day.waitFor({ state: 'visible', timeout: 5000 })
  const calHeight = () => day.evaluate((el) => el.style.getPropertyValue('--cal-height'))

  // Auto: the seven-course band doubles the whole axis.
  await expect.poll(calHeight).toBe('1440px')

  // The band's courses render as pills side by side (three a row, wrapping),
  // not as full-width rows stacked down the card.
  const block = day.locator('.day-tl-block').filter({ hasText: 'CS 220' })
  await expect(block.locator('.day-tl-item')).toHaveCount(7)
  const boxes = await block.locator('.day-tl-item').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width }
    }),
  )
  expect(Math.abs(boxes[0].y - boxes[1].y), 'first two pills share a row').toBeLessThan(2)
  expect(boxes[1].x, 'second pill sits to the right of the first').toBeGreaterThan(boxes[0].x)
  // The wrapped remainder keeps the same column width as its predecessors (no
  // full-width last pill).
  expect(boxes[3].y, 'fourth pill wraps to a second row').toBeGreaterThan(boxes[0].y)
  expect(Math.abs(boxes[6].w - boxes[0].w), 'remainder pill is one column wide').toBeLessThan(1)
  // A crowded band scrolls instead of clipping (overflow hidden would swallow
  // courses past the band's height); at the base scale the seven pills outgrow
  // the band, so the content is genuinely taller than the visible area.
  const items = block.locator('.day-tl-items')
  await expect(items).toHaveCSS('overflow-y', 'auto')

  // The control overrides the heuristic, then Auto restores it.
  const scaleGroup = page.getByRole('group', { name: 'Calendar height' })
  await scaleGroup.getByRole('button', { name: '1×' }).click()
  await expect.poll(calHeight).toBe('720px')
  expect(
    await items.evaluate((el) => el.scrollHeight > el.clientHeight),
    'crowded band overflows at 1x',
  ).toBe(true)
  await scaleGroup.getByRole('button', { name: '2×' }).click()
  await expect.poll(calHeight).toBe('1440px')
  await scaleGroup.getByRole('button', { name: 'Auto' }).click()
  await expect.poll(calHeight).toBe('1440px')

  // Clean up the imported schedule.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'crowd' })
    .getByRole('button', { name: 'Delete crowd' })
    .click()
  await closeManage(page)
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
  await closeManage(page)

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

test('edit mode drags a course by its row onto an empty slot; the pencil never drags', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)

  // A Single-department schedule is sparse: single-row blocks and plenty of
  // empty standard bands (dropzones) to drag onto.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill('Drag test')
  await page.getByRole('button', { name: 'Single department' }).click()
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)

  // Edit mode on THAT schedule (the collection holds other schedules too).
  await page.locator('.schedule-pill', { hasText: 'Drag test' }).locator('.schedule-pill-edit').click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })
  const block = page.locator('.cal-block:not(.off-pattern):not(.cal-dropzone)').first()
  await block.waitFor({ timeout: 10000 })
  await block.locator('.cal-block-time').click()
  await settle(page)

  const row = block.locator('.filter-offering').first()
  await expect(row).toHaveAttribute('draggable', 'true')
  const course = await row.locator('.filter-offering-code').innerText()
  const dropzones = page.locator('.cal-dropzone')
  await expect(dropzones.first()).toBeVisible()
  // Drop onto the LAST empty band: landing in an earlier band than the course
  // currently sits in would make the moved course the new `.first()` block and
  // break the "left its block" assertion below (the locator re-resolves).
  const target = dropzones.last()

  // A drag that starts on the pencil carries no payload (the guard cancels it
  // before setData), so the drop is a no-op and the row stays put.
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await row.locator('.filter-offering-edit').dispatchEvent('dragstart', { dataTransfer })
  await target.dispatchEvent('dragover', { dataTransfer })
  await target.dispatchEvent('drop', { dataTransfer })
  await settle(page)
  await expect(block.locator('.filter-offering-code', { hasText: course })).toHaveCount(1)

  // A drag from the row body carries the payload: the course leaves its block
  // for the empty band (its band is now unoccupied).
  await row.dispatchEvent('dragstart', { dataTransfer })
  await target.dispatchEvent('dragover', { dataTransfer })
  await target.dispatchEvent('drop', { dataTransfer })
  await settle(page)
  await expect(block.locator('.filter-offering-code', { hasText: course })).toHaveCount(0)

  assertClean(errors)
})

test('access: a shared schedule admits listed viewers; suggest gating follows the suggesters list', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'alice')
  // A single-department schedule comes with courses, so the suggest-session
  // gating below has something to gate.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill('Access schedule')
  await page.getByRole('button', { name: 'Single department' }).click()
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)

  // Alice opens the Access dialog on her row: shared visibility with bob +
  // carol as viewers, and only bob as a suggester.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: 'Control access to Access schedule' }).click()
  const access = page.locator('.modal[aria-labelledby="schedule-access-title"]')
  await access.waitFor({ state: 'visible', timeout: 5000 })
  await access.locator('#access-visibility').selectOption('shared')
  await access.getByLabel('Add viewer').fill('bob')
  await access.locator('.access-add').first().getByRole('button', { name: 'Add' }).click()
  await access.getByLabel('Add viewer').fill('carol')
  await access.locator('.access-add').first().getByRole('button', { name: 'Add' }).click()
  await access.locator('#access-suggest').selectOption('shared')
  await access.getByLabel('Add suggester').fill('bob')
  await access.locator('.access-add').last().getByRole('button', { name: 'Add' }).click()
  await access.getByRole('button', { name: 'Save' }).click()
  await access.waitFor({ state: 'detached', timeout: 5000 })
  // The saved row is the server's answer: shared visibility, bob + carol as
  // viewers, bob as suggester — the row badge summarizes it.
  const saved = await page.evaluate(() => fetch('../../api/schedules').then((r) => r.json()))
  const mine = saved.schedules.find((s) => s.name === 'Access schedule')
  expect(mine.visibility).toBe('shared')
  expect(mine.viewers).toEqual(['bob', 'carol'])
  expect(mine.suggesters).toEqual(['bob'])
  const accessRow = page.locator('.schedule-manage-row', { hasText: 'Access schedule' })
  await expect(accessRow.locator('.schedule-manage-access')).toHaveText('shared · 2 viewers')
  await expect(accessRow.locator('.schedule-manage-suggest')).toHaveText('can suggest: listed (1)')
  await closeManage(page)

  // Bob: sees the schedule under "Shared with you"; can suggest but not edit
  // directly.
  await page.getByRole('button', { name: 'Sign out' }).click()
  const cluster = page.locator('.schedule-auth-cluster')
  await cluster.getByLabel('Username').fill('bob')
  await cluster.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Signed in as bob').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await expect(page.locator('.schedule-manage-section-title', { hasText: 'Shared with you' })).toBeVisible()
  const row = page.locator('.schedule-manage-row', { hasText: 'Access schedule' })
  await row.waitFor({ state: 'visible', timeout: 5000 })
  await row.getByRole('button', { name: 'Edit or suggest changes for Access schedule' }).click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await expect(menu.getByRole('button', { name: 'Edit schedule' })).toBeDisabled()
  await expect(menu.getByRole('button', { name: 'Suggest changes' })).toBeEnabled()

  // Bob is a suggester but has no directory departments, so entering a suggest
  // session leaves every course uneditable (no pencils) and the panel explains
  // the department limit.
  await menu.getByRole('button', { name: 'Suggest changes' }).click()
  await page.getByText('Suggestion mode:').first().waitFor({ timeout: 5000 })
  await expect(page.locator('.filter-offering-edit')).toHaveCount(0)
  await page.getByRole('button', { name: 'Suggested changes' }).click()
  const panel = page.locator('.modal[aria-labelledby="suggested-title"]')
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  await expect(panel.getByText(/no departments yet/i)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Done' }).click() // leave suggest mode

  // Carol: a viewer but not a suggester — both actions are gated.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await cluster.getByLabel('Username').fill('carol')
  await cluster.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Signed in as carol').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: /Your schedules/ }).click()
  const carolRow = page.locator('.schedule-manage-row', { hasText: 'Access schedule' })
  await carolRow.waitFor({ state: 'visible', timeout: 5000 })
  await carolRow.getByRole('button', { name: 'Edit or suggest changes for Access schedule' }).click()
  const carolMenu = page.locator('.mode-menu')
  await carolMenu.waitFor({ state: 'visible', timeout: 5000 })
  await expect(carolMenu.getByRole('button', { name: 'Edit schedule' })).toBeDisabled()
  await expect(carolMenu.getByRole('button', { name: 'Suggest changes' })).toBeDisabled()
  await page.keyboard.press('Escape')

  assertClean(errors)
})

// The access dialog is an overlay route now: it floats over the surface it was
// opened from, is deep-linkable, and closing returns there. A non-owner (or a
// deleted schedule) gets the denial state instead of a form that cannot save.
test('access overlay route: deep links over the grid, floats over manage, denies non-owners', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'alice')
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill('Overlay schedule')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)

  // Capture the schedule id from the access URL, then deep-link straight to it
  // (no prior in-app view): the dialog renders over the grid.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: 'Control access to Overlay schedule' }).click()
  await expect(page).toHaveURL(/#\/schedule\/[^/]+\/access$/)
  const accessUrl = page.url()
  const dialog = page.locator('.modal[aria-labelledby="schedule-access-title"]')
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  await expect(dialog.getByText('Access — Overlay schedule')).toBeVisible()
  // The manage page it opened from stays mounted underneath (its state, here
  // the row, survives the overlay navigation).
  await expect(page.locator('.schedule-manage-page')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/#\/schedules$/)
  await closeManage(page)

  await page.goto(accessUrl, { waitUntil: 'networkidle' })
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  await expect(page.locator('.schedule-manage-page')).toHaveCount(0)
  // Closing a deep-linked overlay falls back to the grid (no in-app history).
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(page).toHaveURL(/#\/$/)

  // A non-owner sees the denial, not the form.
  await page.getByRole('button', { name: 'Sign out' }).click()
  const cluster = page.locator('.schedule-auth-cluster')
  await cluster.getByLabel('Username').fill('bob')
  await cluster.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Signed in as bob').waitFor({ timeout: 10000 })
  await page.goto(accessUrl, { waitUntil: 'networkidle' })
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  await expect(dialog.getByText('Only the owner can change access for this schedule.')).toBeVisible()
  await expect(dialog.locator('#access-visibility')).toHaveCount(0)
  await dialog.locator('.filter-btn', { hasText: 'Close' }).click()
  await expect(page).toHaveURL(/#\/$/)

  assertClean(errors)
})

test('admins maintain the user directory; access lists autocomplete from it', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page) // registrar is an admin (ADMIN_USERNAMES in the webServer env)

  // The Directory link is visible to the admin and opens the admin page.
  await page.getByRole('link', { name: 'Directory' }).click()
  const admin = page.locator('.admin-page')
  await admin.waitFor({ state: 'visible', timeout: 5000 })
  expect(page.url()).toContain('#/admin')

  // Add an account with a real name, then give it a department.
  await admin.getByLabel('Directory username').fill('wahl')
  await admin.getByLabel('Directory display name').fill('John Wahl')
  await admin.locator('.directory-add').getByRole('button', { name: 'Add' }).click()
  await expect(admin.getByText('Account added.')).toBeVisible()
  const row = admin.locator('.directory-row', { hasText: 'wahl' })
  await row.waitFor({ state: 'visible', timeout: 5000 })
  await row.getByRole('button', { name: 'Add department for John Wahl' }).click()
  await admin.getByLabel('Department prefix').fill('CS')
  await admin.locator('.directory-dept-editor').getByRole('button', { name: 'Add' }).click()
  await expect(row.locator('.directory-dept', { hasText: 'CS' })).toBeVisible()
  await expect(admin.getByText('Saved.')).toBeVisible()

  // Bulk import: a new account (departments in one quoted cell) and one bad row.
  await admin.locator('#admin-import-file').setInputFiles({
    name: 'directory.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('username,displayName,departments\nskia,Charilaos Skiadas,"CS, MATH"\n,No Name,CS\n'),
  })
  await expect(admin.getByText('Imported 1 new account and updated 0.')).toBeVisible()
  await expect(admin.getByText('Row 2: missing username')).toBeVisible()
  await expect(admin.locator('.directory-row', { hasText: 'skia' })).toBeVisible()

  // The filter narrows the list to matching accounts.
  await admin.getByLabel('Filter').fill('skia')
  await expect(admin.locator('.directory-row')).toHaveCount(1)
  await admin.getByLabel('Filter').fill('')

  // The page scans clean and its small controls meet the 24px target size.
  await settle(page)
  const adminViolations = await seriousViolations(page, '.admin-page')
  expect(brief(adminViolations), 'admin page').toEqual([])
  await assertTargetSize(
    page,
    ['.directory-dept-remove', '.directory-dept-add', '.directory-name-edit', '.admin-file-label'],
    'admin page',
  )

  // Back to the schedules, where the access dialog autocompletes from the
  // directory we just populated.
  await admin.getByRole('link', { name: '← Schedules' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).waitFor({ timeout: 5000 })
  await createSchedule(page, 'Directory schedule')
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: 'Control access to Directory schedule' }).click()
  const access = page.locator('.modal[aria-labelledby="schedule-access-title"]')
  await access.waitFor({ state: 'visible', timeout: 5000 })
  await access.locator('#access-visibility').selectOption('shared')
  await access.getByLabel('Add viewer').fill('wahl')
  const options = access.locator('#access-user-names option')
  await expect(options.first()).toHaveAttribute('value', 'wahl')
  await expect(options.first()).toContainText('John Wahl')
  await access.getByRole('button', { name: 'Cancel' }).click()
  await closeManage(page)

  assertClean(errors)
})

test('add-course dialog scopes to directory departments, with an all-courses escape hatch', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page) // registrar, the admin

  // Seed a directory entry giving a regular user the MAT department.
  await page.getByRole('link', { name: 'Directory' }).click()
  const admin = page.locator('.admin-page')
  await admin.waitFor({ state: 'visible', timeout: 5000 })
  await admin.getByLabel('Directory username').fill('deptonly')
  await admin.getByLabel('Directory display name').fill('Dept Only')
  await admin.locator('.directory-add').getByRole('button', { name: 'Add' }).click()
  const row = admin.locator('.directory-row', { hasText: 'deptonly' })
  await row.waitFor({ state: 'visible', timeout: 5000 })
  await row.getByRole('button', { name: 'Add department for Dept Only' }).click()
  await admin.getByLabel('Department prefix').fill('MAT')
  await admin.locator('.directory-dept-editor').getByRole('button', { name: 'Add' }).click()
  await expect(row.locator('.directory-dept', { hasText: 'MAT' })).toBeVisible()

  // Sign in as that user and start editing a schedule.
  await page.getByRole('button', { name: 'Sign out' }).click()
  const cluster = page.locator('.schedule-auth-cluster')
  await cluster.getByLabel('Username').fill('deptonly')
  await cluster.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Signed in as deptonly').waitFor({ timeout: 10000 })
  // We signed in from the admin route; leave it for the schedules view.
  await page.getByRole('link', { name: '← Schedules' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).waitFor({ timeout: 10000 })
  await createPopulatedSchedule(page, 'Dept scope schedule')
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.mode-menu').getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').first().waitFor({ timeout: 5000 })

  // The add dialog lists MAT courses only, with the scope note and toggle.
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await expect(addm.getByText('Your departments: MAT.')).toBeVisible()
  const codes = await addm.locator('.schedule-add-option .planner-pick-code').allInnerTexts()
  expect(codes.length).toBeGreaterThan(0)
  expect(codes.every((c) => c.startsWith('MAT '))).toBe(true)
  // Search narrows within the scope: a CS code query finds no MAT course.
  await addm.getByPlaceholder('Search code or name…').fill('CS 1')
  await expect(addm.locator('.schedule-add-option')).toHaveCount(0)

  // The escape hatch exposes the whole catalog, then limits again.
  await addm.getByRole('button', { name: 'Show all catalog courses' }).click()
  await expect(addm.getByText('Showing every catalog course.')).toBeVisible()
  await expect(addm.locator('.schedule-add-option .planner-pick-code').first()).not.toContainText('MAT ')
  const allCodes = await addm.locator('.schedule-add-option .planner-pick-code').allInnerTexts()
  expect(allCodes.some((c) => c.startsWith('CS '))).toBe(true)
  await addm.getByRole('button', { name: 'Limit to my departments' }).click()
  await expect(addm.getByText('Your departments: MAT.')).toBeVisible()

  await addm.getByRole('button', { name: 'Close' }).click()
  await addm.waitFor({ state: 'detached', timeout: 5000 })

  // Clean up: leave the session and delete the schedule.
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Dept scope schedule' })
    .getByRole('button', { name: 'Delete Dept scope schedule' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

test('non-admins cannot open the admin page', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'alice')
  // The header has no admin link, and a direct visit shows the denial state.
  await expect(page.getByRole('link', { name: 'Directory' })).toHaveCount(0)
  await page.goto('/#/admin')
  await expect(page.locator('.admin-denied')).toBeVisible()
  await expect(page.getByText('Only administrators can manage the user directory.')).toBeVisible()
  assertClean(errors)
})
