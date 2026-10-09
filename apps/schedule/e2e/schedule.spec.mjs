// E2E suite for the schedule app's core flows, ported from the old
// smoke.mjs script onto Playwright Test. Each test gets a fresh browser
// context (no cookies, empty localStorage), so each signs itself in; the
// suite is sequential (workers: 1) against one shared server, whose scratch
// DB the webServer config provisions. The suite fails on unexpected page
// errors and console errors (the pre-sign-in 401s and favicon misses are
// expected noise and filtered), exactly like the smoke script did.
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { parseCsv, CSV_COLUMNS } from '@major-vis/schedule-core'
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

// The "Other instructors" field collapses behind a trigger when the offering
// has no co-teachers; expand it before interacting with the field.
async function ensureOtherInstructors(em) {
  const trigger = em.locator('.add-others-btn')
  if (await trigger.count()) await trigger.click()
}

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

// Every test signs into its own account unless it names one. The suite shares
// one server and one DB, so a common account accumulates schedules across tests:
// a newly created schedule then merges with earlier ones (surfacing them as
// dimmed references and breaking row/drag/section-letter assertions). Deriving
// the default from the running test keeps each test isolated automatically —
// pass 'registrar' explicitly only for the shared public schedule and the admin
// flows. `titlePath` seeds a readable slug, `testId` guarantees uniqueness, and
// `retry` gives a retried attempt a clean account.
function testAccount() {
  const info = test.info()
  const slug = info.titlePath
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  const id = String(info.testId).replace(/[^a-z0-9]/gi, '')
  return `e2e-${slug}-${id}${info.retry ? `-r${info.retry}` : ''}`.slice(0, 120)
}

// The boot prompt (login or offline) appears on every fresh visit before any
// app state. Signing in closes it and pins the identity in the header.
async function signIn(page, username = testAccount()) {
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
  // Registrar on purpose: this test publishes the shared "Smoke schedule" that
  // later tests (and the guard deep-link) find by owner/visibility.
  await signIn(page, 'registrar')
  // The top nav links out to the user guide (co-deployed at /docs/).
  const guide = page.getByRole('link', { name: 'Guide' })
  await expect(guide).toBeVisible()
  await expect(guide).toHaveAttribute('href', '../../docs/')
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

test('view tabs disable when the term has no courses or instructors', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'tabs-user')
  await createSchedule(page, 'Empty term tabs')

  const viewTabs = page.locator('.schedule-toolbar .seg[aria-label="View"]')
  const courseTab = viewTabs.getByRole('button', { name: /^Course conflicts/ })
  const instructorTab = viewTabs.getByRole('button', { name: /^Instructor/ })

  // An empty term has no first course or instructor. The tabs explain why they
  // are unavailable (title + accessible name) and are off, rather than throwing
  // on the missing route param and silently doing nothing.
  await expect(courseTab).toBeDisabled()
  await expect(instructorTab).toBeDisabled()
  await expect(courseTab).toHaveAttribute('title', 'No courses in this term')
  await expect(instructorTab).toHaveAttribute('title', 'No instructors assigned in this term')
  await expect(courseTab).toHaveAttribute('aria-label', 'Course conflicts (no courses in this term)')
  await expect(instructorTab).toHaveAttribute(
    'aria-label',
    'Instructor (no instructors assigned in this term)',
  )

  // Populating a second schedule lights the tabs up, and each click reaches its
  // view (no thrown missing-param error).
  await createPopulatedSchedule(page, 'Populated term tabs')
  await expect(courseTab).toBeEnabled()
  await expect(instructorTab).toBeEnabled()
  await courseTab.click()
  await page.waitForURL(/#\/course\//, { timeout: 5000 })
  await expect(page.locator('.course-detail-main')).toBeVisible()
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await instructorTab.click()
  await page.waitForURL(/#\/instructor\//, { timeout: 5000 })
  await expect(page.getByText('Weekly timetable')).toBeVisible()

  assertClean(errors)
})

test('edit/suggest modes and the meeting-pattern guards + strip/rail', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Patterns schedule')

  // --- The pencil enters Edit directly (owner); the suggest bubble is next to it ---
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  await page.locator('.schedule-pill-suggest').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Suggesting' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // --- Edit mode: the TR->MWF guard ---
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })

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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await expect(page).toHaveURL(/\?mode=edit&id=/)
  const editUrl = page.url()
  // The strip tags the edited pill and demotes Session B to a reference.
  await expect(pillA.locator('.schedule-pill-editing')).toHaveText('Editing')
  // The editing pill is the same height as a reference pill (it carries the
  // chip where the others carry an icon button).
  const pillBox = await pillA.boundingBox()
  const refBox = await page.locator('.schedule-pill', { hasText: 'Session B' }).boundingBox()
  expect(Math.abs(pillBox.height - refBox.height), 'editing pill matches reference height').toBeLessThan(1)
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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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

  // The owner's pill shows both actions; the bubble starts a suggest session,
  // and its pill tag reads "Suggesting".
  await page.locator('.schedule-pill-suggest').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Suggesting' }).first().waitFor({ timeout: 5000 })
  await expect(page.locator('.schedule-pill-editing')).toHaveText('Suggesting')

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
  await expect(page.locator('.schedule-edit-chip', { hasText: 'Suggesting' })).toBeVisible()

  // Accepting discards the draft and leaves the session.
  page.once('dialog', (d) => d.accept())
  await page.goBack()
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.locator('.schedule-edit-chip', { hasText: 'Suggesting' })).toHaveCount(0)

  // Clean up this account's schedule.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Suggest exit' })
    .getByRole('button', { name: 'Delete Suggest exit' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

test("re-entering a suggest session doesn't double-draw the proposer's own addition", async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Replay schedule')

  // Enter a suggest session and add a course; it lands in the working copy.
  await page.locator('.schedule-pill-suggest').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Suggesting' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('ANTH 160')
  await addm.locator('.schedule-add-option', { hasText: 'ANTH 160' }).first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(
    page.locator('.cal-block', { hasText: 'ANTH 160' }).first().locator('.filter-offering', { hasText: 'ANTH 160' }),
  ).toHaveCount(1)

  // Propose it, leave the session, then come back to keep editing.
  await page.getByRole('button', { name: /Propose changes/ }).click()
  const panel = page.locator('.modal[aria-labelledby="suggested-title"]')
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  await panel.getByRole('button', { name: 'Propose changes' }).click()
  await panel.locator('.filter-btn', { hasText: 'Close' }).click()
  await panel.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await page
    .locator('.schedule-edit-chip', { hasText: 'Suggesting' })
    .waitFor({ state: 'detached', timeout: 5000 })

  await page.locator('.schedule-pill-suggest').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Suggesting' }).first().waitFor({ timeout: 5000 })

  // The addition is still exactly one: the replayed working copy, not a ghost.
  await expect(
    page.locator('.cal-block', { hasText: 'ANTH 160' }).first().locator('.filter-offering', { hasText: 'ANTH 160' }),
  ).toHaveCount(1)
  await expect(page.locator('.filter-offering.proposed')).toHaveCount(0)
  assertClean(errors)
})

test('pending suggestions show on the table, instructor, and course views', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Proposals everywhere')

  // Suggest an addition (with an instructor) and propose it, then leave the
  // session so the pending proposal is drawn on top of the schedule.
  await page.locator('.schedule-pill-suggest').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Suggesting' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('ANTH 160')
  await addm.locator('.schedule-add-option', { hasText: 'ANTH 160' }).first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.locator('#course-edit-instructor').fill('Wahl')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  await page.getByRole('button', { name: /Propose changes/ }).click()
  const panel = page.locator('.modal[aria-labelledby="suggested-title"]')
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  await panel.getByRole('button', { name: 'Propose changes' }).click()
  await panel.locator('.filter-btn', { hasText: 'Close' }).click()
  await panel.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await page
    .locator('.schedule-edit-chip', { hasText: 'Suggesting' })
    .waitFor({ state: 'detached', timeout: 5000 })

  // Table: the proposal is a marked row with its proposer in the source column.
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.locator('.schedule-table-row.proposed', { hasText: 'ANTH 160' })).toHaveCount(1)

  // Instructor: the proposed course lands on its instructor's timetable, marked.
  await page.goto('/#/instructor/Wahl', { waitUntil: 'networkidle' })
  await expect(page.locator('.cal-block.teach.proposed', { hasText: 'ANTH 160' }).first()).toBeVisible()

  // Course conflicts: the proposed section is listed, marked.
  await page.goto('/#/course/ANTH%20160', { waitUntil: 'networkidle' })
  await expect(page.locator('.req-block.proposed')).toHaveCount(1)

  assertClean(errors)
})

