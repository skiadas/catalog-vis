// The demo video recorder: renders each scene from scenes.mjs against a fresh
// scratch-DB server, records a .webm with an animated mouse cursor, and writes
// it to the (gitignored) scripts/walkthrough/out/.
//
//   npm run demo:video            # all scenes
//   npm run demo:video -- suggest # only scenes whose name matches
//
// Same server recipe as the e2e suite and the docs shots: build the apps, boot
// the Express server on its own port with a scratch DB and username auth, drive
// the app with Playwright. The cursor is ours (harness.installCursor) because
// Playwright's bundled overlay always also draws a point + callout.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { scenes } from './scenes.mjs'
import { fixtures } from './fixtures.mjs'
import {
  createCursorPointer,
  fillTokens,
  installCursor,
  runStep,
  startServer,
} from './harness.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT_DIR = join(ROOT, 'scripts', 'walkthrough', 'out')
const BASE_PORT = 3224

const filters = process.argv.slice(2)
const selected = scenes.filter(
  (scene) => filters.length === 0 || filters.some((f) => scene.name.includes(f)),
)
if (selected.length === 0) {
  console.error('no matching scenes')
  process.exit(1)
}

async function recordScene(browser, scene, baseURL) {
  const videoDir = mkdtempSync(join(tmpdir(), 'major-vis-video-'))
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 900 } },
    colorScheme: 'light',
  })
  installCursor(context)
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await context.close()
  }
  try {
    const tokens = scene.seed ? await fixtures[scene.seed](context.request) : {}
    if (scene.as) {
      const res = await context.request.post('/api/auth/login', { data: { username: scene.as } })
      if (!res.ok()) throw new Error(`sign in as ${scene.as} failed: ${res.status()}`)
    }
    const page = await context.newPage()
    const pointer = createCursorPointer(page)
    await page.goto(fillTokens(scene.route, tokens), { waitUntil: 'networkidle' })
    await page.waitForTimeout(scene.hold ?? 900)
    for (const step of scene.steps || []) {
      await runStep(page, step, pointer, scene.hold ?? 900)
    }
    const video = page.video()
    await close()
    await video.saveAs(join(OUT_DIR, `${scene.name}.webm`))
  } catch (err) {
    await close()
    throw err
  } finally {
    rmSync(videoDir, { recursive: true, force: true })
  }
}

console.log('[demo:video] building apps…')
const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status || 1)

mkdirSync(OUT_DIR, { recursive: true })

let browser
try {
  browser = await chromium.launch()
  for (const [index, scene] of selected.entries()) {
    const server = await startServer(BASE_PORT + index)
    try {
      await recordScene(browser, scene, server.baseURL)
      console.log(`[demo:video] ok   ${scene.name}.webm`)
    } catch (err) {
      console.error(`[demo:video] FAIL ${scene.name}: ${err.message}`)
      process.exitCode = 1
    } finally {
      await server.stop()
    }
  }
} finally {
  if (browser) await browser.close()
}
