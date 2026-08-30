import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, createMigrator } from '../src/db.js'

// Tables the baseline owns, in migration order.
const TABLES = ['users', 'sessions', 'schedules', 'schedule_terms', 'schedule_changes', 'suggestion_ops']

function tableNames(db) {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      // @ts-ignore node:sqlite rows are Record<string, SQLOutputValue>
      .map((r) => r.name)
  )
}

function applied(db) {
  return (
    db
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all()
      // @ts-ignore node:sqlite rows are Record<string, SQLOutputValue>
      .map((r) => r.name)
  )
}

// The FK action for a column: 'CASCADE' | 'NO ACTION' | ...
function fkAction(db, table, column) {
  const row = db
    .prepare(`PRAGMA foreign_key_list(${table})`)
    .all()
    // @ts-ignore node:sqlite rows are Record<string, SQLOutputValue>
    .find((r) => r.from === column)
  return row ? row.on_delete : null
}

test('a fresh DB migrates to head: all baseline tables exist, ordered, with cascading user FKs', async () => {
  const db = await openDb(':memory:')
  try {
    assert.deepEqual(applied(db), ['0001_baseline'])
    for (const t of TABLES) assert.equal(tableNames(db).includes(t), true, t)
    assert.equal(fkAction(db, 'schedules', 'owner_user_id'), 'CASCADE')
    assert.equal(fkAction(db, 'schedule_changes', 'proposer_user_id'), 'CASCADE')
  } finally {
    db.close()
  }
})

test('reopening a file DB is idempotent: migrations run once, tables persist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'major-vis-migrate-'))
  const dbPath = join(dir, 'db.sqlite')
  try {
    const first = await openDb(dbPath)
    assert.deepEqual(applied(first), ['0001_baseline'])
    first.close()

    const second = await openDb(dbPath)
    assert.deepEqual(applied(second), ['0001_baseline'])
    assert.equal(tableNames(second).includes('schedules'), true)
    second.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migrations apply in filename order and a failed migration is rolled back unrecorded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'major-vis-migrate-'))
  try {
    writeFileSync(join(dir, '0001_first.sql'), 'CREATE TABLE first_t (id INTEGER PRIMARY KEY);')
    writeFileSync(
      join(dir, '0002_second.sql'),
      'CREATE TABLE second_t (id INTEGER PRIMARY KEY); CREATE TABLE broken_t (id INTEGER PRIMARY KEY); INSERT INTO nope VALUES (1);',
    )
    writeFileSync(join(dir, '0003_third.sql'), 'CREATE TABLE third_t (id INTEGER PRIMARY KEY);')

    const db = await openDb(':memory:', { migrate: false })
    try {
      const migrator = createMigrator(db, { dir })
      await assert.rejects(() => migrator.up())

      // 0001 applied; 0002 attempted but rolled back (second_t never appears)
      // and unrecorded; 0003 never reached.
      assert.deepEqual(applied(db), ['0001_first'])
      assert.equal(tableNames(db).includes('first_t'), true)
      assert.equal(tableNames(db).includes('second_t'), false)
      assert.equal(tableNames(db).includes('broken_t'), false)
      assert.equal(tableNames(db).includes('third_t'), false)
    } finally {
      db.close()
    }

    // After the failure the DB is still usable, and repairing the fixture lets
    // the full chain apply in filename order.
    writeFileSync(join(dir, '0002_second.sql'), 'CREATE TABLE second_t (id INTEGER PRIMARY KEY);')
    const clean = await openDb(':memory:', { migrate: false })
    try {
      const migrator = createMigrator(clean, { dir })
      await migrator.up()
      assert.deepEqual(applied(clean), ['0001_first', '0002_second', '0003_third'])
    } finally {
      clean.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})