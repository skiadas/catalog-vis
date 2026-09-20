// The screenshot harness: regenerates every schedule walkthrough PNG from the
// committed manifest (manifest.mjs) against a fresh scratch-DB server.
//
//   npm run docs:shots            # all schedule entries
//   npm run docs:shots -- access  # only entries whose file matches "access"
//
// Same recipe as the e2e suite (playwright.config.js): build the apps, boot the
// Express server with a scratch DB and username auth, drive the app with
// Playwright. Most states are plain routes (the routing work made them so);
// `steps` cover the few that are not (dialogs, menus, filters). A shot is only
// written if every declared `assert` passed, so "this PNG = this state" is a
// checked claim, not a hope. Demo data only (fixtures.mjs).
//
// The server runs on its own port and is killed by the exact PID we spawned —
// never by a port sweep, so a dev server on 8080/5173 is never touched.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { entries } from './manifest.mjs'
import { fixtures } from './fixtures.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SHOT_DIR = join(ROOT, 'docs-site', 'public', 'screenshots')
const BASE_PORT = 3124
const SETTLE_MS = 400

const filters = process.argv.slice(2)

function waitForServer(url, timeoutMs = 60_000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url)
        if (res.ok) return resolve()
      } catch {
        // not up yet
      }
      if (Date.now() - started > timeoutMs) return reject(new Error(`server did not start: ${url}`))
      setTimeout(tick, 250)
    }
    tick()
  })
}

function fillTokens(template, tokens) {
  return template.replace(/<(\w+)>/g, (_, key) => {
    if (!(key in tokens)) throw new Error(`route token <${key}> has no fixture value`)
    return tokens[key]
  })
}

async function runStep(page, step) {
  switch (step.act) {
    case 'goto':
      await page.goto(step.route, { waitUntil: 'networkidle' })
      break
    case 'signin':
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByLabel('Username').fill(step.as)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.getByText(`Signed in as ${step.as}`).waitFor({ timeout: 10_000 })
      break
    case 'click':
      if (step.selector) await page.locator(step.selector).first().click()
      else await page.getByRole(step.role, { name: step.name, exact: step.exact }).click()
      break
    case 'fill':
      await page.getByLabel(step.label).fill(step.value)
      break
    case 'select':
      await page.getByLabel(step.label).selectOption(step.value)
      break
    case 'key':
      await page.keyboard.press(step.key)
      break
    case 'settle':
      break
    case 'detach':
      await page.locator(step.selector).waitFor({ state: 'detached', timeout: 10_000 })
      break
    case 'assert':
      if (step.text) await page.getByText(step.text).first().waitFor({ timeout: 10_000 })
      else await page.getByRole(step.role, { name: step.name }).first().waitFor({ timeout: 10_000 })
      break
    case 'custom':
      await step.run(page)
      break
    default:
      throw new Error(`unknown step: ${step.act}`)
  }
  await page.waitForTimeout(step.ms || SETTLE_MS)
}

async function captureEntry(browser, entry, baseURL) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  })
  try {
    const tokens = entry.seed ? await fixtures[entry.seed](context.request) : {}
    if (entry.as) {
      const res = await context.request.post('/api/auth/login', { data: { username: entry.as } })
      if (!res.ok()) throw new Error(`sign in as ${entry.as} failed: ${res.status()}`)
    }
    const page = await context.newPage()
    await page.goto(fillTokens(entry.route, tokens), { waitUntil: 'networkidle' })
    for (const step of entry.steps || []) await runStep(page, step)
    await page.waitForTimeout(SETTLE_MS)
    await page.screenshot({ path: join(SHOT_DIR, entry.file), fullPage: Boolean(entry.fullPage) })
    return entry.file
  } finally {
    await context.close()
  }
}

const selected = entries.filter(
  (entry) => entry.app === 'schedule' && (filters.length === 0 || filters.some((f) => entry.file.includes(f))),
)
if (selected.length === 0) {
  console.error('no matching schedule entries in the manifest')
  process.exit(1)
}

// One server + scratch DB per entry, on its own port: fixtures are then
// independent (no schedule accumulation across shots, and the app's
// "auto-select the first own schedule" always lands on that entry's data).
// Each server is killed by the PID we spawned; ports are never swept.
async function startServer(port) {
  const baseURL = `http://127.0.0.1:${port}`
  const dbDir = mkdtempSync(join(tmpdir(), 'major-vis-shots-'))
  const server = spawn('node', ['server/src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ADMIN_USERNAMES: 'registrar',
      DB_PATH: join(dbDir, 'shots.db'),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  })
  await waitForServer(`${baseURL}/api/config`)
  return {
    baseURL,
    stop: () =>
      new Promise((resolve) => {
        server.once('exit', resolve)
        server.kill('SIGTERM')
        rmSync(dbDir, { recursive: true, force: true })
      }),
  }
}

console.log(`[shots] building apps…`)
const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)

let browser
try {
  browser = await chromium.launch()
  const failures = []
  for (const [index, entry] of selected.entries()) {
    const server = await startServer(BASE_PORT + index)
    try {
      await captureEntry(browser, entry, server.baseURL)
      console.log(`[shots] ok   ${entry.file}`)
    } catch (err) {
      failures.push(entry.file)
      console.error(`[shots] FAIL ${entry.file}: ${err.message}`)
    } finally {
      await server.stop()
    }
  }
  if (failures.length) {
    console.error(`[shots] ${failures.length} failed: ${failures.join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`[shots] wrote ${selected.length} screenshot(s)`)
  }
} finally {
  if (browser) await browser.close()
}