test('a proposed move hides its old slot, and only the meeting it names', async ({
  page,
  request,
}) => {
  const errors = trackErrors(page)
  // Seed a split-meeting section (two rows, distinct ids) and a pending move of
  // just the R meeting.
  await request.post('/api/auth/login', { data: { username: 'move-owner' } })
  const created = await request.post('/api/schedules', { data: { name: 'Move demo' } })
  const schedule = (await created.json()).schedule
  await request.put(`/api/schedules/${schedule.id}/terms/F`, {
    data: {
      offerings: [
        { prefix: 'MUS', number: '001', section: 'A', id: 'oMW', days: 'MW', time: '10:00-11:00' },
        { prefix: 'MUS', number: '001', section: 'A', id: 'oR', days: 'R', time: '13:00-14:30' },
      ],
    },
  })
  await request.post(`/api/schedules/${schedule.id}/suggestions`, {
    data: {
      term: 'F',
      baseVersion: 0,
      note: 'move the R meeting',
      operations: [
        {
          kind: 'update',
          cur: { prefix: 'MUS', number: '001', section: 'A', id: 'oR' },
          changes: { days: 'F' },
        },
      ],
    },
  })

  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'move-owner')

  // Overlay on by default: the moved meeting is dashed at its new slot, the
  // untouched sibling is a plain block, and nothing is struck (no removal).
  await expect(page.locator('.filter-offering.proposed', { hasText: 'MUS 001' }).first()).toBeVisible()
  await expect(page.locator('.filter-offering.removed')).toHaveCount(0)

  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show proposals' })).toBeVisible()
  // Two rows: the untouched MW meeting and the proposed F move.
  await expect(page.locator('.schedule-table-row', { hasText: 'MUS 001' })).toHaveCount(2)
  await expect(page.locator('.schedule-table-row.proposed', { hasText: 'MUS 001' })).toHaveCount(1)
  await expect(page.locator('.schedule-table-row.removed')).toHaveCount(0)
  await expect(
    page.locator('.schedule-table-row', { hasText: 'MUS 001' }).filter({ hasText: '10:00 AM' }),
  ).toHaveCount(1)

  // Toggling proposals off restores the real schedule: the R meeting is back.
  await page.getByRole('button', { name: 'Show proposals' }).click()
  await expect(page.locator('.schedule-table-row.proposed')).toHaveCount(0)
  await expect(
    page.locator('.schedule-table-row', { hasText: 'MUS 001' }).filter({ hasText: '1:00 PM' }),
  ).toHaveCount(1)

  assertClean(errors)
})

