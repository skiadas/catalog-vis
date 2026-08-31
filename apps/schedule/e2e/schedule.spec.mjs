// E2E suite for the schedule app's core flows, ported from the old
// smoke.mjs script onto Playwright Test. Each test gets a fresh browser
// context (no cookies, empty localStorage), so each signs itself in; the
// suite is sequential (workers: 1) against one shared server, whose scratch
// DB the webServer config provisions. The suite fails on unexpected page
// errors and console errors (the pre-sign-in 401s and favicon misses are
// expected noise and filtered), exactly like the smoke script did.
import { test, expect } from '@playwright/test'

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
  await page
    .locator('.no-meeting-pattern', { hasText: 'No meeting time' })
    .first()
    .waitFor({ timeout: 5000 })

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
  await em.getByText(/Lab added — ANTH 160L A/).first().waitFor({ timeout: 5000 })
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
  await lectureBlock.locator('.filter-offering', { hasText: 'ANTH 160' }).locator('.filter-offering-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Remove course' }).click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await expect(page.locator('.cal-block').filter({ hasText: 'ANTH 160' })).toHaveCount(0)

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