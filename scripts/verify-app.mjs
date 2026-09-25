// One-shot built-bundle boot probe. Spawns the server on an ephemeral port
// with a scratch DB, loads each built app in headless Chromium, and fails on
// any page/console error or an empty render. The server is a child of this
// process and is killed in `finally`, so there is never a background server
// left to clean up — run this instead of hand-rolling a server (and then
// having to kill it by name pattern, which also matches the user's
// `npm run serve`).
//
// Use it to check that `npm run build` produced bootable bundles; for real
// user flows use `npm run test:e2e` (its Playwright webServer manages its own
// server lifecycle). Assumes dist/ is fresh.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const APPS = ['schedule', 'browse', 'planner']
const BOOT_TIMEOUT_MS = 30_000

if (!existsSync(join(ROOT, 'dist/schedule/index.html'))) {
  console.error('[probe] dist/ is missing — run `npm run build` first.')
  process.exit(1)
}

// A scratch DB keeps the probe off any real data (same trick playwright.config
// uses for the e2e webServer).
const dbDir = mkdtempSync(join(tmpdir(), 'major-vis-probe-'))
const server = spawn('node', ['server/src/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    HOST,
    PORT: '0',
    DB_PATH: join(dbDir, 'probe.db'),
    ADMIN_USERNAMES: 'registrar',
    // Hermetic: never seed from the gitignored repo-root directory.csv.
    SEED_DIRECTORY: '0',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})

const killServer = (signal = 'SIGTERM') => {
  if (server.exitCode == null && !server.killed) server.kill(signal)
}
// If the probe itself is interrupted, don't leak the child.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    killServer()
    process.exit(1)
  })
}

// Learn the bound port from the server's startup line (PORT=0 binds an
// ephemeral port, so the configured value can't be used).
const port = await new Promise((resolvePort, reject) => {
  let buf = ''
  const timer = setTimeout(() => reject(new Error('server did not start in time')), BOOT_TIMEOUT_MS)
  server.on('error', reject)
  server.on('exit', (code) => {
    clearTimeout(timer)
    reject(new Error(`server exited early (code ${code})`))
  })
  server.stdout.setEncoding('utf8')
  server.stdout.on('data', (chunk) => {
    buf += chunk
    process.stdout.write(chunk)
    const match = /listening on http:\/\/[^:]+:(\d+)/.exec(buf)
    if (match) {
      clearTimeout(timer)
      resolvePort(Number(match[1]))
    }
  })
})

let browser = null
let exitCode = 0
try {
  browser = await chromium.launch()
  for (const app of APPS) {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      // The pre-sign-in 401s and favicon misses are expected noise.
      if (/favicon|401/.test(text)) return
      errors.push(`console: ${text}`)
    })
    await page.goto(`http://${HOST}:${port}/apps/${app}/`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const body = (await page.locator('body').innerText()).trim()
    await page.close()
    if (!body) errors.push('the page rendered empty')
    if (errors.length) {
      console.error(`[probe] FAIL ${app}\n  ${errors.join('\n  ')}`)
      exitCode = 1
    } else {
      console.log(`[probe] ok   ${app}`)
    }
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err)
  console.error(`[probe] FATAL ${message}`)
  if (/Executable doesn't exist|playwright install/i.test(message)) {
    console.error('[probe] run `npx playwright install chromium` once.')
  }
  exitCode = 1
} finally {
  if (browser) await browser.close().catch(() => {})
  killServer()
  await new Promise((r) => setTimeout(r, 500))
  killServer('SIGKILL')
}

process.exit(exitCode)
