<template>
  <div v-if="open && schedule" class="mode-menu" @click.stop @keydown.esc="$emit('close')">
    <button
      class="mode-menu-item"
      :disabled="!canEdit"
      :title="
        canEdit
          ? 'Edit this schedule directly'
          : schedule.owner
            ? `Only ${displayName(schedule.owner)} can edit directly`
            : 'Only the owner can edit directly'
      "
      @click="$emit('mode', schedule.id, 'edit')"
    >
      Edit schedule
    </button>
    <button
      class="mode-menu-item"
      :disabled="!suggestAllowed"
      :title="
        suggestAllowed
          ? 'Collect edits into a proposal the owner approves'
          : 'Only the owner or listed suggesters can propose changes'
      "
      @click="$emit('mode', schedule.id, 'suggest')"
    >
      Suggest changes
    </button>
  </div>
</template>

<script>
// The mode picker shown when a schedule's edit (pencil) button is clicked:
// "Edit" writes the schedule directly (owners; offline everything is direct)
// and "Suggest changes" collects edits into a proposal the owner approves —
// available to anyone the schedule's suggest permission admits (owners always,
// everyone on 'public', listed suggesters on 'shared').

import { remote, isOwner, canSuggest } from '../src/scheduleStore.js'
import { displayName } from '../src/names.js'

import { computed } from 'vue'

export default {
  name: 'ScheduleModeMenu',
  props: {
    schedule: { type: Object, default: null },
    open: { type: Boolean, default: false },
  },
  emits: ['mode', 'close'],
  setup(props) {
    const canEdit = computed(() => !remote.value || isOwner(props.schedule))
    const suggestAllowed = computed(() => canSuggest(props.schedule))
    return { canEdit, suggestAllowed, displayName }
  },
}
</script>
