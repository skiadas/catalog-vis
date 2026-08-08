import { planSlots, takenSet, allCourses, movePlanCourse, removePlanCourse } from '../lib/store.js'
import { dragPayloadFrom } from '../lib/scheduleDrag.js'

const { ref } = Vue

const YEARS = [
  { key: 'y1', label: 'First Year' },
  { key: 'y2', label: 'Second Year' },
  { key: 'y3', label: 'Third Year' },
  { key: 'y4', label: 'Fourth Year' },
]

const TERMS = [
  { key: 'f', label: 'Fall' },
  { key: 'w', label: 'Winter' },
  { key: 's', label: 'Spring' },
]

const SHELF = 'unassigned'
const TRANSFER = 'transfer'

export default {
  name: 'PlannerTimeline',
  setup() {
    const dragOverKey = ref(null)

    function slot(key) {
      return planSlots.value[key] || []
    }

    function title(code) {
      const c = allCourses.value[code]
      return c ? c.course_name : code
    }

    function onDragStart(e, code, fromKey) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', JSON.stringify({ code, from: fromKey || null }))
    }

    function onDragOver(e, key) {
      e.preventDefault()
      dragOverKey.value = key
    }

    function onDragLeave() {
      dragOverKey.value = null
    }

    function onDrop(e, toKey) {
      e.preventDefault()
      dragOverKey.value = null
      const data = dragPayloadFrom(e)
      if (data && data.code) movePlanCourse(data.code, toKey, data.from || null)
    }

    return {
      YEARS,
      TERMS,
      SHELF,
      TRANSFER,
      slot,
      title,
      takenSet,
      dragOverKey,
      onDragStart,
      onDragOver,
      onDragLeave,
      onDrop,
      removePlanCourse,
    }
  },
  template: `
    <div class="planner-timeline">
      <div class="tl-zones">
      <div
        class="tl-zone tl-shelf"
        :class="{ 'drag-over': dragOverKey === SHELF }"
        @dragover.prevent="onDragOver(SHELF)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, SHELF)"
      >
        <div class="tl-zone-title">Unassigned — not yet scheduled</div>
        <div v-if="slot(SHELF).length" class="tl-zone-courses">
          <span
            v-for="code in slot(SHELF)"
            :key="code"
            class="course-chip tl-chip"
            draggable="true"
            @dragstart="onDragStart($event, code, SHELF)"
            :title="title(code)"
          >{{ code }}<button class="tl-remove" @click="removePlanCourse(code)" title="Remove from plan">✕</button></span>
        </div>
        <div v-else class="tl-empty">New courses land here — drag them into a term below.</div>
      </div>

      <div
        class="tl-zone tl-transfer"
        :class="{ 'drag-over': dragOverKey === TRANSFER }"
        @dragover.prevent="onDragOver(TRANSFER)"
        @dragleave="onDragLeave"
        @drop="onDrop($event, TRANSFER)"
      >
        <div class="tl-zone-title">Transfer Credit</div>
        <div v-if="slot(TRANSFER).length" class="tl-zone-courses">
          <span
            v-for="code in slot(TRANSFER)"
            :key="code"
            class="course-chip tl-chip"
            draggable="true"
            @dragstart="onDragStart($event, code, TRANSFER)"
            :title="title(code)"
          >{{ code }}<button class="tl-remove" @click="removePlanCourse(code)" title="Remove from plan">✕</button></span>
        </div>
        <div v-else class="tl-empty">No transfer credits yet.</div>
      </div>
      </div>

      <div class="tl-grid">
        <div class="tl-year tl-year-head"></div>
        <div v-for="t in TERMS" :key="t.key" class="tl-term">{{ t.label }}</div>

        <template v-for="y in YEARS" :key="y.key">
          <div class="tl-year">{{ y.label }}</div>
          <div
            v-for="t in TERMS"
            :key="t.key"
            class="tl-cell"
            :class="{ 'drag-over': dragOverKey === y.key + t.key }"
            @dragover.prevent="onDragOver(y.key + t.key)"
            @dragleave="onDragLeave"
            @drop="onDrop($event, y.key + t.key)"
          >
            <span
              v-for="code in slot(y.key + t.key)"
              :key="code"
              class="course-chip tl-chip"
              draggable="true"
              @dragstart="onDragStart($event, code, y.key + t.key)"
              :title="title(code)"
            >{{ code }}<button class="tl-remove" @click="removePlanCourse(code)" title="Remove from plan">✕</button></span>
          </div>
        </template>
      </div>
    </div>
  `,
}
