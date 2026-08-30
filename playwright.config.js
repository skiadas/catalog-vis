// Playwright E2E config for the schedule app. The suite runs against the FULL
// stack: `webServer` builds the apps (npm run build, so the bundles are always
// fresh) and boots the Express server with a scratch DB — the same shape the
// container serves, just from the repo root layout. Chromium is the bundled
// Playwright build (deterministic across machines; `npx playwright install
// chromium` once after installing). `npm run test:e2e`; a main-only CI
// workflow (e2e.yml) runs the same suite.
import { defineConfig } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 3123
const baseURL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'apps/schedule/e2e',
  // Sequential: the suite shares one server and walks stateful UI flows.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  use: {
    baseURL,
  },
  webServer: {
    command: `npm run build && PORT=${PORT} HOST=127.0.0.1 DB_PATH="${join(
      mkdtempSync(join(tmpdir(), 'major-vis-e2e-')),
      'e2e.db',
    )}" node server/src/index.js`,
    url: `${baseURL}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
