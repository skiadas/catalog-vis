import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDirectoryCsv } from '../src/directory-import.js'

test('parseDirectoryCsv: header + rows, departments split and canonicalized', () => {
  const { rows, errors } = parseDirectoryCsv(
    'username,displayName,departments\ncskiadas,Charilaos Skiadas,"CS, math"\nwahl,John Wahl,CS\n',
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(rows, [
    { row: 1, username: 'cskiadas', displayName: 'Charilaos Skiadas', departments: ['CS', 'MATH'] },
    { row: 2, username: 'wahl', displayName: 'John Wahl', departments: ['CS'] },
  ])
})

test('parseDirectoryCsv: header is optional and blank lines are skipped', () => {
  const { rows, errors } = parseDirectoryCsv('cskiadas,Charilaos Skiadas,CS\n\n\nwahl,John Wahl,CS\n')
  assert.deepEqual(errors, [])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].row, 1)
  assert.equal(rows[1].row, 2)
})

test('parseDirectoryCsv: a BOM and quoted names with commas survive', () => {
  const { rows, errors } = parseDirectoryCsv(
    '\ufeff"username","displayName","departments"\nwahl,"Wahl, John",CS\n',
  )
  assert.deepEqual(errors, [])
  assert.deepEqual(rows, [{ row: 1, username: 'wahl', displayName: 'Wahl, John', departments: ['CS'] }])
})

test('parseDirectoryCsv: bare usernames pick up the default domain', () => {
  const { rows } = parseDirectoryCsv('cskiadas,,CS\n', 'hanover.edu')
  assert.equal(rows[0].username, 'cskiadas@hanover.edu')
  assert.equal(rows[0].displayName, null)
})

test('parseDirectoryCsv: separators within the departments cell (space/semicolon) work', () => {
  const { rows } = parseDirectoryCsv('wahl,John Wahl,CS; MATH PHI\n')
  assert.deepEqual(rows[0].departments, ['CS', 'MATH', 'PHI'])
})

test('parseDirectoryCsv: row problems are reported, not fatal', () => {
  const { rows, errors } = parseDirectoryCsv(
    ',No Name,CS\nwahl,John Wahl,CS\nbadname,Long Dept,TOOLONGPREFIX\n',
  )
  assert.deepEqual(errors, [
    { row: 1, reason: 'missing_username' },
    { row: 3, reason: 'bad_departments' },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].username, 'wahl')
})

test('parseDirectoryCsv: an unreadable file reports one error and no rows', () => {
  const { rows, errors } = parseDirectoryCsv('username,displayName\n"unterminated')
  assert.deepEqual(rows, [])
  assert.deepEqual(errors, [{ row: 0, reason: 'unreadable_csv' }])
})
