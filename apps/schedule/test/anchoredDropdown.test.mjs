import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dropdownStyle } from '../src/anchoredDropdown.js'

const anchor = (over) => ({ left: 100, top: 50, right: 320, bottom: 74, width: 220, ...over })
const viewport = { top: 0, right: 1024, bottom: 800 }

test('dropdownStyle pins left and width to the anchor and opens below with room', () => {
  assert.deepEqual(dropdownStyle(anchor(), viewport), {
    left: '100px',
    width: '220px',
    top: '78px',
  })
})

test('dropdownStyle flips above when the room below is too small', () => {
  const style = dropdownStyle(anchor({ top: 700, bottom: 724 }), { ...viewport, bottom: 760 })
  assert.equal(style.top, undefined)
  assert.equal(style.bottom, '64px')
  assert.equal(style.left, '100px')
  assert.equal(style.width, '220px')
})

test('dropdownStyle stays below when above is no roomier than below', () => {
  const style = dropdownStyle(anchor({ top: 100, bottom: 124 }), { ...viewport, bottom: 300 })
  assert.equal(style.top, '128px')
  assert.equal(style.bottom, undefined)
})

test('dropdownStyle honors a custom gap and minHeight', () => {
  assert.equal(dropdownStyle(anchor(), viewport, { gap: 12 }).top, '86px')
  // A short anchor well inside the viewport never flips, even with no gap.
  assert.equal(
    dropdownStyle(anchor({ top: 300, bottom: 324 }), viewport, { gap: 0, minHeight: 100 }).top,
    '324px',
  )
})
