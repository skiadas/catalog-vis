<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div
      ref="modalEl"
      class="modal modal-wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="core-stats-title"
    >
      <div class="modal-head">
        <h3 id="core-stats-title">Core requirements quick stats</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-intro">
          Offerings and total seats per core-curriculum area across the selected schedules. A lab is not a
          separate offering and its seats are not counted, so a lecture with labs counts once. Each cell shows
          <strong>offerings · seats</strong>.
        </p>
        <table class="courses-table core-stats-table">
          <thead>
            <tr>
              <th>Core requirement</th>
              <th v-for="t in TERM_KEYS" :key="t">{{ TERM_LABELS[t] }}</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stats" :key="row.id">
              <td>
                <span class="core-req-id" :style="{ backgroundColor: colorForCoreReq(row.id) }">{{
                  row.id
                }}</span>
                <span class="core-req-label">{{ row.label }}</span>
              </td>
              <td v-for="t in TERM_KEYS" :key="t" class="core-stat-cell">
                {{ row.terms[t].offerings }} <span class="core-stat-sep">·</span> {{ row.terms[t].seats }}
              </td>
              <td class="core-stat-cell core-stat-total">
                {{ row.totals.offerings }} <span class="core-stat-sep">·</span> {{ row.totals.seats }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script>
// "Core requirements quick stats" dialog: one row per core-curriculum area and
// one column per term plus totals, over the selected schedules (all three terms,
// not just the active one). Counts and seats come from schedule-core's pure
// `coreReqStats` (labs excluded, split meetings merged, unscheduled included).
import { schedules, selectedScheduleIds, viewOfferings } from '../src/scheduleStore.js'
import { coreRequirements } from '@major-vis/catalog-client'
import { TERM_KEYS, TERM_LABELS, coreReqStats, colorForCoreReq } from '@major-vis/schedule-core'
import { useModalFocus } from '../src/modalFocus.js'

import { computed, ref } from 'vue'

export default {
  name: 'CoreStats',
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const modalEl = ref(null)
    const close = () => emit('close')
    useModalFocus(() => props.isOpen, modalEl, close)
    // The merged offerings of the selected schedules for each term part (the
    // published term, not a suggest-session draft — the stats describe what is
    // on the schedules).
    const offeringsByTerm = computed(() => {
      const out = {}
      for (const t of TERM_KEYS) out[t] = []
      const selected = new Set(selectedScheduleIds.value)
      for (const s of schedules.value) {
        if (!selected.has(s.id)) continue
        for (const t of TERM_KEYS) {
          for (const o of viewOfferings(s, t)) out[t].push(o)
        }
      }
      return out
    })
    const stats = computed(() => coreReqStats(offeringsByTerm.value, coreRequirements.value))
    return { modalEl, stats, TERM_KEYS, TERM_LABELS, colorForCoreReq }
  },
}
</script>
