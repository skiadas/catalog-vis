// Schedule app edit-mode drag helpers. The drag payload serialization
// (`buildDragPayload`/`dragPayloadFrom`) lives in `@major-vis/schedule-core` —
// it's the shared drag contract (the planner timeline parses the same payload).

import { buildDragPayload, dragPayloadFrom } from '@major-vis/schedule-core'

import { onUnmounted, ref } from 'vue'

// Returns the shared edit-mode drag state + handlers, parameterized by the
// schedule being edited (`editingId`, a ref) and the store's moveOffering
// action. A drop target is `{ key, day, days, time }` (grid uses the day-column
// key, day view the slot time).
export function useScheduleDrag(editingId, moveOffering) {
  const dragOver = ref(null)
  // True while a drag is actually in progress (a draggable course was picked
  // up and not yet dropped or cancelled). Consumed by the grid to advertise
  // empty slots as drop targets only during a drag.
  const dragging = ref(false)
  const isEditable = (it) => editingId.value != null && it.sid === editingId.value
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
    dragging.value = true
    e.dataTransfer.setData('text/plain', buildDragPayload(it, day))
    e.dataTransfer.effectAllowed = 'move'
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
