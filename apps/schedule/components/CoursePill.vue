<template>
  <span
    class="slot-pill"
    :class="{ 'filter-colored': filterActive, editable, proposed, removed, reference }"
    :style="filterActive ? { backgroundColor: color } : {}"
    :draggable="draggable"
    :title="pillTitle"
    @dragstart="onDragStart"
  >
    <span v-if="draggable" class="slot-pill-handle" aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="9"
        height="13"
        viewBox="0 0 9 13"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle cx="2.5" cy="2.5" r="1.5" />
        <circle cx="6.5" cy="2.5" r="1.5" />
        <circle cx="2.5" cy="6.5" r="1.5" />
        <circle cx="6.5" cy="6.5" r="1.5" />
        <circle cx="2.5" cy="10.5" r="1.5" />
        <circle cx="6.5" cy="10.5" r="1.5" />
      </svg>
    </span>
    <span
      class="slot-pill-code"
      tabindex="0"
      @click="goScheduleCourse(item.code)"
      @keydown="onKeyActivate($event, () => goScheduleCourse(item.code))"
    >
      {{ codeLabel }}<span class="sep">{{ sectionLabel }}</span>
    </span>
    <span class="slot-pill-name">{{ courseName }}</span>
    <span
      class="slot-pill-inst"
      tabindex="0"
      @click="goScheduleInstructor(item.o.instructor)"
      @keydown="onKeyActivate($event, () => goScheduleInstructor(item.o.instructor))"
    >
      {{ item.o.instructor }}<span v-if="hasOthers" class="slot-pill-multi">*</span>
    </span>
    <button
      v-if="editable"
      class="slot-pill-edit"
      :title="'Edit ' + item.code + item.o.section"
      aria-label="Edit course"
      @click.stop="onEdit"
    >
      <IconPencil :size="11" :stroke-width="2.2" />
    </button>
  </span>
</template>

<script>
import { goScheduleCourse, goScheduleInstructor } from '../router.js'
import { courseName as catalogCourseName } from '@major-vis/catalog-client'
import {
  buildDragPayload,
  instructorsOf,
  offeringCodeLabel,
  offeringSectionLabel,
} from '@major-vis/schedule-core'
import { onKeyActivate } from '../src/keyboardNav.js'
import { isReferenceItem } from '../src/scheduleStore.js'
import { setDragGhost } from '../scheduleDrag.js'

import { computed } from 'vue'

export default {
  name: 'CoursePill',
  props: {
    item: { type: Object, required: true },
    filterActive: { type: Boolean, default: false },
    color: { type: String, default: '' },
    editable: { type: Boolean, default: false },
    draggable: { type: Boolean, default: false },
    dragDay: { type: String, default: '' },
    proposed: { type: String, default: '' },
    removed: { type: String, default: '' },
  },
  emits: ['edit'],
  setup(props, { emit }) {
    const reference = computed(() => isReferenceItem(props.item))
    const courseName = computed(() => catalogCourseName(props.item.code))
    // Registrar-shaped identifiers (BIO 166 / BIO 166L, section A / A2) —
    // labs carry the L in the course number, no separate marker.
    const codeLabel = computed(() => offeringCodeLabel(props.item.o))
    const sectionLabel = computed(() => offeringSectionLabel(props.item.o))
    const hasOthers = computed(() => instructorsOf(props.item.o).length > 1)
    const pillTitle = computed(
      () => props.proposed || props.removed || courseName.value || instructorsOf(props.item.o).join(', '),
    )
    const onDragStart = (e) => {
      // The whole pill is draggable, but the edit pencil stays click-only.
      if (e.target && e.target.closest && e.target.closest('.slot-pill-edit')) {
        e.preventDefault()
        return
      }
      e.dataTransfer.setData('text/plain', buildDragPayload(props.item, props.dragDay))
      e.dataTransfer.effectAllowed = 'move'
      setDragGhost(e)
    }
    const onEdit = () => emit('edit')
    return {
      goScheduleCourse,
      goScheduleInstructor,
      courseName,
      codeLabel,
      sectionLabel,
      hasOthers,
      pillTitle,
      reference,
      onKeyActivate,
      onDragStart,
      onEdit,
    }
  },
}
</script>
