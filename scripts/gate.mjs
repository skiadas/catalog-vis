// Local verification gate: runs the independent CI checks concurrently and
// exits with the first failing check's code. The sequential list took ~sum of
// the checks' wall times; parallel, a full pass costs ~max instead. CI keeps
// its own separate steps — this is the fast local loop. Checks mirror
// AGENTS.md's commit checklist (minus build/black/compileall, which are
// covered by their own commands; build+typecheck stay a manual pass).
import { spawn } from 'node:child_process'

const CHECKS = [
  ['prettier', 'npx', ['prettier@3.3.3', '--check', '**/*.{js,html,css,scss,vue}']],
  ['test', 'npm', ['test']],
  ['typecheck', 'npm', ['run', 'typecheck']],
  ['lint', 'npm', ['run', 'lint']],
  ['validate:catalog', 'npm', ['run', 'validate:catalog']],
  ['test:data', 'npm', ['run', 'test:data']],
]

let failed = null
await Promise.all(
  CHECKS.map(([name, cmd, args]) => {
    const start = Date.now()
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] })
      child.on('close', (code) => {
        const status = code === 0 ? 'ok' : 'FAIL'
        console.log(`[gate] ${name}: ${status} (${((Date.now() - start) / 1000).toFixed(1)}s)`)
        if (code !== 0 && !failed) failed = { name, code }
        resolve()
      })
    })
  }),
)
if (failed) {
  console.error(`[gate] FAILED: ${failed.name}`)
  process.exit(failed.code || 1)
}
console.log('[gate] all checks passed')