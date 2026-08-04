import { route } from '../lib/router.js'
import { goScheduleGrid, goScheduleCourse, goScheduleInstructor } from '../lib/router.js'
import { schedule, scheduleOfferings, selectedDepartments } from '../lib/store.js'
import { departmentsInSchedule, colorForDept } from '../lib/schedule.js'
import ScheduleGrid from './ScheduleGrid.js'
import ScheduleDay from './ScheduleDay.js'
import ScheduleSlot from './ScheduleSlot.js'
import ScheduleCourse from './ScheduleCourse.js'
import ScheduleInstructor from './ScheduleInstructor.js'

const { computed } = Vue

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

    const depts = computed(() => departmentsInSchedule(schedule.value))
    const isFiltering = computed(() => selectedDepartments.value.length > 0)
    const toggleDept = (prefix) => {
      const i = selectedDepartments.value.indexOf(prefix)
      if (i < 0) selectedDepartments.value = [...selectedDepartments.value, prefix]
      else selectedDepartments.value = selectedDepartments.value.filter(p => p !== prefix)
    }
    const clearDepts = () => { selectedDepartments.value = [] }
    const showFilter = computed(() => ['grid', 'day', 'slot'].includes(view.value))

    return {
      view,
      sortedCourses,
      selectedCode,
      schedule,
      scheduleOfferings,
      selectedDepartments,
      depts,
      isFiltering,
      toggleDept,
      clearDepts,
      showFilter,
      colorForDept,
      goScheduleGrid,
      goScheduleCourse,
      goScheduleInstructor
    }
  },
  template: `
    <div v-if="schedule">
      <button class="back-btn" @click="goScheduleGrid()">← Schedule Overview</button>

      <div class="schedule-header">
        <div class="section-title">Schedule Visualization</div>
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

      <div class="dept-filter" v-if="showFilter">
          <span class="dept-filter-label">Departments:</span>
          <span
            v-for="d in depts"
            :key="d"
            class="dept-chip"
            :class="{ on: selectedDepartments.includes(d) }"
            :style="selectedDepartments.includes(d) ? { backgroundColor: colorForDept(d) } : {}"
            @click="toggleDept(d)"
          >{{ d }}</span>
          <button v-if="isFiltering" class="dept-clear" @click="clearDepts">Clear</button>
        </div>

        <ScheduleGrid v-if="view === 'grid'" />
      <ScheduleDay v-else-if="view === 'day'" />
      <ScheduleSlot v-else-if="view === 'slot'" />
      <ScheduleCourse v-else-if="view === 'course'" />
      <ScheduleInstructor v-else-if="view === 'instructor'" />
    </div>
    <div v-else class="loading">Loading schedule...</div>
  `
}