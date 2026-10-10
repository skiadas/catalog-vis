<template>
  <nav class="top-nav">
    <div class="nav-brand">
      <span class="nav-logo">HC</span>
      <span>Hanover Catalog</span>
    </div>
  </nav>

  <div v-if="loading" class="loading">Loading catalog data...</div>
  <div v-else-if="errorMessage" class="catalog-error">{{ errorMessage }}</div>
  <RouterView v-else />

  <!-- App-wide toasts (see @major-vis/shared-components); mounted once so a
       toast survives the route change that triggered it. -->
  <Notifier />
</template>

<script>
// Planner app root: the top-nav plus the planner view (RouterView renders the
// per-route component). main.js parses the hash route (including the cross-app
// deep link from browse) and loads the catalog before this mounts.
import { errorMessage, loading } from '@major-vis/catalog-client'
import { Notifier } from '@major-vis/shared-components'

export default {
  name: 'PlannerAppRoot',
  components: { Notifier },
  setup() {
    return { loading, errorMessage }
  },
}
</script>
