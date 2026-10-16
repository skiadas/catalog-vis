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
// checked claim, not a hope. Demo data only (scripts/walkthrough/fixtures.mjs).
//
// The server runs on its own port and is killed by the exact PID we spawned —
// never by a port sweep, so a dev server on 8080/5173 is never touched.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { entries } from './manifest.mjs'
import { fixtures } from '../../scripts/walkthrough/fixtures.mjs'
import { fillTokens, runStep, SETTLE_MS, startServer } from '../../scripts/walkthrough/harness.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SHOT_DIR = join(ROOT, 'docs-site', 'public', 'screenshots')
const BASE_PORT = 3124

const filters = process.argv.slice(2)

// The viewport-relative crop around `selector`, grown by `padding` and clamped
// to the viewport — the "zoom in on this control" shot. Routes load at the top,
// where the viewport-relative bounding box and the document-relative clip
// coincide. Throws when the element isn't present, so a missing target fails
// the entry instead of writing a bogus PNG.
async function clipAround(page, selector, padding = 12) {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`selector "${selector}" has no bounding box`)
  const viewport = page.viewportSize()
  const x = Math.max(0, box.x - padding)
  const y = Math.max(0, box.y - padding)
  return {
    x,
    y,
    width: Math.min(viewport.width - x, box.width + padding * 2),
    height: Math.min(viewport.height - y, box.height + padding * 2),
  }
}

async function captureEntry(browser, entry, baseURL) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: entry.deviceScaleFactor || 1,
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
    const options = { path: join(SHOT_DIR, entry.file) }
    if (entry.selector) options.clip = await clipAround(page, entry.selector, entry.padding)
    else options.fullPage = Boolean(entry.fullPage)
    await page.screenshot(options)
    return entry.file
  } finally {
    await context.close()
  }
}

const selected = entries.filter(
  (entry) =>
    entry.app === 'schedule' && (filters.length === 0 || filters.some((f) => entry.file.includes(f))),
)
if (selected.length === 0) {
  console.error('no matching schedule entries in the manifest')
  process.exit(1)
}

// One server + scratch DB per entry, on its own port (startServer in the shared
// harness): fixtures are independent (no schedule accumulation across shots, and
// the app's "auto-select the first own schedule" always lands on that entry's
// data). Each server is killed by the PID we spawned; ports are never swept.
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
