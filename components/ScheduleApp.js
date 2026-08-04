import { route } from '../lib/router.js'
import { goScheduleGrid, goScheduleCourse, goScheduleInstructor } from '../lib/router.js'
import {
  schedule,
  scheduleOfferings,
  selectedDepartments,
  selectedInstructors,
  filterMode,
} from '../lib/store.js'
import {
  departmentsInSchedule,
  instructorsInSchedule,
  colorForDept,
  colorForInstructor,
} from '../lib/schedule.js'
import ScheduleGrid from './ScheduleGrid.js'
import ScheduleDay from './ScheduleDay.js'
import ScheduleSlot from './ScheduleSlot.js'
import ScheduleCourse from './ScheduleCourse.js'
import ScheduleInstructor from './ScheduleInstructor.js'

const { computed, ref } = Vue

export default {
  name: 'ScheduleApp',
  components: { ScheduleGrid, ScheduleDay, ScheduleSlot, ScheduleCourse, ScheduleInstructor },
  setup() {
    const view = computed(() => route.value.params.scheduleView || 'grid')
    const sortedCourses = computed(() => {
      if (!schedule.value) return []
      return Object.keys(schedule.value.byCourse).sort()
    })
    const selectedCode = computed(() => route.value.params.code || '')

    const showHelp = ref(false)
    const toggleHelp = () => {
      showHelp.value = !showHelp.value
    }

    const depts = computed(() => departmentsInSchedule(schedule.value))
    const instructors = computed(() => instructorsInSchedule(schedule.value))
    const toggleDept = (prefix) => {
      const i = selectedDepartments.value.indexOf(prefix)
      if (i < 0) selectedDepartments.value = [...selectedDepartments.value, prefix]
      else selectedDepartments.value = selectedDepartments.value.filter((p) => p !== prefix)
    }
    const clearDepts = () => {
      selectedDepartments.value = []
    }
    const toggleInstructor = (name) => {
      const i = selectedInstructors.value.indexOf(name)
      if (i < 0) selectedInstructors.value = [...selectedInstructors.value, name]
      else selectedInstructors.value = selectedInstructors.value.filter((n) => n !== name)
    }
    const clearInstructors = () => {
      selectedInstructors.value = []
    }
    const showFilter = computed(() => ['grid', 'day', 'slot'].includes(view.value))

    return {
      view,
      sortedCourses,
      selectedCode,
      schedule,
      scheduleOfferings,
      selectedDepartments,
      selectedInstructors,
      filterMode,
      depts,
      instructors,
      toggleDept,
      clearDepts,
      toggleInstructor,
      clearInstructors,
      showFilter,
      showHelp,
      toggleHelp,
      colorForDept,
      colorForInstructor,
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
          <button class="schedule-help-toggle" title="How to use this page" @click="toggleHelp">?</button>
        </div>
        <div class="schedule-sub">
          {{ scheduleOfferings.length }} offerings ·
          {{ Object.keys(schedule.byCourse).length }} distinct courses ·
          {{ Object.keys(schedule.byInstructor).length }} instructors
        </div>

        <div class="schedule-note">
          This is a made-up, illustrative schedule. It does not reflect actual course offerings or meeting times.
        </div>

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
          >Instructor</button>
        </div>

        <div class="course-picker" v-if="view === 'course'">
          <label for="schedule-course-select">Course:</label>
          <select
            id="schedule-course-select"
            class="search-input"
            style="max-width:220px; flex:0 0 auto;"
            :value="selectedCode"
            @change="goScheduleCourse($event.target.value)"
          >
            <option v-for="c in sortedCourses" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
      </div>

      <div class="filter-mode" v-if="showFilter">
          <button class="filter-btn" :class="{ active: filterMode === 'dept' }" @click="filterMode = 'dept'">Departments</button>
          <button class="filter-btn" :class="{ active: filterMode === 'instructor' }" @click="filterMode = 'instructor'">Instructors</button>
        </div>

        <div class="filter-panel" v-if="showFilter && filterMode === 'dept'">
          <span class="filter-label">Departments:</span>
          <span
            v-for="d in depts"
            :key="d"
            class="filter-chip"
            :class="{ on: selectedDepartments.includes(d) }"
            :style="selectedDepartments.includes(d) ? { backgroundColor: colorForDept(d) } : {}"
            @click="toggleDept(d)"
          >{{ d }}</span>
          <button v-if="selectedDepartments.length" class="filter-clear" @click="clearDepts">Clear</button>
        </div>

        <div class="filter-panel" v-if="showFilter && filterMode === 'instructor'">
          <span class="filter-label">Instructors:</span>
          <span
            v-for="i in instructors"
            :key="i"
            class="filter-chip"
            :class="{ on: selectedInstructors.includes(i) }"
            :style="selectedInstructors.includes(i) ? { backgroundColor: colorForInstructor(i) } : {}"
            @click="toggleInstructor(i)"
          >{{ i }}</span>
          <button v-if="selectedInstructors.length" class="filter-clear" @click="clearInstructors">Clear</button>
        </div>

        <ScheduleGrid v-if="view === 'grid'" />
      <ScheduleDay v-else-if="view === 'day'" />
      <ScheduleSlot v-else-if="view === 'slot'" />
      <ScheduleCourse v-else-if="view === 'course'" />
      <ScheduleInstructor v-else-if="view === 'instructor'" />
    </div>
    <div v-else class="loading">Loading schedule...</div>

    <div v-if="showHelp" class="modal-overlay" @click.self="toggleHelp">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-help-title">
        <div class="modal-head">
          <h3 id="schedule-help-title">Using the Schedule page</h3>
          <button class="modal-close" @click="toggleHelp" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            This is a made-up, illustrative schedule. Browse it by view with the tabs, and drill down by clicking.
            The <strong>Department</strong> / <strong>Instructor</strong> chips filter which offerings are highlighted.
          </p>

          <div class="help-section">
            <h4>Grid view</h4>
            <p>Shows the whole week as colored blocks. Switch between the <em>Departments</em> and <em>Instructors</em>
            filter modes, then click a chip to highlight matching offerings. Click a time block to open that day and
            slot, and click an individual course chip to jump to its conflicts.</p>
          </div>

          <div class="help-section">
            <h4>Day &amp; slot views</h4>
            <p>Click any offering (or time slot) in the grid to drill into a single day and then a specific slot.
            Each slot lists its offerings, color-coded if a filter is active.</p>
          </div>

          <div class="help-section">
            <h4>Course conflicts</h4>
            <p>Pick a course from the dropdown. It lists every scheduled section (days, time, instructor) and flags other
            courses whose times overlap, so you can see what would collide in a student schedule.</p>
          </div>

          <div class="help-section">
            <h4>Instructor view</h4>
            <p>Select an instructor to see their weekly timetable. Any double-bookings (two courses at the same time)
            are shown as alerts at the top.</p>
          </div>

          <div class="help-section">
            <h4>Tips</h4>
            <ul>
              <li>Use <strong>Clear</strong> to reset the active filter.</li>
              <li>The tabs (Grid / Course conflicts / Instructor) always return you to the top-level views.</li>
              <li>Everything here is a synthetic sample, not the real catalog.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `,
}
