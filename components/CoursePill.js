import { goScheduleCourse, goScheduleInstructor } from '../lib/router.js'
import { allCourses } from '../packages/catalog-client/index.js'
import { buildDragPayload } from '../lib/scheduleDrag.js'

const { computed } = Vue

export default {
  name: 'CoursePill',
  props: {
    item: { type: Object, required: true },
    filterActive: { type: Boolean, default: false },
    color: { type: String, default: '' },
    editable: { type: Boolean, default: false },
    draggable: { type: Boolean, default: false },
    dragDay: { type: String, default: '' },
  },
  emits: ['edit'],
  setup(props, { emit }) {
    const courseName = computed(() =>
      allCourses.value[props.item.code] ? allCourses.value[props.item.code].course_name : '',
    )
    const onDragStart = (e) => {
      e.dataTransfer.setData('text/plain', buildDragPayload(props.item, props.dragDay))
      e.dataTransfer.effectAllowed = 'move'
    }
    const onEdit = () => emit('edit')
    return {
      goScheduleCourse,
      goScheduleInstructor,
      courseName,
      onDragStart,
      onEdit,
    }
  },
  template: `
    <span
      class="slot-pill"
      :class="{ 'filter-colored': filterActive, editable }"
      :style="filterActive ? { backgroundColor: color } : {}"
      :title="courseName"
      :draggable="draggable"
      @dragstart="onDragStart"
    >
      <span class="slot-pill-code" @click="goScheduleCourse(item.code)">
        {{ item.code }}<span class="sep">{{ item.o.section }}</span>
      </span>
      <span class="slot-pill-name">{{ courseName }}</span>
      <span class="slot-pill-inst" @click="goScheduleInstructor(item.o.instructor)">
        {{ item.o.instructor }}
      </span>
      <button
        v-if="editable"
        class="slot-pill-edit"
        :title="'Edit ' + item.code + item.o.section"
        aria-label="Edit course"
        @click.stop="onEdit"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
      </button>
    </span>
  `,
}
