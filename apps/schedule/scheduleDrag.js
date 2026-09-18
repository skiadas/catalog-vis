// Schedule app edit-mode drag helpers. The drag payload serialization
// (`buildDragPayload`/`dragPayloadFrom`) lives in `@major-vis/schedule-core` —
// it's the shared drag contract (the planner timeline parses the same payload).

import { buildDragPayload, dragPayloadFrom } from '@major-vis/schedule-core'

import { onUnmounted, ref } from 'vue'

// The course row/pill selectors a drag can start on (the grid's offering rows
// and the no-meeting-strip pills share these handlers).
const ROW_SELECTOR = '.filter-offering, .slot-pill'
const EDIT_SELECTOR = '.filter-offering-edit, .slot-pill-edit'

// Sets a custom drag image: the whole course row/pill (cloned, widened to its
// content, pencil stripped) instead of whatever small element the drag began
// on, so the ghost reads as "this course" and the grab point stays under the
// cursor. The clone is parked off-screen, snapshotted by `setDragImage`, and
// dropped on the next frame (the browser captures the image synchronously).
export function setDragGhost(e) {
  const row = e.target && e.target.closest ? e.target.closest(ROW_SELECTOR) : null
  if (!row) return
  const rect = row.getBoundingClientRect()
  const ghost = row.cloneNode(true)
  ghost.querySelectorAll(EDIT_SELECTOR).forEach((el) => el.remove())
  ghost.style.position = 'fixed'
  ghost.style.left = '-10000px'
  ghost.style.top = '0'
  ghost.style.width = 'max-content'
  ghost.style.whiteSpace = 'nowrap'
  ghost.style.opacity = '0.85'
  ghost.style.pointerEvents = 'none'
  ghost.style.zIndex = '10000'
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top)
  requestAnimationFrame(() => ghost.remove())
}

// Returns the shared edit-mode drag state + handlers, parameterized by the
// schedule being edited (`editingId`, a ref), the store's moveOffering action,
// and an optional `canTouch(scheduleId, prefix)` predicate that scopes which
// courses the session may touch (non-owner suggest sessions are limited to the
// proposer's departments; default: anything editable). A drop target is
// `{ key, day, days, time }` (grid uses the day-column key, day view the slot
// time).
/**
 * @param {import('vue').Ref<number | string | null>} editingId
 * @param {Function} moveOffering
 * @param {(scheduleId: number | string, prefix: string) => boolean} [canTouch]
 */
export function useScheduleDrag(editingId, moveOffering, canTouch = () => true) {
  const dragOver = ref(null)
  // True while a drag is actually in progress (a draggable course was picked
  // up and not yet dropped or cancelled). Consumed by the grid to advertise
  // empty slots as drop targets only during a drag.
  const dragging = ref(false)
  const isEditable = (it) =>
    editingId.value != null && it.sid === editingId.value && canTouch(it.sid, it.o && it.o.prefix)
  const clearDrag = () => {
    dragging.value = false
    dragOver.value = null
  }
  // A drag can end on any source (grid rows, day/slot/no-meeting pills that
  // don't route through this hook) and with no drop at all, so clear globally:
  // `dragend` covers the source, `drop` any target, in either view.
  document.addEventListener('dragend', clearDrag, true)
  document.addEventListener('drop', clearDrag, true)
  onUnmounted(() => {
    document.removeEventListener('dragend', clearDrag, true)
    document.removeEventListener('drop', clearDrag, true)
  })
  const onDragStart = (e, it, day) => {
    if (!isEditable(it)) return
    // The whole row is draggable, but the edit pencil stays click-only: a
    // drag that begins on it is cancelled (a child can't opt out of its
    // ancestor's drag source, so the handler is the gate).
    if (e.target && e.target.closest && e.target.closest(EDIT_SELECTOR)) {
      e.preventDefault()
      return
    }
    dragging.value = true
    e.dataTransfer.setData('text/plain', buildDragPayload(it, day))
    e.dataTransfer.effectAllowed = 'move'
    setDragGhost(e)
  }
  const zoneOver = (e, z) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragOver.value = z.key
  }
  const zoneLeave = () => {
    dragOver.value = null
  }
  const zoneDrop = (e, z) => {
    e.preventDefault()
    clearDrag()
    const p = dragPayloadFrom(e)
    if (!p || p.sid !== editingId.value) return
    // A drop only lands when the session may touch the course (defense in
    // depth: the drag source was gated already).
    if (!canTouch(p.sid, p.prefix)) return
    moveOffering(
      p.sid,
      p.prefix,
      p.number,
      p.section,
      {
        fromDay: p.fromDay,
        toDay: z.day,
        group: z.days,
        time: z.time,
      },
      p.lab,
      p.labSeq,
      p.id,
    )
  }
  return { dragOver, dragging, isEditable, onDragStart, zoneOver, zoneLeave, zoneDrop }
}
