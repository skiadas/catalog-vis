// Schedule app edit-mode drag helpers. The drag payload serialization
// (`buildDragPayload`/`dragPayloadFrom`) lives in `@major-vis/schedule-core` —
// it's the shared drag contract (the planner timeline parses the same payload).

import { buildDragPayload, dragPayloadFrom } from '@major-vis/schedule-core'

import { ref } from 'vue'

// Returns the shared edit-mode drag state + handlers, parameterized by the
// schedule being edited (`editingId`, a ref) and the store's moveOffering
// action. A drop target is `{ key, day, days, time }` (grid uses the day-column
// key, day view the slot time).
export function useScheduleDrag(editingId, moveOffering) {
  const dragOver = ref(null)
  const isEditable = (it) => editingId.value != null && it.sid === editingId.value
  const onDragStart = (e, it, day) => {
    if (!isEditable(it)) return
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
    dragOver.value = null
    const p = dragPayloadFrom(e)
    if (!p || p.sid !== editingId.value) return
    moveOffering(p.sid, p.prefix, p.number, p.section, {
      fromDay: p.fromDay,
      toDay: z.day,
      group: z.days,
      time: z.time,
    })
  }
  return { dragOver, isEditable, onDragStart, zoneOver, zoneLeave, zoneDrop }
}