test('edit session guard: deep links you cannot edit bounce back to the view', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'guard-user')
  // A missing schedule id leaves the mode.
  await page.goto('/#/?mode=edit&id=does-not-exist', { waitUntil: 'networkidle' })
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.locator('.schedule-edit-chip', { hasText: 'Editing' })).toHaveCount(0)
  // A schedule this user does not own refuses the direct edit deep link (the
  // registrar's public 'Smoke schedule' from the earlier test).
  const all = await page.evaluate(() => fetch('../../api/schedules').then((r) => r.json()))
  const smoke = all.schedules.find((s) => s.name === 'Smoke schedule')
  await page.goto(`/#/?mode=edit&id=${smoke.id}`, { waitUntil: 'networkidle' })
  await expect(page).not.toHaveURL(/mode=/)
  await expect(page.locator('.schedule-edit-chip', { hasText: 'Editing' })).toHaveCount(0)
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

  // Import a single-section course rather than generating one: the generator's
  // random output can put a two-section course first, which would defeat the
  // "no switcher yet" assertion below.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'section-switch.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,days,times,term\n' +
        'CS,220,A,Smith,MWF,9:20-10:30,F\n',
    ),
  })
  await expect(page.getByText(/Imported 1 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Editor route')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Editor route' }).first().waitFor({ timeout: 10000 })

  // Enter edit mode and open the editor on the first offering row.
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.locator('.filter-offering:not(.reference) .filter-offering-edit').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(page).toHaveURL(/#\/schedule\/[^/]+\/course\/[^/]+\/edit$/)
  const editorUrl = page.url()
  const lectureTitle = await em.locator('#course-edit-title').innerText()
  // A single-section course has no switcher yet.
  await expect(em.locator('select[aria-label="Section"]')).toHaveCount(0)

  // Add a lab: the editor switches to it, and the course now has two sections
  // (the lecture and its lab), so the header offers a switcher. Close the lab
  // and reopen the lecture to keep editing it below.
  await em.getByRole('button', { name: 'Add lab section' }).click()
  await expect(em.locator('#course-edit-title')).toContainText('CS 220L')
  await expect(em.locator('select[aria-label="Section"] option')).toHaveCount(2)
  await page.getByRole('button', { name: 'Cancel' }).click()
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
  await expect(page.locator('.schedule-edit-chip', { hasText: 'Editing' })).toBeVisible()

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

// Split meetings: one section can carry more than one meeting band. The
// editor's "Add another meeting time" creates a same-section sibling, shows the
// section's other meeting inline (and lets you jump to it), and removing one
// meeting keeps the rest.
test('split meetings: add another meeting time, jump between meetings, remove one', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'split-meeting-user')

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'split.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,days,times,term\n' +
        'CS,220,A,Smith,MWF,9:20-10:30,F\n',
    ),
  })
  await expect(page.getByText(/Imported 1 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Split meetings')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Split meetings' }).first().waitFor({ timeout: 10000 })

  // Enter edit mode and open the editor.
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.locator('.filter-offering:not(.reference) .filter-offering-edit').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })

  // Add a second meeting: the editor switches to the new unscheduled row and
  // shows the original band as the section's other meeting.
  await em.getByRole('button', { name: '＋ Add another meeting time' }).click()
  await expect(em.getByText('This section also meets:')).toBeVisible()
  await expect(em.locator('.meeting-sibling-link')).toHaveText(/MWF · 9:20 AM - 10:30 AM/)
  await expect(em.locator('select[aria-label="Section"] option')).toHaveCount(2)

  // Give it a different band: R only, custom 1:00-2:30 PM.
  await em.getByRole('button', { name: 'Custom time' }).click()
  await em.locator('.slot-time-group-name', { hasText: 'TR' }).click()
  await em.locator('.day-chip', { hasText: /^T$/ }).click()
  await em.locator('input[aria-label="Start time"]').fill('13:00')
  await em.locator('input[aria-label="End time"]').fill('14:30')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  // The session's change list names the meeting band for the split row, so the
  // second meeting reads apart from the section it was added beside.
  await page.getByRole('button', { name: 'History' }).click()
  const history = page.locator('.modal[aria-labelledby="history-title"]')
  await history.waitFor({ state: 'visible', timeout: 5000 })
  await expect(history.getByText('add CS 220 A · R 13:00-14:30')).toBeVisible()
  await history.getByRole('button', { name: 'OK' }).click()
  await history.waitFor({ state: 'detached', timeout: 5000 })

  // Reopen the section: the inline note lists the other band, and following it
  // switches the editor to that meeting (which meeting opens first is not
  // order-dependent — assert the note flips).
  await page.locator('.filter-offering:not(.reference) .filter-offering-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  const otherBand = await em.locator('.meeting-sibling-link').innerText()
  await em.locator('.meeting-sibling-link').click()
  await expect(em.locator('.meeting-sibling-link')).not.toHaveText(otherBand)

  // Remove this meeting: the editor stays open on the surviving meeting.
  await expect(em.getByRole('button', { name: 'Remove this meeting time' })).toBeVisible()
  await em.getByRole('button', { name: 'Remove this meeting time' }).click()
  await expect(em).toBeVisible()
  await expect(em.locator('.meeting-sibling-link')).toHaveCount(0)

  // Clean up: leave the session and delete the schedule.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Split meetings' })
    .getByRole('button', { name: 'Delete Split meetings' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// Bulk copy: another schedule's filtered courses upsert into the schedule being
// edited, previewed before the write and landed in History.
test('copy courses from another schedule upserts a filtered department', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'copy-user')

  const importCsv = async (name, rows) => {
    await page.getByRole('button', { name: /Your schedules/ }).click()
    await page.getByRole('button', { name: '＋ New schedule' }).click()
    await page.getByRole('button', { name: 'Import CSV…' }).click()
    await page.setInputFiles('.schedule-upload-input', {
      name: name + '.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'dept_prefix,course_number,course_section,instructor,days,times,term\n' + rows.join('\n') + '\n',
      ),
    })
    await expect(page.getByText(/Imported \d+ course row\(s\)/)).toBeVisible()
    await page.locator('#schedule-create-name').fill(name)
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
    await closeManage(page)
    await page.locator('.schedule-pill', { hasText: name }).first().waitFor({ timeout: 10000 })
  }

  await importCsv('This year', ['MUS,101,A,Old,MWF,9:20-10:30,F', 'CS,220,A,Jones,MWF,9:20-10:30,F'])
  await importCsv('Two years ago', ['MUS,101,A,New,MWF,9:20-10:30,F', 'MUS,102,B,Fresh,TR,10:00-11:45,F'])

  // Edit "This year" and open the copy dialog.
  await page.locator('.schedule-pill', { hasText: 'This year' }).locator('.schedule-pill-edit').click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: /Copy courses/ }).click()
  const copy = page.locator('.modal[aria-labelledby="schedule-copy-title"]')
  await copy.waitFor({ state: 'visible', timeout: 5000 })

  // The only other schedule is the source; the choose step previews the upsert.
  await copy.locator('#schedule-copy-source').selectOption({ label: 'Two years ago' })
  await expect(copy.locator('.schedule-copy-counts')).toHaveText('1 new · 1 updated')

  // Review step: both candidates are listed and ticked, with bulk controls.
  await copy.getByRole('button', { name: 'Review 2 courses' }).click()
  await expect(copy.locator('.schedule-copy-item')).toHaveCount(2)
  await expect(copy.locator('.schedule-copy-list-count')).toHaveText('2 of 2 selected')

  // Deselect all disables the copy; Select all brings both back.
  await copy.getByRole('button', { name: 'Deselect all', exact: true }).click()
  await expect(copy.locator('.schedule-copy-list-count')).toHaveText('0 of 2 selected')
  await expect(copy.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled()
  await copy.getByRole('button', { name: 'Select all', exact: true }).click()
  await expect(copy.locator('.schedule-copy-list-count')).toHaveText('2 of 2 selected')

  // Unticking the update narrows the copy to the new section; put it back.
  await copy.locator('.schedule-copy-item', { hasText: 'MUS 101' }).getByRole('checkbox').uncheck()
  await expect(copy.locator('.schedule-copy-list-count')).toHaveText('1 of 2 selected')
  await expect(copy.getByRole('button', { name: 'Copy 1 course' })).toBeEnabled()
  await copy.locator('.schedule-copy-item', { hasText: 'MUS 101' }).getByRole('checkbox').check()

  await copy.getByRole('button', { name: 'Copy 2 courses' }).click()
  await copy.waitFor({ state: 'detached', timeout: 5000 })

  // The missing section is now on the grid, and the change list names both rows.
  await expect(page.getByText('MUS 102').first()).toBeVisible()
  await page.getByRole('button', { name: /History/ }).click()
  const history = page.locator('.modal[aria-labelledby="history-title"]')
  await history.waitFor({ state: 'visible', timeout: 5000 })
  await expect(history.getByText('add MUS 102 B')).toBeVisible()
  await expect(history.getByText('MUS 101 A: instructor from Old to New')).toBeVisible()
  await history.getByRole('button', { name: 'OK' }).click()
  await history.waitFor({ state: 'detached', timeout: 5000 })

  // Clean up: leave the session and delete both schedules.
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'This year' })
    .getByRole('button', { name: 'Delete This year' })
    .click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Two years ago' })
    .getByRole('button', { name: 'Delete Two years ago' })
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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })

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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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
  await ensureOtherInstructors(em)
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
  await ensureOtherInstructors(em)
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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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
  // The dropdown's foot offers the department escape hatch; flipping it swaps
  // the pool and the link's own label.
  const scope = em.locator('.course-picker-scope')
  await expect(scope).toHaveText('Show all instructors')
  await scope.click()
  await expect(scope).toHaveText('Limit to department')
  // Typing a name from nobody's roster stays legal: the dropdown remains open
  // with a no-match note rather than yielding to the browser's autocomplete.
  await inst.fill('Ada Lovelace')
  await expect(em.locator('.course-picker-dropdown .course-picker-empty')).toBeVisible()
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

test('lab sections: add lab from the editor, strip lab chip, schedule it, cascade remove', async ({
  page,
}) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Labs schedule')

  // Edit mode, then add a course — its editor opens pre-slotted.
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  // ANTH 160 is in the catalog but never in the seeded sample schedule, so
  // every ANTH 160 block on the grid is this test's course.
  await addm.getByPlaceholder('Search code or name…').fill('ANTH 160')
  await addm.locator('.schedule-add-option', { hasText: 'ANTH 160' }).first().click()

  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })

  // "Add lab section" switches the editor to the new lab so its time can be
  // set right away — the grid is behind the modal, so dragging isn't an
  // option. A lab cannot spawn labs, so the action disappears.
  await em.getByRole('button', { name: 'Add lab section' }).click()
  await expect(em.locator('#course-edit-title')).toHaveText('Edit ANTH 160L A1')
  await expect(em.getByRole('button', { name: 'Add lab section' })).toHaveCount(0)

  // The lab is unscheduled: it sits in the strip behind the modal, identified
  // by the registrar's shapes (course number 160L, section A1) — no LAB chip.
  const strip = page.locator('.no-meeting-strip')
  const labPill = strip.locator('.slot-pill', { hasText: 'ANTH 160L' })
  await labPill.first().waitFor({ timeout: 5000 })
  await expect(labPill.first()).toContainText('ANTH 160L')
  await expect(labPill.first()).toContainText('A1')

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

test('lab sections: add another lab from a lab editor (copies the lab)', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Lab siblings')

  // Edit mode; add a lecture (its editor opens pre-slotted).
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('ANTH 160')
  await addm.locator('.schedule-add-option', { hasText: 'ANTH 160' }).first().click()

  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })

  // First lab from the lecture: the editor switches to it.
  await em.getByRole('button', { name: 'Add lab section' }).click()
  await expect(em.locator('#course-edit-title')).toHaveText('Edit ANTH 160L A1')

  // From the lab, "Add another lab section" makes the next lab and switches to
  // it; a lab has no "Add another meeting time" (labs are not meetings).
  await expect(em.getByRole('button', { name: 'Add another meeting time' })).toHaveCount(0)
  await em.getByRole('button', { name: 'Add another lab section' }).click()
  await expect(em.locator('#course-edit-title')).toHaveText('Edit ANTH 160L A2')

  // Saving the unscheduled pair leaves both labs in the strip, keyed apart.
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  const strip = page.locator('.no-meeting-strip')
  const labPills = strip.locator('.slot-pill', { hasText: 'ANTH 160L' })
  await expect(labPills).toHaveCount(2)
  await expect(labPills.filter({ hasText: 'A1' })).toHaveCount(1)
  await expect(labPills.filter({ hasText: 'A2' })).toHaveCount(1)

  assertClean(errors)
})

