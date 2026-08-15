// "Add a course" modal for the schedule being edited. Adds the picked catalog
// course to the edited schedule on its default slot, then opens its course
// editor for further customization. Visibility via the `open` prop.

import {
  editingScheduleId,
  editingSchedule,
  addCourseToSchedule,
  openCourseEdit,
} from '../src/scheduleStore.js'
import { allCourses, courseName } from '@major-vis/catalog-client'
import { compareCodes } from '@major-vis/schedule-core'

const { ref, computed } = Vue

export default {
  name: 'ScheduleAddCourse',
  props: {
    open: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const addCourseQuery = ref('')
    const allCatalogCourses = computed(() => Object.keys(allCourses.value).sort(compareCodes))
    const addCourseResults = computed(() => {
      const q = addCourseQuery.value.trim().toLowerCase()
      const qn = q.replace(/\s+/g, '')
      let list = allCatalogCourses.value
      if (q) {
        list = list.filter(
          (code) =>
            code.replace(/\s+/g, '').toLowerCase().includes(qn) || courseName(code).toLowerCase().includes(q),
        )
      }
      return list
    })
    const editingName = computed(() => (editingSchedule.value ? editingSchedule.value.name : ''))

    const close = () => emit('close')
    // Adds the picked catalog course to the edited schedule on its default slot,
    // then opens its course editor for further customization.
    const addCourse = (code) => {
      const item = addCourseToSchedule(editingScheduleId.value, code)
      addCourseQuery.value = ''
      if (item) openCourseEdit(item)
      close()
    }

    return {
      props,
      close,
      editingName,
      addCourseQuery,
      addCourseResults,
      addCourse,
      courseName,
    }
  },
  template: `
    <div v-if="props.open" class="modal-overlay" @click.self="close">
      <div class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedule-add-course-title">
        <div class="modal-head">
          <h3 id="schedule-add-course-title">Add a course to {{ editingName }}</h3>
          <button class="modal-close" @click="close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            Pick a catalog course to add it to this schedule in its default slot — its edit window opens next
            so you can customize it right away.
          </p>
          <input
            class="search-input schedule-add-search"
            type="search"
            placeholder="Search code or name…"
            v-model="addCourseQuery"
          />
          <div class="schedule-add-list">
            <button
              v-for="code in addCourseResults"
              :key="code"
              class="course-picker-option schedule-add-option"
              @click="addCourse(code)"
            >
              <span class="planner-pick-code">{{ code }}</span>
              <span class="planner-pick-name">{{ courseName(code) }}</span>
            </button>
            <div v-if="!addCourseResults.length" class="course-picker-empty">No courses match.</div>
          </div>
        </div>
      </div>
    </div>
  `,
}
