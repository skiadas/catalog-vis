// Department / instructor filter chips for the schedule views. Reads the
// selected filters and the schedule index from the module stores directly;
// rendered as a sibling of the schedule header (below the toolbar).

import {
  departmentsInSchedule,
  instructorsInSchedule,
  colorForDept,
  colorForInstructor,
} from '@major-vis/schedule-core'
import { schedule, filterMode, selectedDepartments, selectedInstructors } from '../src/scheduleStore.js'

import { computed } from 'vue'

export default {
  name: 'ScheduleFilters',
  props: {
    view: { type: String, default: 'grid' },
  },
  setup(props) {
    const showFilter = computed(() => ['grid', 'day', 'slot'].includes(props.view))
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

    return {
      props,
      showFilter,
      depts,
      instructors,
      toggleDept,
      clearDepts,
      toggleInstructor,
      clearInstructors,
      filterMode,
      selectedDepartments,
      selectedInstructors,
      colorForDept,
      colorForInstructor,
    }
  },
  template: `
    <div>
      <div class="filter-panel" v-if="showFilter && filterMode === 'dept'">
        <span class="filter-label">Departments:</span>
        <span
          v-for="d in depts"
          :key="d"
          class="filter-chip"
          :class="{ active: selectedDepartments.includes(d) }"
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
          :class="{ active: selectedInstructors.includes(i) }"
          :style="selectedInstructors.includes(i) ? { backgroundColor: colorForInstructor(i) } : {}"
          @click="toggleInstructor(i)"
        >{{ i }}</span>
        <button v-if="selectedInstructors.length" class="filter-clear" @click="clearInstructors">Clear</button>
      </div>
    </div>
  `,
}
