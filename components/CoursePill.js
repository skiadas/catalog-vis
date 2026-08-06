import { goScheduleCourse, goScheduleInstructor } from '../lib/router.js'
import { allCourses } from '../lib/store.js'

const { computed } = Vue

export default {
  name: 'CoursePill',
  props: {
    item: { type: Object, required: true },
    filterActive: { type: Boolean, default: false },
    color: { type: String, default: '' },
  },
  setup(props) {
    const courseName = computed(() =>
      allCourses.value[props.item.code] ? allCourses.value[props.item.code].course_name : '',
    )
    return { goScheduleCourse, goScheduleInstructor, courseName }
  },
  template: `
    <span
      class="slot-pill"
      :class="{ 'filter-colored': filterActive }"
      :style="filterActive ? { backgroundColor: color } : {}"
      :title="courseName"
    >
      <span class="slot-pill-code" @click="goScheduleCourse(item.code)">
        {{ item.code }}<span class="sep">{{ item.o.section }}</span>
      </span>
      <span class="slot-pill-name">{{ courseName }}</span>
      <span class="slot-pill-inst" @click="goScheduleInstructor(item.o.instructor)">
        {{ item.o.instructor }}
      </span>
    </span>
  `,
}
