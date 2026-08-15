import { loading, loadCatalog } from '@major-vis/catalog-client'
import { route, initRouter } from './router.js'
import { addTrack } from './src/plannerStore.js'
import PlannerApp from './components/PlannerApp.js'

initRouter()
// Cross-app deep link from the browse app: #/?program=<id>&track=<trackKey>.
// The track is added here (idempotent) so the audit picks it up once the
// catalog data loads.
if (route.value.params.program && route.value.params.track) {
  addTrack(route.value.params.program, route.value.params.track)
}
loadCatalog({ baseUrl: '../../' })

const app = Vue.createApp({
  setup() {
    return { route, loading }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
      </div>
      <div class="nav-links">
        <a href="../browse/">Programs</a>
        <a href="../schedule/">Schedule</a>
        <a href="#/" :class="{ active: route.view === 'planner' }">Planner</a>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <PlannerApp v-else />
  `,
})

app.component('PlannerApp', PlannerApp)
app.mount('#app')