test('no-meeting strip keys a lecture and its labs apart and survives filter toggles', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page)
  await createSchedule(page, 'Strip test')

  // Edit mode; add ANTH 160 (pre-slotted) with a lab (the editor switches to
  // the lab; saving it unscheduled lands it in the strip), then a second
  // department's course.
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.getByRole('button', { name: 'Add lab section' }).click()
  // The editor switched to the new lab; save it unscheduled to close it.
  await expect(em.locator('#course-edit-title')).toHaveText('Edit ANTH 160L A1')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
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

// The table ("spreadsheet") view: a compact row per offering with a department
// selector, in-place editing inside a session, and the full editor as the
// escape hatch for labs/cross-listing. Two populated schedules make the
// session's reference dimming observable.
test('table view: department filter, inline edit, add and remove', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'table-user')
  await createPopulatedSchedule(page, 'Table schedule')
  await createPopulatedSchedule(page, 'Table ref schedule')

  // Table is its own view route, reached from the toolbar.
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page).toHaveURL(/#\/table$/)
  const table = page.locator('.schedule-table')
  await table.waitFor({ state: 'visible', timeout: 5000 })
  const rows = table.locator('.schedule-table-row')
  const initialCount = await rows.count()
  expect(initialCount).toBeGreaterThan(0)

  // The filter rows are collapsible: Departments open, Instructors closed by
  // default. Non-matching rows are hidden.
  const deptGroup = table.locator('.schedule-table-filter-group', { hasText: 'Departments' })
  const deptToggle = deptGroup.locator('.schedule-table-filter-toggle')
  const deptChips = deptGroup.locator('.filter-chip')
  const instrGroup = table.locator('.schedule-table-filter-group', { hasText: 'Instructors' })
  const instrToggle = instrGroup.locator('.schedule-table-filter-toggle')
  const instrChips = instrGroup.locator('.filter-chip')
  await expect(deptToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(deptChips.first()).toBeVisible()
  await expect(instrToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(instrChips.first()).toBeHidden()

  // Pick two departments and check every remaining row belongs to one of them.
  const chipLabel = async (chip) => (await chip.innerText()).trim().replace(/\s*\(mine\)$/, '')
  const deptA = await chipLabel(deptChips.nth(0))
  await deptChips.nth(0).click()
  const codesA = await table.locator('.schedule-table-code .course-code-cell').allTextContents()
  expect(codesA.length).toBeGreaterThan(0)
  for (const c of codesA) expect(c.trim().startsWith(`${deptA} `)).toBeTruthy()
  await expect(page).toHaveURL(new RegExp(`dept=${deptA}`))

  let deptB = deptA
  if ((await deptChips.count()) > 1) {
    deptB = await chipLabel(deptChips.nth(1))
    await deptChips.nth(1).click()
    const codesAB = await table.locator('.schedule-table-code .course-code-cell').allTextContents()
    const prefixes = new Set(codesAB.map((c) => c.trim().split(' ')[0]))
    for (const p of prefixes) expect([deptA, deptB]).toContain(p)
    expect(codesAB.length).toBeGreaterThanOrEqual(codesA.length)
    await expect(page).toHaveURL(new RegExp(`dept=${deptA}`))
    await expect(page).toHaveURL(new RegExp(`dept=${deptB}`))
  }

  // Instructor chips narrow further; expand the row first. Pick one that leads
  // a visible row, so the result is non-empty (full-roster matching is
  // unit-tested).
  await instrToggle.click()
  await expect(instrToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(instrChips.first()).toBeVisible()
  const leadTexts = await table.locator('.schedule-table-instructor .schedule-table-value').allTextContents()
  const chipCount = await instrChips.count()
  let instrIndex = 0
  for (let i = 0; i < chipCount; i++) {
    const label = (await instrChips.nth(i).innerText()).trim()
    if (leadTexts.some((t) => t.trim().startsWith(label))) {
      instrIndex = i
      break
    }
  }
  const beforeInstr = await rows.count()
  const instrLabel = (await instrChips.nth(instrIndex).innerText()).trim()
  await instrChips.nth(instrIndex).click()
  await expect(page).toHaveURL(/instructor=/)
  const afterInstr = await rows.count()
  expect(afterInstr).toBeGreaterThan(0)
  expect(afterInstr).toBeLessThanOrEqual(beforeInstr)

  // The filters ride in the URL, so a detour to the course view and back via
  // the Table tab restores them.
  await table.locator('.schedule-table-code .course-code-cell').first().click()
  await expect(page).toHaveURL(/#\/course\//)
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page).toHaveURL(/instructor=/)
  await expect(page).toHaveURL(new RegExp(`dept=${deptA}`))
  await expect(deptChips.nth(0)).toHaveAttribute('aria-pressed', 'true')
  expect(await rows.count()).toBe(afterInstr)

  // The remount (deep-link arrival) opens the instructor row. Collapsing it
  // keeps the selected chip visible (the rest hide), so the filter is clear.
  await expect(instrToggle).toHaveAttribute('aria-expanded', 'true')
  await instrToggle.click()
  await expect(instrToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(instrGroup.locator('.filter-chip:visible')).toHaveCount(1)
  await expect(instrGroup.locator('.schedule-table-filter-selected .filter-chip')).toContainText(instrLabel)
  await expect(instrToggle).toContainText('1 selected')
  await expect(page).toHaveURL(/instructor=/)
  expect(await rows.count()).toBe(afterInstr)

  // The visible selected chip removes its filter (rows grow back).
  await instrGroup.locator('.schedule-table-filter-selected .filter-chip').click()
  await expect(page).not.toHaveURL(/instructor=/)
  expect(await rows.count()).toBeGreaterThan(afterInstr)

  // Clear restores every row and drops the query.
  await table.locator('.filter-clear').click()
  await expect(page).not.toHaveURL(/dept=|instructor=/)
  expect(await rows.count()).toBe(initialCount)

  // Outside a session the table is read-only: values render as spans.
  await expect(table.locator('.schedule-table-hint')).toContainText('Read-only')
  await expect(table.locator('.schedule-table-value-edit')).toHaveCount(0)

  // Enter edit on one schedule: its rows become editable, the other's dim.
  await page.locator('.schedule-pill', { hasText: 'Table schedule' }).locator('.schedule-pill-edit').click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await expect(table.locator('.schedule-table-value-edit').first()).toBeVisible()
  expect(await table.locator('.schedule-table-row.reference').count()).toBeGreaterThan(0)

  // Inline-edit the first live lecture: title and seats commit on Enter.
  const live = table.locator('.schedule-table-row:not(.reference):not(.lab)').first()
  await live.locator('td').nth(1).locator('.schedule-table-value-edit').click()
  await live.locator('.schedule-table-input').fill('E2E Table Topic')
  await live.locator('.schedule-table-input').press('Enter')
  await expect(live).toContainText('E2E Table Topic')
  await live.locator('button[aria-label^="Edit seats of"]').click()
  await live.locator('.schedule-table-input').fill('99')
  await live.locator('.schedule-table-input').press('Enter')
  await expect(live.locator('button[aria-label^="Edit seats of"]')).toHaveText('99')

  // The meeting picker offers the term's standard bands; pick one.
  // First: opening and cancelling (Esc, or clicking away) leaves it untouched.
  const originalMeeting = (await live.locator('button[aria-label^="Edit meeting of"]').innerText()).trim()
  await live.locator('button[aria-label^="Edit meeting of"]').click()
  await live.locator('select[aria-label^="Meeting of"]').waitFor({ state: 'visible', timeout: 5000 })
  await live.locator('select[aria-label^="Meeting of"]').press('Escape')
  await expect(live.locator('select[aria-label^="Meeting of"]')).toHaveCount(0)
  await expect(live.locator('button[aria-label^="Edit meeting of"]')).toHaveText(originalMeeting)

  await live.locator('button[aria-label^="Edit meeting of"]').click()
  await live.locator('select[aria-label^="Meeting of"]').waitFor({ state: 'visible', timeout: 5000 })
  await table.locator('.schedule-table-count').click()
  await expect(live.locator('select[aria-label^="Meeting of"]')).toHaveCount(0)
  await expect(live.locator('button[aria-label^="Edit meeting of"]')).toHaveText(originalMeeting)

  await live.locator('button[aria-label^="Edit meeting of"]').click()
  await live.locator('select[aria-label^="Meeting of"]').selectOption('TR|10:00-11:45')
  await expect(live.locator('button[aria-label^="Edit meeting of"]')).toContainText(
    'TR · 10:00 AM - 11:45 AM',
  )

  // Custom falls back to one typed field ("MW 14:00-15:00").
  await live.locator('button[aria-label^="Edit meeting of"]').click()
  await live.locator('select[aria-label^="Meeting of"]').selectOption('__custom')
  await live.locator('input[aria-label^="Meeting of"]').fill('MW 14:00-15:00')
  await live.locator('input[aria-label^="Meeting of"]').press('Enter')
  await expect(live.locator('button[aria-label^="Edit meeting of"]')).toContainText('MW · 2:00 PM - 3:00 PM')

  // The instructor cell autocompletes; picking a suggestion commits it.
  await live.locator('button[aria-label^="Edit instructor of"]').click()
  const suggests = live.locator('.schedule-table-combo-dropdown .course-picker-option')
  await suggests.first().waitFor({ timeout: 5000 })
  expect(await suggests.count()).toBeGreaterThan(0)
  const picked = (await suggests.first().innerText()).trim()
  await suggests.first().click()
  await expect(live.locator('button[aria-label^="Edit instructor of"]')).toContainText(picked)

  // Co-teachers aren't editable in the cell, so it shows the lead + a count;
  // the editor manages the rest. Add one via the pencil, then check the cell.
  await live.locator('.schedule-table-action').first().click()
  const coEm = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await coEm.waitFor({ state: 'visible', timeout: 5000 })
  await ensureOtherInstructors(coEm)
  await coEm.getByPlaceholder('e.g. Smith, Jones').fill('Co Teacher')
  await coEm.getByRole('button', { name: 'Save changes' }).click()
  await coEm.waitFor({ state: 'detached', timeout: 5000 })
  const instructorBtn = live.locator('button[aria-label^="Edit instructor of"]')
  await expect(instructorBtn).toContainText('+1')
  // The cell's editor shows only the lead, not the co-teacher.
  const leadOnly = (await instructorBtn.innerText()).trim().replace(/\s*\+1$/, '')
  await instructorBtn.click()
  await expect(live.locator('input[aria-label^="Instructor of"]')).toHaveValue(leadOnly)
  await live.locator('input[aria-label^="Instructor of"]').press('Escape')

  // The row pencil opens the full course editor; Cancel returns to the table.
  await live.locator('.schedule-table-action').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(page).toHaveURL(/#\/table/)
  await table.waitFor({ state: 'visible', timeout: 5000 })

  // Add from the table header: the editor opens, saving lands a new row.
  const beforeAdd = await rows.count()
  await table.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal[aria-labelledby="schedule-add-course-title"]')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('BIO')
  await addm.locator('.schedule-add-option').first().click()
  const addEm = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await addEm.waitFor({ state: 'visible', timeout: 5000 })
  await addEm.getByRole('button', { name: 'Save changes' }).click()
  await addEm.waitFor({ state: 'detached', timeout: 5000 })
  await expect(rows).toHaveCount(beforeAdd + 1)

  // Remove a live row (accept the confirm); the table shrinks.
  page.on('dialog', (d) => d.accept())
  const beforeRemove = await rows.count()
  await table
    .locator('.schedule-table-row:not(.reference):not(.lab)')
    .first()
    .locator('button[aria-label^="Remove"]')
    .click()
  await expect.poll(async () => rows.count(), { timeout: 5000 }).toBeLessThan(beforeRemove)

  await settle(page)
  // Scope to the table surface: the picker's pre-existing reference-pill
  // dimming fails contrast in any multi-schedule edit session (a separate,
  // out-of-scope accessibility fix).
  const editingViolations = await seriousViolations(page, '.schedule-table')
  expect(brief(editingViolations), 'table view (editing)').toEqual([])
  await assertTargetSize(page, ['.schedule-table-value-edit', '.schedule-table-action'], 'table view')

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
  await assertTargetSize(
    page,
    ['.schedule-pill-edit', '.schedule-pill-suggest', '.schedule-pill-hide'],
    'grid view',
  )

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
  // aren't owned, so their pencil defaults to Suggest rather than Edit, and the
  // empty "Axe schedule" has no rows to size.
  await page
    .locator('.schedule-pill', { hasText: 'Axe create' })
    .locator('.schedule-pill-edit')
    .first()
    .click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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

  // The course editor: scan it open (the collapsed "Other instructors"
  // trigger is visible), its instructor dropdown (which carries the scope
  // link), then its discard-confirm state.
  await page.locator('.filter-offering-edit').first().click()
  await settle(page)
  const editDialog = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await editDialog.waitFor({ state: 'visible', timeout: 5000 })
  const editViolations = await seriousViolations(page, '.modal[aria-labelledby="course-edit-title"]')
  expect(brief(editViolations), 'course editor dialog').toEqual([])
  await editDialog.locator('#course-edit-instructor').focus()
  await settle(page)
  const dropdownViolations = await seriousViolations(page, '.modal[aria-labelledby="course-edit-title"]')
  expect(brief(dropdownViolations), 'instructor dropdown').toEqual([])
  // Blur the combobox (focus the section field) so its dropdown closes, then
  // make the form dirty to reach the discard-confirm state.
  await editDialog.locator('#course-edit-section').focus()
  await ensureOtherInstructors(editDialog)
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

  // The copy-courses wizard: edit the empty "Axe schedule" and source the
  // populated "Axe create", then scan the review step's checkbox list and its
  // add/update tags.
  await page
    .locator('.schedule-pill', { hasText: 'Axe schedule' })
    .locator('.schedule-pill-edit')
    .first()
    .click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: /Copy courses/ }).click()
  const copyDialog = page.locator('.modal[aria-labelledby="schedule-copy-title"]')
  await copyDialog.waitFor({ state: 'visible', timeout: 5000 })
  await copyDialog.locator('#schedule-copy-source').selectOption({ label: 'Axe create' })
  await copyDialog.getByRole('button', { name: /Review \d+ course/ }).click()
  await settle(page)
  const copyViolations = await seriousViolations(
    page,
    '.modal[aria-labelledby="schedule-copy-title"]',
  )
  expect(brief(copyViolations), 'copy courses review step').toEqual([])
  await copyDialog.getByRole('button', { name: 'Cancel' }).click()
  await copyDialog.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // The core-requirements quick-stats dialog (opened from the picker cluster).
  await page.getByRole('button', { name: 'Core stats' }).click()
  const statsDialog = page.locator('.modal[aria-labelledby="core-stats-title"]')
  await statsDialog.waitFor({ state: 'visible', timeout: 5000 })
  await settle(page)
  const statsViolations = await seriousViolations(page, '.modal[aria-labelledby="core-stats-title"]')
  expect(brief(statsViolations), 'core stats dialog').toEqual([])
  await statsDialog.getByRole('button', { name: 'Close' }).click()
  await statsDialog.waitFor({ state: 'detached', timeout: 5000 })

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

// Seats ride per offering row: imported from the CSV's seats column, shown in
// the course view, and edited in the course editor.
test('seats: imported counts show in the course view and persist an editor edit', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'seats-user')

  // Import the registrar fixture (CS 220 carries seats 30).
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', 'apps/schedule/e2e/import.csv')
  await expect(page.getByText(/Imported 9 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Seats demo')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Seats demo' }).first().waitFor({ timeout: 10000 })

  // The course view reads the imported count off the offering.
  await page.goto('/#/course/CS%20220', { waitUntil: 'networkidle' })
  await expect(page.locator('.detail-header h2')).toHaveText('CS 220')
  await expect(page.getByText('Seats: 30')).toBeVisible()

  // The course editor surfaces the same value and persists an edit.
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  const block = page.locator('.cal-block[title="CS 220"]').first()
  await block.locator('.cal-block-time').click()
  await block
    .locator('.filter-offering', { hasText: 'CS 220' })
    .locator('.filter-offering-edit')
    .first()
    .click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-seats')).toHaveValue('30')
  await em.locator('#course-edit-seats').fill('42')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  // Reopening shows the saved value.
  await block
    .locator('.filter-offering', { hasText: 'CS 220' })
    .locator('.filter-offering-edit')
    .first()
    .click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-seats')).toHaveValue('42')
  await em.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // The course view reflects the edit.
  await page.goto('/#/course/CS%20220', { waitUntil: 'networkidle' })
  await expect(page.getByText('Seats: 42')).toBeVisible()

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Seats demo' })
    .getByRole('button', { name: 'Delete Seats demo' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// Offering titles: imported from the CSV, shown in the course view, edited in
// the course editor (where a lab's field is disabled and mirrors its lecture),
// and resolved in the CSV exports.
test('offering titles: imported, shown in the course view, edited, and exported', async ({
  page,
  request,
}) => {
  // Seed one directory name so the export's "Last, First" column resolves for a
  // known instructor; the rest fall back to their usernames. The request
  // context is separate from the page, so this does not touch the page session.
  await request.post('/api/auth/login', { data: { username: 'registrar' } })
  await request.post('/api/admin/users', { data: { username: 'wahl', displayName: 'John Wahl' } })

  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'title-user')

  // Import the registrar fixture (MUS 001 carries a special-topics title).
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', 'apps/schedule/e2e/import.csv')
  await expect(page.getByText(/Imported 9 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Title demo')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Title demo' }).first().waitFor({ timeout: 10000 })

  // The summary CSV carries the title column (after the section, before the
  // instructor), writes an explicit title as-is, and resolves a blank offering
  // title to the catalog name (never blank).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('.schedule-csv-wrap button').first().click()
      await page.getByRole('button', { name: 'Download summary CSV' }).click()
    })(),
  ])
  const summary = readFileSync(await download.path(), 'utf8')
  // The header is the canonical column list plus `term` (compared against the
  // exported constant, so adding a column needs no edit here). The body is read
  // back through parseCsv, so cell lookups are by column name, not position.
  expect(summary.split('\n')[0].split(',')).toEqual([...CSV_COLUMNS, 'term'])
  // The username instructor columns sit before the core-requirement column,
  // which sits just before the term.
  // The username instructor columns sit before the core-requirement and
  // cross-listing columns, which sit just before the term.
  expect(summary.split('\n')[0].endsWith('instructor,secondary_instr,core_reqs,cross_listed,term')).toBe(true)
  // The directory resolves the "Last, First" name column; instructors absent
  // from it fall back to their usernames (still covered by parseCsv below).
  expect(summary).toContain('"Wahl, John"')
  const rows = parseCsv(summary)
  expect(rows.find((r) => r.prefix === 'MUS' && r.number === '001').title).toBe('Special Topics: Choir')
  // The core_reqs column is resolved from the catalog: CS 220 satisfies SM; a
  // course with no area exports a blank cell (parseCsv reads it as []).
  expect(rows.find((r) => r.prefix === 'CS' && r.number === '220').coreReqs).toEqual(['SM'])
  expect(rows.find((r) => r.prefix === 'MAT' && r.number === '131').coreReqs).toEqual([])
  expect(
    rows.find((r) => r.prefix === 'CS' && r.number === '220').title,
    'a blank offering title resolves to the catalog name',
  ).not.toBe('')

  // The course view shows the special-topics title.
  await page.goto('/#/course/MUS%20001', { waitUntil: 'networkidle' })
  await expect(page.locator('.offering-title').first()).toHaveText('Special Topics: Choir')

  // Edit a title in the course editor (CS 220, Fall) and see it persist.
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  const block = page.locator('.cal-block[title="CS 220"]').first()
  await block.locator('.cal-block-time').click()
  await block
    .locator('.filter-offering', { hasText: 'CS 220' })
    .locator('.filter-offering-edit')
    .first()
    .click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-offering-title')).toHaveValue('')
  await em.locator('#course-edit-offering-title').fill('Intro to Programming')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await block
    .locator('.filter-offering', { hasText: 'CS 220' })
    .locator('.filter-offering-edit')
    .first()
    .click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-offering-title')).toHaveValue('Intro to Programming')
  await em.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // The course view now shows the edited title.
  await page.goto('/#/course/CS%20220', { waitUntil: 'networkidle' })
  await expect(page.getByText('Intro to Programming')).toBeVisible()

  // A lab's title field is disabled and mirrors its lecture (Spring: BIO 166L
  // imported "Bogus Lab" but takes the lecture's "Genetics").
  await page.getByRole('button', { name: 'Grid', exact: true }).click()
  await page.getByRole('button', { name: 'Spring', exact: true }).click()
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  const labRow = page
    .locator('.cal-block', { hasText: 'BIO 166L A1' })
    .first()
    .locator('.filter-offering', { hasText: 'BIO 166L' })
  await labRow.locator('.filter-offering-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-offering-title')).toBeDisabled()
  await expect(em.locator('#course-edit-offering-title')).toHaveValue('Genetics')
  await em.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Title demo' })
    .getByRole('button', { name: 'Delete Title demo' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// Core requirements across the app: a course's areas show in the course view,
// the core_reqs column is validated on import (disagreements flagged), the
// calendar filters by area, and the picker's Core stats popup tabulates
// offerings/seats per area.
test('core requirements: course view, import flags, filter, and quick stats', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'core-user')

  // Import a sheet whose core_reqs column differs from the catalog in two rows
  // (noted informationally, never blocking): BIO 161 omits QL, and ANTH 160
  // claims LA though the catalog lists no areas for it. CS 220's SM agrees;
  // MAT 131 is not a catalog course at all, so it is counted (not noted); ENG
  // 111's blank cell is not compared.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', 'apps/schedule/e2e/import-core.csv')
  await expect(page.getByText(/Imported 5 course row\(s\)/)).toBeVisible()
  await expect(
    page.getByText(/2 row\(s\) carry core requirements that differ from our catalog snapshot/),
  ).toBeVisible()
  await expect(page.getByText(/\(1 course\(s\) not in the catalog\)/)).toBeVisible()
  await expect(page.getByText(/BIO 161 A: file says SM, SL · catalog says SM, SL, QL/)).toBeVisible()
  await expect(page.getByText(/ANTH 160 A: file says LA · catalog says —/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Core demo')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Core demo' }).first().waitFor({ timeout: 10000 })

  // The course view lists the area on the right.
  await page.goto('/#/course/CS%20220', { waitUntil: 'networkidle' })
  const aside = page.locator('.course-detail-aside')
  await expect(aside.locator('.core-req-id')).toHaveText('SM')
  await expect(aside).toContainText('Scientific, Mathematical and Algorithmic Methods')

  // A laboratory course carries the SL designation alongside SM.
  await page.goto('/#/course/BIO%20161', { waitUntil: 'networkidle' })
  await expect(page.locator('.course-detail-aside')).toContainText('SL')

  // The core filter narrows the grid: SM keeps CS 220 and drops ANTH 160.
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page
    .getByRole('group', { name: 'Filter by' })
    .getByRole('button', { name: /Core reqs/ })
    .click()
  await page.locator('.filter-panel').getByRole('button', { name: 'SM', exact: true }).click()
  await expect(page.locator('.cal-block[title="CS 220"]').first()).toBeVisible()
  await expect(page.locator('.cal-block[title="ANTH 160"]')).toHaveCount(0)

  // The quick-stats popup tabulates per area: SM Fall = 2 offerings, 54 seats.
  await page.getByRole('button', { name: 'Core stats' }).click()
  const dialog = page.locator('.modal[aria-labelledby="core-stats-title"]')
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  const smRow = dialog.getByRole('row', { name: /Scientific, Mathematical and Algorithmic Methods/ })
  await expect(smRow.locator('td').nth(1)).toHaveText('2 · 54')
  await expect(smRow.locator('td').nth(4)).toHaveText('2 · 54')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 5000 })

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Core demo' })
    .getByRole('button', { name: 'Delete Core demo' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// Core stats collapses cross-listed versions of one course into a single
// offering and shared seat pool (they are the same physical section).
test('core stats: cross-listed versions count once', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'core-xlist-user')

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'core-cross.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,days,times,seats,term\n' +
        'CS,263,A,Wahl,MWF,9:20-10:30,24,F\n' +
        'ENGR,263,A,Wahl,MWF,9:20-10:30,24,F\n',
    ),
  })
  await expect(page.getByText(/Imported 2 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Core cross')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Core cross' }).first().waitFor({ timeout: 10000 })

  // The PP area lists both codes, but the versions share one 24-seat pool, so
  // the area counts one offering and 24 seats, not two and 48.
  await page.getByRole('button', { name: 'Core stats' }).click()
  const dialog = page.locator('.modal[aria-labelledby="core-stats-title"]')
  await dialog.waitFor({ state: 'visible', timeout: 5000 })
  const ppRow = dialog.getByRole('row', { name: /Philosophical Perspectives/ })
  await expect(ppRow.locator('td').nth(1)).toHaveText('1 · 24')
  await expect(ppRow.locator('td').nth(4)).toHaveText('1 · 24')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 5000 })

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Core cross' })
    .getByRole('button', { name: 'Delete Core cross' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// Cross-listing: the import flags a group whose versions disagree, and the
// summary CSV lists each version's materialized sibling prefixes.
test('cross-listing: import flags and the export column', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'xlist-flags-user')

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'cross.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,days,times,seats,cross_listed,term\n' +
        'CS,263,A,Wahl,MWF,9:20-10:30,30,ENGR,F\n' +
        'ENGR,263,A,Wahl,MWF,10:00-11:45,30,CS,F\n',
    ),
  })
  await expect(page.getByText(/Imported 2 course row\(s\)/)).toBeVisible()
  await expect(page.getByText(/1 cross-listing note\(s\)/)).toBeVisible()
  await expect(page.getByText(/CS 263, ENGR 263 A disagree on shared fields/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Cross flags')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Cross flags' }).first().waitFor({ timeout: 10000 })

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('.schedule-csv-wrap button').first().click()
      await page.getByRole('button', { name: 'Download summary CSV' }).click()
    })(),
  ])
  const summary = readFileSync(await download.path(), 'utf8')
  expect(summary.split('\n')[0].endsWith('core_reqs,cross_listed,term')).toBe(true)
  const rows = parseCsv(summary)
  expect(rows.find((r) => r.prefix === 'CS' && r.number === '263').crossListed).toEqual(['ENGR'])
  expect(rows.find((r) => r.prefix === 'ENGR' && r.number === '263').crossListed).toEqual(['CS'])

  // The course view names the cross-listing.
  await page.goto('/#/course/CS%20263', { waitUntil: 'networkidle' })
  await expect(page.locator('.cross-list-note')).toContainText('Also listed as ENGR 263')

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Cross flags' })
    .getByRole('button', { name: 'Delete Cross flags' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// Cross-listing: the owner materializes the missing versions and edits cascade.
test('cross-listing: materialize versions and cascade an edit', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'xlist-flow-user')

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'cross-solo.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,days,times,seats,term\n' +
        'ENGR,263,A,Wahl,MWF,9:20-10:30,30,F\n',
    ),
  })
  await expect(page.getByText(/Imported 1 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Cross solo')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Cross solo' }).first().waitFor({ timeout: 10000 })

  const schedules = await page.evaluate(() => fetch('../../api/schedules').then((r) => r.json()))
  const id = schedules.schedules.find((s) => s.name === 'Cross solo').id

  // The ENGR editor offers to create the missing CS version.
  await page.goto(`/#/schedule/${id}/course/ENGR%20263/edit`, { waitUntil: 'networkidle' })
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('.cross-list-block')).toContainText('Cross-listed:')
  await expect(em.locator('.cross-list-block')).toContainText('Not listed this term: CS 263')
  await em.getByRole('button', { name: 'Create cross-listed versions' }).click()
  await expect(em.getByText(/Created CS 263/)).toBeVisible()

  // The owner edits the ENGR version; the CS version follows and the group is
  // now owned by ENGR.
  await em.locator('#course-edit-instructor').fill('Skiadas')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  await page.goto(`/#/schedule/${id}/course/CS%20263/edit`, { waitUntil: 'networkidle' })
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await expect(em.locator('#course-edit-instructor')).toHaveValue('Skiadas')
  await expect(em.locator('.cross-list-block')).toContainText('maintained by ENGR')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Cross solo' })
    .getByRole('button', { name: 'Delete Cross solo' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// The registrar's own export renames some columns and marks one version of a
// cross-listed group as the parent. The parser accepts both spellings; the
// parent notation becomes the same cross-listing claims the app validates.
test('registrar CSV: renamed columns and parent notation', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'registrar-format-user')

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()

  // A parent that disagrees with the catalog (MAT 131 is not in CS 263's group)
  // is flagged, exactly like an explicit cross_listed cell would be.
  await page.setInputFiles('.schedule-upload-input', {
    name: 'registrar-bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,course_title,instructor,instructor_name,secondary_instr,days,times,term,course_limit,course_max,core_requirements,cross_listed_parent_course\n' +
        'MAT,131,A,Calculus I,Aydogan,"Aydogan, Ali",,MWF,14:20-16:05,F,24,99,,NULL\n' +
        'CS,263,A,Special Topics: Film,Wahl,"Wahl, John",,MWF,9:20-10:30,F,30,99,,MAT 131 A\n',
    ),
  })
  await expect(page.getByText(/2 cross-listing note\(s\)/)).toBeVisible()
  await expect(page.getByText(/CS 263 A: claims MAT/)).toBeVisible()

  // The registrar's renamed columns (course_title, course_limit, parenthesized
  // core_requirements) import cleanly when they agree with the catalog.
  await page.setInputFiles('.schedule-upload-input', {
    name: 'registrar.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,course_title,instructor,instructor_name,secondary_instr,days,times,term,course_limit,course_max,core_requirements,cross_listed_parent_course\n' +
        'CS,263,A,Special Topics: Film,Wahl,"Wahl, John",,MWF,9:20-10:30,F,30,99,"(PP) (W2)",\n' +
        'ENGR,263,A,Special Topics: Film,Wahl,"Wahl, John",,MWF,9:20-10:30,F,30,99,"(PP) (W2)",CS  263  A     \n',
    ),
  })
  await expect(page.getByText(/Imported 2 course row\(s\)/)).toBeVisible()
  await expect(page.getByText(/cross-listing note/)).toHaveCount(0)
  await expect(page.getByText(/differ from our catalog snapshot/)).toHaveCount(0)
  await page.locator('#schedule-create-name').fill('Registrar demo')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Registrar demo' }).first().waitFor({ timeout: 10000 })

  // course_limit became the seat count; course_title the offering's own title.
  await page.goto('/#/course/CS%20263', { waitUntil: 'networkidle' })
  await expect(page.locator('.req-block').first()).toContainText('Seats: 30')
  await expect(page.locator('.offering-title').first()).toHaveText('Special Topics: Film')

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Registrar demo' })
    .getByRole('button', { name: 'Delete Registrar demo' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

// The imported file is the source of truth for a row's core areas: a row whose
// areas differ from the catalog drives the course view (the catalog only fills
// in for untagged rows), and the import summary just notes the difference.
test('imported core requirements drive the course view over the catalog', async ({ page }) => {
  const errors = trackErrors(page)
  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'core-authority-user')

  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  // The catalog lists HFA 048 under HW only; the file claims HW and AF.
  await page.setInputFiles('.schedule-upload-input', {
    name: 'authority.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,course_title,instructor,instructor_name,secondary_instr,days,times,term,course_limit,course_max,core_requirements,cross_listed_parent_course\n' +
        'HFA,048,A,Yoga and Pilates,Wahl,"Wahl, John",,MWF,9:20-10:30,F,12,99,"(HW) (AF)",\n',
    ),
  })
  await expect(page.getByText(/Imported 1 course row\(s\)/)).toBeVisible()
  await expect(
    page.getByText(/1 row\(s\) carry core requirements that differ from our catalog snapshot/),
  ).toBeVisible()
  await page.locator('#schedule-create-name').fill('Authority demo')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Authority demo' }).first().waitFor({ timeout: 10000 })

  // The course view shows the file's areas (HW and AF), not the catalog's.
  await page.goto('/#/course/HFA%20048', { waitUntil: 'networkidle' })
  const aside = page.locator('.course-detail-aside')
  await expect(aside.locator('.core-req-id')).toHaveText(['HW', 'AF'])

  // Clean up.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Authority demo' })
    .getByRole('button', { name: 'Delete Authority demo' })
    .click()
  await closeManage(page)
  assertClean(errors)
})

