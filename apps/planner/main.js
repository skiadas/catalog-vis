// Planner app bootstrap: parse the hash route (including the cross-app deep
// link from browse — ?program=<id>&track=<key> — which is added before the
// catalog loads), then load the catalog into the shared refs.
import { errorMessage, loading, loadCatalog } from '@major-vis/catalog-client'
import { route, initRouter } from './router.js'
import { createApp } from 'vue'
import { addTrack } from './src/plannerStore.js'
import PlannerApp from './components/PlannerApp.js'

initRouter()
// Cross-app deep link from the browse app: #/?program=<id>&track=<trackKey>.
// The track is added here (idempotent) so the audit picks it up once the
// catalog data loads. A catalog load failure rejects; the banner renders
// `errorMessage` instead.
if (route.value.params.program && route.value.params.track) {
  addTrack(route.value.params.program, route.value.params.track)
}
loadCatalog({ baseUrl: '../../' }).catch(() => {})

const app = createApp({
  setup() {
    return { loading, errorMessage }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <div v-else-if="errorMessage" class="catalog-error">{{ errorMessage }}</div>
    <PlannerApp v-else />
  `,
})

app.component('PlannerApp', PlannerApp)
app.mount('#app')
