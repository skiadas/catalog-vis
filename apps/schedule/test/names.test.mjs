import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildNameIndex,
  canonicalInstructor,
  directoryPeople,
  displayName,
  instructorLabel,
  matchesDirectory,
} from '../src/names.js'

const ROSTER = [
  { username: 'skiadas@hanover.edu', displayName: 'Haris Skiadas', departments: ['CS', 'MAT'] },
  { username: 'wahl@hanover.edu', displayName: 'Barbara Wahl', departments: ['CS'] },
  { username: 'bob', displayName: null, departments: [] },
]
const index = buildNameIndex(ROSTER)

test('displayName strips the domain', () => {
  assert.equal(displayName('cskiadas@hanover.edu'), 'cskiadas')
  assert.equal(displayName('wahl'), 'wahl')
})

test('instructorLabel resolves any username spelling to the full name', () => {
  assert.equal(instructorLabel('skiadas', index), 'Haris Skiadas')
  assert.equal(instructorLabel('skiadas@hanover.edu', index), 'Haris Skiadas')
  assert.equal(instructorLabel('Wahl', index), 'Barbara Wahl', 'case folds too')
  assert.equal(instructorLabel('bob', index), 'bob', 'a nameless account falls back to the value')
  assert.equal(instructorLabel('Ada Lovelace', index), 'Ada Lovelace', 'free text stays verbatim')
  assert.equal(instructorLabel('', index), '')
  assert.equal(instructorLabel('skiadas', buildNameIndex([])), 'skiadas', 'an empty index is identity')
})

test('canonicalInstructor stores a picked full name as the short username', () => {
  assert.equal(canonicalInstructor('Haris Skiadas', index), 'skiadas')
  assert.equal(canonicalInstructor('Barbara Wahl', index), 'wahl')
  assert.equal(canonicalInstructor('Wahl', index), 'wahl', 'a legacy surname normalizes')
  assert.equal(canonicalInstructor('Ada Lovelace', index), 'Ada Lovelace', 'free text stays verbatim')
  assert.equal(canonicalInstructor('', index), '')
})

test('a nameless bare row cannot shadow a canonical account', () => {
  const stale = buildNameIndex([
    { username: 'wahl', displayName: null },
    { username: 'wahl@hanover.edu', displayName: 'Barbara Wahl' },
  ])
  assert.equal(instructorLabel('wahl', stale), 'Barbara Wahl')
})

test('matchesDirectory de-dupes the catalog roster by a shared token', () => {
  assert.equal(matchesDirectory('Skiadas', index), true)
  assert.equal(matchesDirectory('Wahl', index), true)
  assert.equal(matchesDirectory('Gall', index), false)
})

test('directoryPeople scope by department and carry { label, value }', () => {
  assert.deepEqual(
    directoryPeople(index, 'CS').map((p) => `${p.label} <${p.value}>`),
    ['Haris Skiadas <skiadas>', 'Barbara Wahl <wahl>'],
  )
  assert.deepEqual(directoryPeople(index, 'BIO'), [])
  assert.equal(directoryPeople(index).length, 2, 'no prefix lists everyone named')
})
