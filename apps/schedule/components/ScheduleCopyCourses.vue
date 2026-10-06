<template>
  <div v-if="props.isOpen" class="modal-overlay" @click.self="close">
    <div
      ref="modalEl"
      class="modal modal-wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="schedule-copy-title"
    >
      <div class="modal-head">
        <h3 id="schedule-copy-title">Copy courses into {{ editingName }}</h3>
        <button class="modal-close" @click="close" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-intro">
          Copy another schedule's {{ termLabel }} courses into this one. Matching sections are
          <strong>updated</strong> to the source; missing ones are added. Switch term to copy a different
          term.
        </p>

        <div v-if="!sourceSchedules.length" class="schedule-manage-empty">
          There is no other schedule to copy from.
        </div>

        <template v-else>
          <div class="field">
            <label for="schedule-copy-source">Source schedule</label>
            <select id="schedule-copy-source" class="search-input" v-model="sourceId">
              <option v-for="s in sourceSchedules" :key="s.id" :value="s.id">
                {{ s.name }}{{ s.year ? ' · ' + s.year : '' }}
              </option>
            </select>
          </div>

          <div v-if="prefixOptions.length" class="field">
            <span class="field-label">Departments</span>
            <div class="schedule-copy-prefixes">
              <button
                v-for="p in prefixOptions"
                :key="p"
                type="button"
                class="filter-btn"
                :class="{ active: prefixes.includes(p) }"
                :aria-pressed="prefixes.includes(p)"
                @click="togglePrefix(p)"
              >
                {{ p }}
              </button>
            </div>
            <label class="schedule-copy-siblings" for="schedule-copy-siblings">
              <input id="schedule-copy-siblings" type="checkbox" v-model="includeSiblings" />
              Include cross-listed versions
            </label>
          </div>

          <div class="schedule-copy-summary" role="status">
            <p class="schedule-copy-counts">
              <strong>{{ plan.added }}</strong> new · <strong>{{ plan.updated }}</strong> updated<span
                v-if="plan.unchanged"
              >
                · {{ plan.unchanged }} unchanged</span
              >
              <template v-if="!plan.rows"> — no rows match the selected departments.</template>
            </p>
            <p v-if="plan.orphans.length" class="schedule-upload-warning">
              <strong>{{ plan.orphans.length }} lab row(s) without their lecture</strong> in the selection:
              <span v-for="l in plan.orphans" :key="l" class="schedule-upload-warning-item">{{ l }}</span>
            </p>
            <p v-if="plan.outside.length" class="schedule-upload-warning">
              <strong>Outside your departments</strong> (the proposal would be refused):
              <span v-for="c in plan.outside" :key="c" class="schedule-upload-warning-item">{{ c }}</span>
            </p>
          </div>
        </template>

        <div class="controls">
          <span class="controls-spacer"></span>
          <button class="filter-btn" @click="close">Cancel</button>
          <button class="filter-btn primary" :disabled="!canApply" @click="apply">{{ applyLabel }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// "Copy courses into <schedule>" modal: bulk-upserts a filtered slice of another
// schedule's active-term offerings into the schedule being edited. A source
// picker + department chips drive a live preview (new/updated counts and lab /
// department warnings); confirming writes through the store's `copyCoursesInto`
// — a direct edit for the owner, or the suggest draft for a proposer (where the
// server still enforces the department scope). Visibility via the `isOpen` prop.
import {
  schedules,
  editingSchedule,
  activeTerm,
  myDepartments,
  planCourseCopy,
  copyCoursesInto,
} from '../src/scheduleStore.js'
import { TERM_LABELS } from '@major-vis/schedule-core'
import { useModalFocus } from '../src/modalFocus.js'

import { ref, computed, watch } from 'vue'

export default {
  name: 'ScheduleCopyCourses',
  props: {
    isOpen: { type: Boolean, default: false },
    scheduleId: { type: [String, Number], default: null },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const modalEl = ref(null)
    const sourceId = ref(null)
    const prefixes = ref([])
    const includeSiblings = ref(false)

    const editingName = computed(() => (editingSchedule.value ? editingSchedule.value.name : ''))
    const termLabel = computed(() => TERM_LABELS[activeTerm.value] || activeTerm.value)
    const sourceSchedules = computed(() =>
      schedules.value.filter((s) => String(s.id) !== String(props.scheduleId)),
    )
    const sourceOfferings = computed(() => {
      const s = schedules.value.find((x) => String(x.id) === String(sourceId.value))
      const part = s && s.terms && s.terms[activeTerm.value]
      return (part && part.offerings) || []
    })
    const prefixOptions = computed(() => {
      const set = new Set()
      for (const o of sourceOfferings.value) set.add(String(o.prefix || '').toUpperCase())
      return [...set].filter(Boolean).sort()
    })

    // The modal stays mounted between opens, so reset its scope on open: the
    // first source, no cross-list siblings, and the user's own departments when
    // the source carries them (else every department present).
    const reset = () => {
      const first = sourceSchedules.value[0]
      sourceId.value = first ? first.id : null
      includeSiblings.value = false
      const mine = myDepartments.value.map((d) => String(d).toUpperCase())
      const opts = prefixOptions.value
      const own = opts.filter((p) => mine.includes(p))
      prefixes.value = own.length ? own : [...opts]
    }
    watch(
      () => props.isOpen,
      (open) => {
        if (open) reset()
      },
    )
    // Keep the selected departments valid when the source changes.
    watch(sourceId, () => {
      const opts = prefixOptions.value
      const kept = prefixes.value.filter((p) => opts.includes(p))
      prefixes.value = kept.length ? kept : [...opts]
    })

    const plan = computed(() =>
      props.scheduleId && sourceId.value
        ? planCourseCopy(props.scheduleId, sourceId.value, {
            prefixes: prefixes.value,
            includeSiblings: includeSiblings.value,
          })
        : { added: 0, updated: 0, unchanged: 0, rows: 0, orphans: [], outside: [], offerings: null },
    )
    const canApply = computed(
      () => Boolean(plan.value.offerings) && plan.value.added + plan.value.updated > 0,
    )
    const applyLabel = computed(() => {
      const n = plan.value.added + plan.value.updated
      return n ? `Copy ${n} course${n === 1 ? '' : 's'}` : 'Copy'
    })
    const togglePrefix = (p) => {
      prefixes.value = prefixes.value.includes(p)
        ? prefixes.value.filter((x) => x !== p)
        : [...prefixes.value, p]
    }
    const apply = () => {
      if (!canApply.value) return
      const res = copyCoursesInto(props.scheduleId, {
        sourceId: sourceId.value,
        prefixes: prefixes.value,
        includeSiblings: includeSiblings.value,
      })
      if (res) emit('close')
    }
    const close = () => emit('close')
    useModalFocus(() => props.isOpen, modalEl, close)

    return {
      props,
      modalEl,
      sourceSchedules,
      sourceId,
      prefixOptions,
      prefixes,
      includeSiblings,
      togglePrefix,
      plan,
      canApply,
      applyLabel,
      apply,
      close,
      editingName,
      termLabel,
    }
  },
}
</script>
