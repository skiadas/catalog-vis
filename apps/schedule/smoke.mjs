// Local-only smoke test for the schedule app's core flows, run against the
// FULL stack: the Express server (temp DB, built apps from dist/) + a real
// headless browser (system Chrome via playwright-core). Walks the boot auth
// prompt (sign in), schedule creation, the edit/suggest mode menu, the meeting
// pattern guards (day-group switches, no-meeting strip, off-pattern rails),
// and a fresh visitor choosing "Work offline" (local-only testing mode, no
// 401s at boot), and fails on page errors or unexpected console errors.
// `npm run test:smoke`.
//
// Requirements: `npm run build` first (dist/<name> bundles are served), and a
// Chrome installation (or CHROME_PATH pointing at one). Not wired into CI.

import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { buildServer } from '../../server/src/index.js'

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
]
function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  return CHROME_CANDIDATES.find((p) => existsSync(p)) || null
}

async function fail(message) {
  console.error(`SMOKE FAIL: ${message}`)
  process.exitCode = 1
}

const chromePath = findChrome()
if (!chromePath) {
  console.error('SMOKE SKIP: no Chrome found. Set CHROME_PATH to a Chrome binary to run the smoke test.')
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'major-vis-smoke-'))
const dbPath = join(dir, 'smoke.db')
const env = { ...process.env, DB_PATH: dbPath, PORT: '0', HOST: '127.0.0.1' }
const { app, config } = await buildServer(env)

// The built app must exist — this smoke test exercises the deployed layout.
if (!existsSync(join(config.repoRoot, 'dist', 'schedule', 'index.html'))) {
  rmSync(dir, { recursive: true, force: true })
  console.error('SMOKE FAIL: dist/schedule is missing. Run `npm run build` first.')
  process.exit(1)
}

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s))
})
const port = server.address().port
const base = `http://127.0.0.1:${port}/apps/schedule/`

const browser = await chromium.launch({ executablePath: chromePath, headless: true })
const page = await browser.newPage()
const pageErrors = []
let trackingErrors = false
const unexpectedConsole = []
page.on('pageerror', (err) => {
  if (trackingErrors) pageErrors.push(String(err))
})
page.on('console', (msg) => {
  if (!trackingErrors || msg.type() !== 'error') return
  const text = msg.text()
  // Expected: favicon misses.
  if (text.includes('favicon')) return
  unexpectedConsole.push(text)
})

