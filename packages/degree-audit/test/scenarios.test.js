// Asserts every row of the synthetic capability catalog (scenarios.mjs) —
// the same table `npm run scenarios` prints. Keeps the engine's capability
// contract tied to one source of truth: a scenario can only be "approved" by
// updating its row in scenarios.mjs, never by editing this file alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scenarios, runScenarios } from '../scenarios.mjs'

test('every capability scenario passes', () => {
  const { pass, total, failures } = runScenarios()
  assert.equal(failures.length, 0, `scenario failures:\n${summarize(failures)}`)
  assert.equal(pass, total, `expected ${scenarios.length} scenarios, ran ${total}`)
})

test('scenarios carry a sourceShape tag and a name', () => {
  for (const scenario of scenarios) {
    assert.ok(
      scenario.sourceShape && typeof scenario.sourceShape === 'string',
      `${scenario.name}: missing sourceShape`,
    )
    assert.ok(scenario.name && typeof scenario.name === 'string', 'missing name')
  }
})

function summarize(failures) {
  return failures.map((f) => `  ${f.scenario.name}\n    ${f.cases.join('\n    ')}`).join('\n')
}
