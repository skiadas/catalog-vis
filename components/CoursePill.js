import { goScheduleCourse, goScheduleInstructor } from '../lib/router.js'

export default {
  name: 'CoursePill',
  props: {
    item: { type: Object, required: true },
    filterActive: { type: Boolean, default: false },
    color: { type: String, default: '' },
  },
  setup() {
    return { goScheduleCourse, goScheduleInstructor }
  },
  template: `
    <span
      class="slot-pill"
      :class="{ 'filter-colored': filterActive }"
      :style="filterActive ? { backgroundColor: color } : {}"
    >
      <span class="slot-pill-code" @click="goScheduleCourse(item.code)">
        {{ item.code }}<span class="sep">{{ item.o.section }}</span>
      </span>
      <span class="slot-pill-inst" @click="goScheduleInstructor(item.o.instructor)">
        {{ item.o.instructor }}
      </span>
    </span>
  `,
}
