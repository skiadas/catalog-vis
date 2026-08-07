// Shared edit-mode drag-and-drop helpers for the schedule views (grid + day).
// Both views let a course from the schedule being edited be dragged onto one of
// the standard time slots; the drop rewrites the offering's days/time through
// the schedule's moveOffering action (smart day handling lives in rescheduleDays).

const { ref } = Vue

// The drag payload for an offering, carrying its identity plus the day column
// the drag started from (so a same-group drop can swap that day).
export function buildDragPayload(it, fromDay) {
  return JSON.stringify({
    sid: it.sid,
    prefix: it.o.prefix,
    number: it.o.number,
    section: it.o.section,
    fromDay: fromDay || '',
  })
}

export function dragPayloadFrom(e) {
  try {
    return JSON.parse(e.dataTransfer.getData('text/plain'))
  } catch {
    return null
  }
}

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