test('instructor full names resolve in the course view, the filter pills, and the editor', async ({
  page,
  request,
}) => {
  const errors = trackErrors(page)
  // Seed a directory name so the stored username 'wahl' displays as a full
  // name; 'albers' stays unseeded to prove the raw fallback.
  await request.post('/api/auth/login', { data: { username: 'registrar' } })
  await request.post('/api/admin/users', {
    data: { username: 'wahl', displayName: 'John Wahl', departments: ['CS'] },
  })

  await page.goto('/', { waitUntil: 'networkidle' })
  await signIn(page, 'names-user')

  // Import a schedule whose instructor cells are usernames.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.getByRole('button', { name: 'Import CSV…' }).click()
  await page.setInputFiles('.schedule-upload-input', {
    name: 'names.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'dept_prefix,course_number,course_section,instructor,secondary_instr,days,times,term\n' +
        'CS,220,A,wahl,,MWF,9:20-10:30,F\n' +
        'MAT,121,A,albers,,TR,10:00-11:45,F\n',
    ),
  })
  await expect(page.getByText(/Imported 2 course row\(s\)/)).toBeVisible()
  await page.locator('#schedule-create-name').fill('Names roster')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await closeManage(page)
  await page.locator('.schedule-pill', { hasText: 'Names roster' }).first().waitFor({ timeout: 10000 })

  // The course view shows the resolved full name, and the raw value otherwise.
  await page.goto('/#/course/CS%20220', { waitUntil: 'networkidle' })
  await expect(page.locator('.faculty-link', { hasText: 'John Wahl' })).toBeVisible()
  await page.goto('/#/course/MAT%20121', { waitUntil: 'networkidle' })
  await expect(page.locator('.faculty-link', { hasText: 'albers' })).toBeVisible()

  // The instructor filter pills show full names too (keyed on the stored value).
  await page.goto('/#/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Instructors/ }).click()
  await expect(page.locator('.filter-chip', { hasText: 'John Wahl' })).toBeVisible()
  await expect(page.locator('.filter-chip', { hasText: 'albers' })).toBeVisible()

  // The editor opens on the full name; typing a full-name prefix offers the
  // directory person, and picking stores the canonical username again.
  await page
    .locator('.schedule-pill', { hasText: 'Names roster' })
    .locator('.schedule-pill-edit')
    .first()
    .click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
  const csBlock = page.locator('.cal-block[title="CS 220"]').first()
  await csBlock.locator('.cal-block-time').click()
  await csBlock.locator('.filter-offering-edit').first().click()
  const em = page.locator('.modal[aria-labelledby="course-edit-title"]')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  const inst = em.locator('#course-edit-instructor')
  await expect(inst).toHaveValue('John Wahl')
  await inst.fill('John')
  await inst.focus()
  await em.locator('.course-picker-option', { hasText: 'John Wahl' }).first().click()
  await expect(inst).toHaveValue('John Wahl')
  await em.getByRole('button', { name: 'Save changes' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // The stored value is still the canonical username (the CSV export proves it).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.locator('.schedule-csv-wrap button').first().click()
      await page.getByRole('button', { name: 'Download summary CSV' }).click()
    })(),
  ])
  const summary = readFileSync(await download.path(), 'utf8')
  const row = parseCsv(summary).find((r) => r.prefix === 'CS' && r.number === '220')
  expect(row.instructor).toBe('wahl')

  // Clean up the shared server collection.
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page
    .locator('.schedule-manage-row', { hasText: 'Names roster' })
    .getByRole('button', { name: 'Delete Names roster' })
    .click()
  await closeManage(page)
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
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })
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
  // Bob may suggest, not edit: only the Suggest bubble renders.
  await expect(row.getByRole('button', { name: 'Suggest changes for Access schedule' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Edit Access schedule' })).toHaveCount(0)

  // Bob is a suggester but has no directory departments, so entering a suggest
  // session leaves every course uneditable (no pencils) and the panel explains
  // the department limit.
  await row.getByRole('button', { name: 'Suggest changes for Access schedule' }).click()
  await page.locator('.schedule-edit-chip', { hasText: 'Suggesting' }).first().waitFor({ timeout: 5000 })
  await expect(page.locator('.filter-offering-edit')).toHaveCount(0)
  await page.getByRole('button', { name: 'Suggested changes' }).click()
  const panel = page.locator('.modal[aria-labelledby="suggested-title"]')
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  await expect(panel.getByText(/no departments yet/i)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Done' }).click() // leave suggest mode

  // Carol: a viewer but not a suggester — neither action renders on her row.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await cluster.getByLabel('Username').fill('carol')
  await cluster.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Signed in as carol').waitFor({ timeout: 10000 })
  await page.getByRole('button', { name: /Your schedules/ }).click()
  const carolRow = page.locator('.schedule-manage-row', { hasText: 'Access schedule' })
  await carolRow.waitFor({ state: 'visible', timeout: 5000 })
  await expect(carolRow.getByRole('button', { name: 'Edit Access schedule' })).toHaveCount(0)
  await expect(carolRow.getByRole('button', { name: 'Suggest changes for Access schedule' })).toHaveCount(0)

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
  await signIn(page, 'registrar') // an admin (ADMIN_USERNAMES in the webServer env)

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
  await signIn(page, 'registrar') // the admin, to seed the directory

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
  await page.getByText('Signed in as Dept Only').waitFor({ timeout: 10000 })
  // We signed in from the admin route; leave it for the schedules view.
  await page.getByRole('link', { name: '← Schedules' }).click()
  await page.getByRole('button', { name: /Your schedules/ }).waitFor({ timeout: 10000 })
  await createPopulatedSchedule(page, 'Dept scope schedule')
  await page.locator('.schedule-pill-edit').first().click()
  await page.locator('.schedule-edit-chip', { hasText: 'Editing' }).first().waitFor({ timeout: 5000 })

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
