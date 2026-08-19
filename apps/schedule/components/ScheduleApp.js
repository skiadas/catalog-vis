// Schedule page orchestrator: renders the header, the schedule-selection
// picker, the view tabs, the edit bar, and whichever sub-view is active, and
// wires the extracted modals (help / manage / add-course). Sub-views and
// modals read the schedule store directly; picker/filters take the pieces of
// view state they need as props.

import { route } from '../router.js'
import { goScheduleGrid, goScheduleCourse, goScheduleInstructor } from '../router.js'
import { courseName } from '@major-vis/catalog-client'
import {
  filterMode,
  schedule,
  scheduleOfferings,
  schedules,
  selectedScheduleIds,
  editingScheduleId,
  editingSchedule,
  setEditingSchedule,
  renameSchedule,
  activeTerm,
  setActiveTerm,
  courseEditTarget,
  closeCourseEdit,
} from '../src/scheduleStore.js'
import { TERM_KEYS, TERM_LABELS } from '@major-vis/schedule-core'
import ScheduleGrid from './ScheduleGrid.js'
import ScheduleDay from './ScheduleDay.js'
import ScheduleSlot from './ScheduleSlot.js'
import ScheduleCourse from './ScheduleCourse.js'
import ScheduleInstructor from './ScheduleInstructor.js'
import ScheduleCourseEdit from './ScheduleCourseEdit.js'
import SchedulePicker from './SchedulePicker.js'
import ScheduleFilters from './ScheduleFilters.js'
import ScheduleHelp from './ScheduleHelp.js'
import ScheduleManage from './ScheduleManage.js'
import ScheduleAddCourse from './ScheduleAddCourse.js'

const { computed, ref } = Vue

