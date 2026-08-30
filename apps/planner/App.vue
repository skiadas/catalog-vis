<template>
  <nav class="top-nav">
    <div class="nav-brand">
      <span class="nav-logo">HC</span>
      <span>Hanover Catalog</span>
    </div>
  </nav>

  <div v-if="loading" class="loading">Loading catalog data...</div>
  <div v-else-if="errorMessage" class="catalog-error">{{ errorMessage }}</div>
  <PlannerApp v-else />
</template>

<script>
// Planner app root: the top-nav plus the planner view. main.js parses the hash
// route (including the cross-app deep link from browse) and loads the catalog
// before this mounts.
import { errorMessage, loading } from '@major-vis/catalog-client'
import PlannerApp from './components/PlannerApp.vue'

export default {
  name: 'PlannerAppRoot',
  components: { PlannerApp },
  setup() {
    return { loading, errorMessage }
  },
}
</script>
