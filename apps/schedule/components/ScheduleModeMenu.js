// The mode picker shown when a schedule's edit (pencil) button is clicked:
// "Edit" writes the schedule directly (owners; offline everything is direct)
// and "Suggest changes" collects edits into a proposal the owner approves —
// available to owners too, so anyone can float changes without applying them.

import { remote, isOwner } from '../src/scheduleStore.js'

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
    return { canEdit }
  },
  template: `
    <div v-if="open && schedule" class="mode-menu" @click.stop>
      <span class="mode-menu-schedule">{{ schedule.name }}</span>
      <button
        class="mode-menu-item"
        :disabled="!canEdit"
        :title="canEdit ? 'Edit this schedule directly' : 'Only the owner can edit directly'"
        @click="$emit('mode', schedule.id, 'edit')"
      >Edit schedule</button>
      <button
        class="mode-menu-item"
        :title="'Collect edits into a proposal the owner approves'"
        @click="$emit('mode', schedule.id, 'suggest')"
      >Suggest changes</button>
    </div>
  `,
}