try {
  await page.goto(base, { waitUntil: 'networkidle' })

  // --- Sign in via the boot auth prompt ---
  await page.getByRole('dialog').waitFor({ timeout: 10000 })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await dialog.getByLabel('Username').fill('registrar')
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  await page.getByText('Signed in as registrar').waitFor({ timeout: 10000 })
  trackingErrors = true

  // --- Create a schedule (modal closes only after the server confirms) ---
  await page.getByRole('button', { name: /Your schedules/ }).click()
  await page.getByRole('button', { name: '＋ New schedule' }).click()
  await page.locator('#schedule-create-name').fill('Smoke schedule')
  await page.getByRole('button', { name: 'Generate' }).click()
  await page.locator('#schedule-create-name').waitFor({ state: 'detached', timeout: 10000 })
  await page.getByText('Smoke schedule').first().waitFor({ timeout: 10000 })
  // Close the manage modal (backdrop click) so the header pills are reachable.
  await page.locator('.modal-overlay').click({ position: { x: 8, y: 8 } })

  // --- Edit mode via the pencil menu ---
  await page.locator('.schedule-pill-edit').first().click()
  const menu = page.locator('.mode-menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  const box = await menu.boundingBox()
  if (!box || box.height < 20) {
    await fail(`mode-menu not actually visible (boundingBox ${JSON.stringify(box)})`)
  }
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // --- Suggest mode via the pencil menu ---
  await page.locator('.schedule-pill-edit').first().click()
  await menu.getByRole('button', { name: 'Suggest changes' }).click()
  await page.getByText('Suggestion mode:').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Done' }).click()

  // --- Edit-mode meeting-pattern flows (the TR->MWF guard + the strip/rail) ---
  await page.locator('.schedule-pill-edit').first().click()
  await menu.getByRole('button', { name: 'Edit schedule' }).click()
  await page.getByText('Edit mode:').waitFor({ timeout: 5000 })

  // Add a course: its editor opens immediately, pre-slotted MWF 8:00-9:10.
  await page.getByRole('button', { name: '＋ Add course' }).click()
  const addm = page.locator('.modal')
  await addm.waitFor({ state: 'visible', timeout: 5000 })
  await addm.getByPlaceholder('Search code or name…').fill('BIO')
  await addm.locator('.schedule-add-option').first().click()
  const em = page.locator('.modal')
  await em.waitFor({ state: 'visible', timeout: 5000 })
  const saveBtn = em.getByRole('button', { name: 'Save changes' })

  // Switching day groups clears the stale band and disables Save until a slot
  // of the new group is picked (MWF 8:00-9:10 -> TR must re-pick).
  await em.getByRole('button', { name: 'TR', exact: true }).click()
  await em.getByText('Pick a time slot for TR.').waitFor({ timeout: 5000 })
  if (await saveBtn.isEnabled()) await fail('Save stayed enabled after a TR switch without a slot')
  // 8:00-9:45 is a TR-only band: the first slot of the newly-active TR row.
  await em.locator('.slot-time-btn', { hasText: '8:00-9:45' }).click()
  await em.getByText('Pick a time slot for TR.').waitFor({ state: 'detached', timeout: 5000 })

  // "No meeting time" lands the course in the strip under the grid.
  await em.getByRole('button', { name: 'No meeting time' }).click()
  await saveBtn.click()
  await em.waitFor({ state: 'detached', timeout: 5000 })
  await page.getByText('No meeting times').waitFor({ timeout: 5000 })
  await page.locator('.no-meeting-pattern', { hasText: 'No meeting time' }).first().waitFor({ timeout: 5000 })

  // Reopen from the strip; a custom time past 16:00 needs a day picked first
  // (Save stays disabled without one) and renders as a clipped off-pattern
  // rail: dashed 'custom' block with a clipped-bottom notch.
  await page.locator('.no-meeting-strip .slot-pill-edit').first().click()
  await em.waitFor({ state: 'visible', timeout: 5000 })
  await em.getByRole('button', { name: 'Custom time' }).click()
  if (await saveBtn.isEnabled()) await fail('Save stayed enabled with no day selected')

  // The air-datepicker popover must step minutes by 5 only (00/05/.../55).
  await em.getByLabel('Start time').click()
  const picker = page.locator('.air-datepicker')
  await picker.waitFor({ state: 'visible', timeout: 5000 })
  const minSlider = picker.locator('input[name="minutes"]')
  await minSlider.waitFor({ timeout: 5000 })
  const step = await minSlider.getAttribute('step')
  if (step !== '5') await fail(`minute slider step is "${step}", expected 5`)
  await minSlider.evaluate((el) => {
    const input = /** @type {HTMLInputElement} */ (el)
    input.value = '30'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(150)
  const startVal = await em.getByLabel('Start time').inputValue()
  if (!startVal.endsWith(':30')) await fail(`start time stayed "${startVal}" after the slider move`)
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

  // --- Offline phase: a fresh visitor chooses "Work offline" (local-only) ---
  // New context = no session cookie, empty localStorage: the prompt must
  // appear, choosing offline shows the persistent badge and the local sample,
  // and boot makes no authenticated calls (no 401 console errors).
  const ctx2 = await browser.newContext()
  const page2 = await ctx2.newPage()
  const offlineConsole = []
  const offlineErrors = []
  page2.on('pageerror', (err) => offlineErrors.push(String(err)))
  page2.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (text.includes('favicon')) return
    offlineConsole.push(text)
  })
  await page2.goto(base, { waitUntil: 'networkidle' })
  const dialog2 = page2.getByRole('dialog')
  await dialog2.waitFor({ timeout: 10000 })
  await dialog2.getByRole('button', { name: 'Work offline' }).click()
  await dialog2.waitFor({ state: 'detached', timeout: 5000 })
  await page2.getByText('Offline — testing only').waitFor({ timeout: 5000 })
  await page2.getByText('Sample schedule').first().waitFor({ timeout: 5000 })
  await ctx2.close()
  if (offlineErrors.length) {
    await fail(`offline page errors: ${offlineErrors.join(' | ')}`)
  }
  if (offlineConsole.some((t) => t.includes('401'))) {
    await fail(`offline boot produced 401 console errors: ${offlineConsole.join(' | ')}`)
  }

  // --- Assertions ---
  if (pageErrors.length) {
    await fail(`page errors: ${pageErrors.join(' | ')}`)
  }
  if (unexpectedConsole.length) {
    await fail(`console errors: ${unexpectedConsole.slice(0, 5).join(' | ')}`)
  }
  console.log(
    'SMOKE OK: sign-in, create, edit/suggest menus, meeting-pattern guards + strip/rail, offline mode, no console errors.',
  )
} catch (err) {
  await fail(String(err))
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
}
