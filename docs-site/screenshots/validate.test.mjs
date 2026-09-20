import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkDocsSite, findShotUsages, validateShots } from './validate.mjs'
import { entries } from './manifest.mjs'

test('findShotUsages reads the file attribute in any position', () => {
  const md = [
    '<Shot file="a.png" />',
    "<Shot  caption='x' file='b.png'></Shot>",
    '<Shot :file="dynamic" />',
    'plain text, no shot',
  ].join('\n')
  assert.deepEqual(findShotUsages(md), ['a.png', 'b.png'])
})

test('validateShots: usage covered by manifest and file on disk is clean', () => {
  const problems = validateShots({
    usages: [{ file: 'a.png', source: 'index.md' }],
    manifest: [{ file: 'a.png' }],
    exists: () => true,
  })
  assert.deepEqual(problems, [])
})

test('validateShots: usage with no manifest entry is a problem', () => {
  const problems = validateShots({
    usages: [{ file: 'ghost.png', source: 'guide/schedule.md' }],
    manifest: [{ file: 'a.png' }],
    exists: () => true,
  })
  assert.deepEqual(problems, ['guide/schedule.md: <Shot file="ghost.png"> has no manifest entry'])
})

test('validateShots: manifest entry with no file on disk is a problem', () => {
  const problems = validateShots({
    usages: [],
    manifest: [{ file: 'missing.png' }],
    exists: () => false,
  })
  assert.deepEqual(problems, ['manifest entry "missing.png" has no file on disk'])
})

test('checkDocsSite walks pages and mounts public/screenshots', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-site-'))
  try {
    mkdirSync(join(root, 'public', 'screenshots'), { recursive: true })
    for (const entry of entries) writeFileSync(join(root, 'public', 'screenshots', entry.file), '')
    writeFileSync(join(root, 'index.md'), `<Shot file="${entries[0].file}" />`)
    assert.deepEqual(checkDocsSite(root), [])

    writeFileSync(join(root, 'index.md'), '<Shot file="ghost.png" />')
    assert.ok(
      checkDocsSite(root).includes('index.md: <Shot file="ghost.png"> has no manifest entry'),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
