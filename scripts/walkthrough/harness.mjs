// The shared walkthrough harness: the pieces the docs screenshot capture
// (docs-site/screenshots/capture.mjs) and the demo video recorder
// (scripts/walkthrough/record-video.mjs) both need.
//
// It is deliberately unaware of both consumers' outputs: it boots a
// scratch-DB server, signs in, drives the declarative step DSL, and (for the
// recorder) animates a synthetic mouse cursor. Keeping it here — under
// scripts/, next to the other repo-level Node tooling — means neither consumer
// has to reach into the other, and the docs-site stays the guide's package.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

export const SETTLE_MS = 400

export function waitForServer(url, timeoutMs = 60_000) {
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

export function fillTokens(template, tokens) {
  return template.replace(/<(\w+)>/g, (_, key) => {
    if (!(key in tokens)) throw new Error(`route token <${key}> has no fixture value`)
    return tokens[key]
  })
}

// The `.first()` locator a `click`/`fill`/`select` step acts on. Used both to
// perform the action and (for the recorder) to know where to glide the cursor.
function stepTarget(page, step) {
  switch (step.act) {
    case 'click': {
      if (step.selector) {
        const base = page.locator(step.selector)
        return step.text ? base.filter({ hasText: step.text }) : base
      }
      return page.getByRole(step.role, { name: step.name, exact: step.exact })
    }
    case 'fill':
    case 'select':
      return page.getByLabel(step.label)
    default:
      return null
  }
}

// The step DSL from the screenshot harness. `pointer` is optional: the docs
// capture omits it (plain clicks), the video recorder passes a cursor pointer
// so the recorded mouse travels to each target. `defaultMs` is the settle time
// after a step that declares no `ms` — the recorder raises it for readability.
export async function runStep(page, step, pointer, defaultMs = SETTLE_MS) {
  // A step with no `act` is a bare pause (a `ms` hold for the viewer).
  if (!step.act) {
    await page.waitForTimeout(step.ms ?? defaultMs)
    return
  }
  if (pointer) await pointer.moveTo(stepTarget(page, step))
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
    case 'click': {
      const target = stepTarget(page, step)
      await target.first().click()
      break
    }
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
      else if (step.selector) await page.locator(step.selector).first().waitFor({ timeout: 10_000 })
      else await page.getByRole(step.role, { name: step.name }).first().waitFor({ timeout: 10_000 })
      break
    case 'custom':
      await step.run(page, pointer)
      break
    default:
      throw new Error(`unknown step: ${step.act}`)
  }
  await page.waitForTimeout(step.ms ?? defaultMs)
}

// Boots the Express server with a fresh scratch DB on `port` and username auth.
// The server is killed by the exact PID we spawned — never by a port sweep, so
// a dev server on 8080/5173 is never touched. NODE_ENV=test keeps the dev-only
// conveniences (directory seed, default AUTH_DOMAIN) out by construction.
export async function startServer(port, { adminUsernames = 'registrar' } = {}) {
  const baseURL = `http://127.0.0.1:${port}`
  const dbDir = mkdtempSync(join(tmpdir(), 'major-vis-walkthrough-'))
  const server = spawn('node', ['server/src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ADMIN_USERNAMES: adminUsernames,
      DB_PATH: join(dbDir, 'walkthrough.db'),
      NODE_ENV: 'test',
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

// Injects a synthetic mouse pointer the video can show. Playwright's bundled
// cursor overlay always also draws a click point and an action-title callout
// (no API to hide them in this version), so the recorder draws its own:
// pointer-only, following the real mouse via `mousemove`. `pointer-events:none`
// keeps it out of the way of the app.
export function installCursor(context) {
  context.addInitScript(() => {
    const add = () => {
      const cursor = document.createElement('div')
      cursor.id = '__walkthrough-cursor'
      cursor.style.cssText = [
        'position:fixed',
        'left:0',
        'top:0',
        'z-index:2147483647',
        'pointer-events:none',
        'width:20px',
        'height:20px',
        'transform:translate(-2px,-2px)',
        'filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))',
      ].join(';')
      cursor.innerHTML =
        '<svg viewBox="0 0 20 20" width="20" height="20"><path d="M2 1 L2 16 L6 12 L9 18 L11.5 17 L8.5 11 L14 11 Z" fill="#111" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>'
      document.body.appendChild(cursor)
      document.addEventListener('mousemove', (event) => {
        cursor.style.transform = `translate(${event.clientX - 2}px, ${event.clientY - 2}px)`
      })
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add)
    else add()
  })
}

// A pointer whose `moveTo(locator)` glides the real mouse to the element's
// center in small steps (so the injected cursor travels rather than teleports),
// then leaves the locator's own action to commit the click/fill.
export function createCursorPointer(page, { ms = 260, steps = 14 } = {}) {
  let position = { x: 0, y: 0 }
  return {
    async moveTo(locator) {
      if (!locator) return
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 2000 })
      } catch {
        // element may not be scrollable; its box is still usable
      }
      const box = await locator.boundingBox().catch(() => null)
      if (!box) return
      const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const next = {
          x: position.x + (target.x - position.x) * t,
          y: position.y + (target.y - position.y) * t,
        }
        await page.mouse.move(next.x, next.y)
        await page.waitForTimeout(ms / steps)
      }
      position = target
    },
  }
}
