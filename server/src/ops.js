// Diff-operation application for schedule term parts. A "suggested change" is a
// list of operations; applying them to a term's offerings is the atomic unit the
// owner approves. Phase 4 will build the richer diff (`diff.js`) that *produces*
// these ops; this module is the independent apply side, reused by both the
// suggestions API and (later) the approve flow.

import {
  addOfferingToSchedule,
  removeOfferingFromSchedule,
  updateOfferingInSchedule,
} from '@major-vis/schedule-core'

// An op is one of:
//   { kind: 'add', offering }                          -> append an offering
//   { kind: 'remove', cur: { prefix, number, section } } -> remove by identity
//   { kind: 'update', cur: { prefix, number, section },
//     changes: { instructor?, section?, days?, time? } }  -> rewrite fields
// Returns a new offerings array. Unknown/mismatched ops are skipped silently so a
// stale suggestion can't corrupt the term.
export function applyOperations(offerings, operations) {
  if (!Array.isArray(operations)) return offerings
  let list = offerings
  for (const op of operations) {
    if (!op) continue
    if (op.kind === 'add' && op.offering) {
      list = addOfferingToSchedule(list, { ...op.offering })
    } else if (op.kind === 'remove' && op.cur) {
      list = removeOfferingFromSchedule(list, op.cur)
    } else if (op.kind === 'update' && op.cur && op.changes) {
      const next = updateOfferingInSchedule(list, op.cur, op.changes)
      list = next
    }
  }
  return list
}
