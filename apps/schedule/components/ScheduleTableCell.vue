<template>
  <td class="schedule-table-cell" :class="{ 'schedule-table-cell-edit': isEditing }">
    <input
      v-if="isEditing"
      ref="inputEl"
      class="schedule-table-input"
      :type="type"
      v-model="draft"
      :aria-label="label"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
    />
    <button
      v-else-if="editable && !locked"
      type="button"
      class="schedule-table-value schedule-table-value-edit"
      :class="{ 'is-empty': !display }"
      :aria-label="editLabel"
      @click="begin"
    >
      {{ display || emptyText }}
    </button>
    <span v-else class="schedule-table-value" :class="{ 'is-empty': !display }">{{
      display || emptyText
    }}</span>
  </td>
</template>

<script>
// One editable cell of the table view. A click turns the display into an
// input; Enter or blur commits the raw draft (the parent parses it), Esc
// cancels. `locked` (a lab's shared title) stays display-only. The parent owns
// the value and validity — an invalid draft simply leaves the value unchanged.

import { nextTick, ref } from 'vue'

export default {
  name: 'ScheduleTableCell',
  props: {
    value: { type: [String, Number], default: '' },
    display: { type: String, default: '' },
    editable: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    type: { type: String, default: 'text' },
    label: { type: String, default: 'Cell' },
    editLabel: { type: String, default: '' },
    emptyText: { type: String, default: '—' },
  },
  emits: ['commit'],
  setup(props, { emit }) {
    const isEditing = ref(false)
    const draft = ref('')
    const inputEl = ref(null)

    const begin = () => {
      if (!props.editable || props.locked) return
      draft.value = props.value == null ? '' : String(props.value)
      isEditing.value = true
      nextTick(() => {
        if (inputEl.value) inputEl.value.focus()
      })
    }
    const commit = () => {
      if (!isEditing.value) return
      const v = draft.value
      isEditing.value = false
      emit('commit', v)
    }
    const cancel = () => {
      isEditing.value = false
    }

    return { isEditing, draft, inputEl, begin, commit, cancel }
  },
}
</script>