export default {
  name: 'ScheduleApp',
  components: {
    ScheduleGrid,
    ScheduleDay,
    ScheduleSlot,
    ScheduleCourse,
    ScheduleInstructor,
    ScheduleCourseEdit,
    SchedulePicker,
    ScheduleFilters,
    ScheduleHelp,
    ScheduleManage,
    ScheduleAddCourse,
  },
  setup() {
    const view = computed(() => route.value.params.scheduleView || 'grid')
    const sortedCourses = computed(() => {
      if (!schedule.value) return []
      return Object.keys(schedule.value.byCourse).sort()
    })
    const selectedCode = computed(() => route.value.params.code || '')
    const showFilter = computed(() => ['grid', 'day', 'slot'].includes(view.value))

    // Course picker — the "course conflicts" dropdown.
    const courseQuery = ref('')
    const courseOpen = ref(false)
    const courseResults = computed(() => {
      const q = courseQuery.value.trim().toLowerCase()
      const qn = q.replace(/\s+/g, '')
      let list = Object.keys(schedule.value?.byCourse || {}).sort()
      if (q) {
        list = list.filter(
          (code) =>
            code.replace(/\s+/g, '').toLowerCase().includes(qn) || courseName(code).toLowerCase().includes(q),
        )
      }
      return list
    })
    const pickCourse = (code) => {
      courseQuery.value = ''
      courseOpen.value = false
      goScheduleCourse(code)
    }

    // Modal visibility. The modals own their internal state; these refs only
    // gate whether each is open.
    const showHelp = ref(false)
    const toggleHelp = () => {
      showHelp.value = !showHelp.value
    }
    const showSchedules = ref(false)
    const showAddCourse = ref(false)

    // Edit bar.
    const editingId = editingScheduleId
    const editingName = computed(() => (editingSchedule.value ? editingSchedule.value.name : ''))
    const nameDraft = ref('')
    const enterEdit = (id) => {
      setEditingSchedule(id)
      nameDraft.value = editingSchedule.value ? editingSchedule.value.name : ''
      showSchedules.value = false
      if (view.value !== 'grid') goScheduleGrid()
    }
    const exitEdit = () => {
      setEditingSchedule(null)
    }
    // Renames the edited schedule from the inline input (on Enter or blur).
    const commitRename = () => {
      const s = editingSchedule.value
      if (!s) return
      if (nameDraft.value.trim() && nameDraft.value.trim() !== s.name) {
        renameSchedule(s.id, nameDraft.value)
      } else {
        nameDraft.value = s.name
      }
    }

    return {
      view,
      sortedCourses,
      selectedCode,
      showFilter,
      courseQuery,
      courseOpen,
      courseResults,
      courseName,
      pickCourse,
      schedule,
      scheduleOfferings,
      schedules,
      selectedScheduleIds,
      filterMode,
      showHelp,
      toggleHelp,
      showSchedules,
      showAddCourse,
      editingId,
      editingName,
      nameDraft,
      enterEdit,
      exitEdit,
      commitRename,
      activeTerm,
      setActiveTerm,
      TERM_KEYS,
      TERM_LABELS,
      courseEditTarget,
      closeCourseEdit,
      goScheduleGrid,
      goScheduleCourse,
      goScheduleInstructor,
    }
  },
  template: `
    <div v-if="schedule">
      <button class="back-btn" @click="goScheduleGrid()">← Schedule Overview</button>

      <div class="schedule-header">
        <div class="schedule-title-row">
          <span class="section-title">Schedule Visualization</span>
          <span class="schedule-sub">
            {{ scheduleOfferings.length }} offerings ·
            {{ Object.keys(schedule.byCourse).length }} courses
          </span>
          <button class="schedule-help-toggle" title="How to use this page" @click="toggleHelp">?</button>
        </div>

        <div class="schedule-note">
          These are made-up, illustrative schedules. They do not reflect actual course offerings or meeting times. Pick one or more to display at once; the "Color by schedule" toggle color-codes each schedule's courses unless a department/instructor filter is active.
        </div>

        <SchedulePicker :active="showSchedules" @edit="enterEdit" @manage="showSchedules = true" />

        <div class="term-tabs">
          <button
            v-for="t in TERM_KEYS"
            :key="t"
            class="filter-btn"
            :class="{ active: activeTerm === t }"
            @click="setActiveTerm(t)"
          >{{ TERM_LABELS[t] }}</button>
        </div>

        <div class="schedule-toolbar">
          <div class="schedule-tabs">
            <button class="filter-btn" :class="{ active: view === 'grid' }" @click="goScheduleGrid()">Grid</button>
            <button
              class="filter-btn"
              :class="{ active: view === 'course' }"
              @click="goScheduleCourse(selectedCode || sortedCourses[0])"
            >Course conflicts</button>
            <button
              class="filter-btn"
              :class="{ active: view === 'instructor' }"
              @click="goScheduleInstructor(Object.keys(schedule.byInstructor)[0])"
            >Instructor Schedule</button>
          </div>

          <div class="filter-mode" v-if="showFilter">
            <span class="filter-mode-label">Filters:</span>
            <button class="filter-btn" :class="{ active: filterMode === 'dept' }" @click="filterMode = 'dept'">Departments</button>
            <button class="filter-btn" :class="{ active: filterMode === 'instructor' }" @click="filterMode = 'instructor'">Instructors</button>
          </div>
        </div>

        <div class="schedule-edit-bar" v-if="editingId">
          <span class="schedule-edit-label">Edit mode:
            <input
              class="schedule-edit-name"
              v-model="nameDraft"
              @blur="commitRename"
              @keydown.enter="commitRename"
              aria-label="Schedule name"
            />
          </span>
          <button class="filter-btn primary" @click="showAddCourse = true">＋ Add course</button>
          <span class="schedule-edit-hint" v-if="view !== 'grid'">Switch to the grid view to click a course's edit icon or drag it onto a time slot.</span>
          <span class="schedule-edit-hint" v-else>Click a course's edit icon to change its settings, or drag it onto a time slot to move it.</span>
          <button class="filter-btn" @click="exitEdit">Done</button>
        </div>

        <div class="course-picker" v-if="view === 'course'">
          <label for="schedule-course-search">Course:</label>
          <div class="course-picker-wrap">
            <input
              id="schedule-course-search"
              class="search-input"
              type="search"
              placeholder="Search code or name…"
              v-model="courseQuery"
              @focus="courseOpen = true"
              @blur="courseOpen = false"
            />
            <div v-if="courseOpen" class="course-picker-dropdown">
              <button
                v-for="code in courseResults"
                :key="code"
                class="course-picker-option"
                :class="{ active: code === selectedCode }"
                @mousedown.prevent="pickCourse(code)"
              >
                <span class="planner-pick-code">{{ code }}</span>
                <span class="planner-pick-name">{{ courseName(code) }}</span>
              </button>
              <div v-if="!courseResults.length" class="course-picker-empty">No courses match.</div>
            </div>
          </div>
        </div>
      </div>

      <ScheduleFilters :view="view" />

      <div v-if="!selectedScheduleIds.length" class="empty-state">
        <p v-if="schedules.length">{{ schedules.length }} schedule{{ schedules.length !== 1 ? 's' : '' }} available but none selected.</p>
        <p v-else><strong>No schedules yet.</strong> Create one via "Your schedules" → "New schedule".</p>
      </div>
      <template v-else>
        <ScheduleGrid v-if="view === 'grid'" />
        <ScheduleDay v-else-if="view === 'day'" />
        <ScheduleSlot v-else-if="view === 'slot'" />
        <ScheduleCourse v-else-if="view === 'course'" />
        <ScheduleInstructor v-else-if="view === 'instructor'" />
      </template>

      <ScheduleCourseEdit
        v-if="courseEditTarget && editingId"
        :schedule-id="editingId"
        :offering="courseEditTarget"
        @close="closeCourseEdit"
      />
    </div>
    <div v-else class="loading">Loading schedule...</div>

    <ScheduleHelp :open="showHelp" @close="showHelp = false" />
    <ScheduleManage :open="showSchedules" @close="showSchedules = false" @edit="enterEdit" />
    <ScheduleAddCourse :open="showAddCourse" @close="showAddCourse = false" />
  `,
}
