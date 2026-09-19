<template>
  <span
    class="filter-offering"
    :class="{ proposed, removed, reference }"
    :style="{ backgroundColor: color }"
    :draggable="draggable"
    tabindex="0"
    :title="title || (draggable ? 'Drag to move' : '')"
    @click.stop="goScheduleCourse(item.code)"
    @keydown="onKeyActivate($event, () => goScheduleCourse(item.code))"
    @dragstart="$emit('dragstart', $event)"
  >
    <span v-if="draggable" class="filter-offering-handle" aria-hidden="true">
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
    <span class="filter-offering-main">
      <span class="filter-offering-code"
        >{{ offeringCodeLabel(item.o) }} {{ offeringSectionLabel(item.o) }}</span
      >
      <span class="do-inst">{{ instructorChip(item.o).label }}</span>
    </span>
    <button
      v-if="editable"
      class="filter-offering-edit"
      :title="'Edit ' + item.code"
      aria-label="Edit course"
      @click.stop="$emit('edit')"
    >
      <IconPencil :size="11" :stroke-width="2.2" />
    </button>
  </span>
</template>

<script>
import { goScheduleCourse } from '../router.js'
import { instructorChip, offeringCodeLabel, offeringSectionLabel } from '@major-vis/schedule-core'
import { onKeyActivate } from '../src/keyboardNav.js'
import { isReferenceItem } from '../src/scheduleStore.js'

import { computed } from 'vue'

export default {
  name: 'OfferingRow',
  props: {
    item: { type: Object, required: true },
    color: { type: String, default: '' },
    editable: { type: Boolean, default: false },
    draggable: { type: Boolean, default: false },
    proposed: { type: String, default: '' },
    removed: { type: String, default: '' },
    title: { type: String, default: '' },
  },
  emits: ['edit', 'dragstart'],
  setup(props) {
    const reference = computed(() => isReferenceItem(props.item))
    return {
      goScheduleCourse,
      onKeyActivate,
      offeringCodeLabel,
      offeringSectionLabel,
      instructorChip,
      reference,
    }
  },
}
</script>
