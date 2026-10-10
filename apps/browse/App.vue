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
// Browse app root: the top-nav plus the route-driven view (RouterView). The
// catalog is loaded by main.js; the hash route is parsed by vue-router before
// this mounts. Route components live in router.js.
import { errorMessage, loading } from '@major-vis/catalog-client'
import { Notifier } from '@major-vis/shared-components'

export default {
  name: 'BrowseApp',
  components: { Notifier },
  setup() {
    return { loading, errorMessage }
  },
}
</script>
