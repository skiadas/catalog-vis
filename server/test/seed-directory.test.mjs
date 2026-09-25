import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, listUsers, userByUsername } from '../src/db.js'
import { seedDirectoryFromCsv } from '../src/seed-directory.js'

// Writes a CSV into a fresh temp dir; the caller closes/removes it.
function withCsv(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'major-vis-seed-'))
  const csvPath = join(dir, 'directory.csv')
  writeFileSync(csvPath, contents)
  return { dir, csvPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('seedDirectoryFromCsv upserts display names and departments', async () => {
  const db = await openDb(':memory:')
  const { csvPath, cleanup } = withCsv(
    'username,displayName,departments\n' + 'skiadas,Haris Skiadas,"CS, MATH"\n' + 'wahl,Barbara Wahl,CS\n',
  )
  try {
    const result = seedDirectoryFromCsv(db, { csvPath })
    assert.equal(result.seeded, true)
    assert.equal(result.added, 2)
    assert.equal(result.updated, 0)
    const wahl = userByUsername(db, 'wahl')
    assert.equal(wahl.display_name, 'Barbara Wahl')
    assert.deepEqual(JSON.parse(wahl.departments), ['CS'])
    assert.equal(userByUsername(db, 'skiadas').display_name, 'Haris Skiadas')
  } finally {
    cleanup()
    db.close()
  }
})

test('seedDirectoryFromCsv is authoritative: a re-run replaces existing rows', async () => {
  const db = await openDb(':memory:')
  const first = withCsv('username,displayName\nwahl,Old Name\n')
  try {
    seedDirectoryFromCsv(db, { csvPath: first.csvPath })
    assert.equal(userByUsername(db, 'wahl').display_name, 'Old Name')
    // The same account with a corrected name: the seed overwrites it.
    writeFileSync(first.csvPath, 'username,displayName\nwahl,Barbara Wahl\n')
    const result = seedDirectoryFromCsv(db, { csvPath: first.csvPath })
    assert.equal(result.added, 0)
    assert.equal(result.updated, 1)
    assert.equal(userByUsername(db, 'wahl').display_name, 'Barbara Wahl')
    assert.equal(listUsers(db).length, 1, 'no duplicate account')
  } finally {
    first.cleanup()
    db.close()
  }
})

test('seedDirectoryFromCsv canonicalizes bare usernames through the domain', async () => {
  const db = await openDb(':memory:')
  const { csvPath, cleanup } = withCsv('username,displayName\nskiadas,Haris Skiadas\n')
  try {
    seedDirectoryFromCsv(db, { csvPath, domain: 'hanover.edu' })
    assert.equal(userByUsername(db, 'skiadas@hanover.edu').display_name, 'Haris Skiadas')
    assert.equal(userByUsername(db, 'skiadas'), null)
  } finally {
    cleanup()
    db.close()
  }
})

test('seedDirectoryFromCsv reports bad rows without aborting the good ones', async () => {
  const db = await openDb(':memory:')
  const { csvPath, cleanup } = withCsv('username,displayName\nwahl,Barbara Wahl\n,No Name\n')
  try {
    const result = seedDirectoryFromCsv(db, { csvPath })
    assert.equal(result.added, 1, 'the valid row still imported')
    assert.deepEqual(result.errors, [{ row: 2, reason: 'missing_username' }])
    assert.equal(listUsers(db).length, 1)
  } finally {
    cleanup()
    db.close()
  }
})

test('seedDirectoryFromCsv is a silent no-op when the file is absent', async () => {
  const db = await openDb(':memory:')
  try {
    const result = seedDirectoryFromCsv(db, { csvPath: '/nonexistent/directory.csv' })
    assert.deepEqual(result, { seeded: false, added: 0, updated: 0, errors: [] })
    assert.equal(listUsers(db).length, 0)
  } finally {
    db.close()
  }
})
