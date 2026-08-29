// Local-only smoke test for the schedule app's core flows, run against the
// FULL stack: the Express server (temp DB, built apps from dist/) + a real
// headless browser (system Chrome via playwright-core). Walks sign-in, schedule
// creation, and the edit/suggest mode menu, and fails on page errors or
// unexpected console errors. `npm run test:smoke`.
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
  console.error(
    'SMOKE SKIP: no Chrome found. Set CHROME_PATH to a Chrome binary to run the smoke test.',
  )
  process.exit(1)
}

const dir = mkdtempSync(join(tmpdir(), 'major-vis-smoke-'))
const dbPath = join(dir, 'smoke.db')
const env = { ...process.env, DB_PATH: dbPath, PORT: '0', HOST: '127.0.0.1' }
const { app, config } = buildServer(env)

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
  // Expected: the pre-sign-in 401 noise and favicon misses.
  if (text.includes('401') || text.includes('favicon')) return
  unexpectedConsole.push(text)
})

try {
  await page.goto(base, { waitUntil: 'networkidle' })

  // --- Sign in ---
  await page.getByLabel('Username').waitFor({ timeout: 10000 })
  await page.getByLabel('Username').fill('registrar')
  await page.getByRole('button', { name: 'Sign in' }).click()
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

  // --- Assertions ---
  if (pageErrors.length) {
    await fail(`page errors: ${pageErrors.join(' | ')}`)
  }
  if (unexpectedConsole.length) {
    await fail(`console errors: ${unexpectedConsole.slice(0, 5).join(' | ')}`)
  }
  console.log('SMOKE OK: sign-in, create, edit/suggest menus, no console errors.')
} catch (err) {
  await fail(String(err))
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  rmSync(dir, { recursive: true, force: true })
}