// Planner app bootstrap: parse the hash route (including the cross-app deep
// link from browse — ?program=<id>&track=<key> — which is added before the
// catalog loads), then load the catalog into the shared refs.
import { loading, loadCatalog } from '@major-vis/catalog-client'
import { loadConfig, isEnabled, SERVICE_DEFS } from '@major-vis/app-config'
import { route, initRouter } from './router.js'
import { addTrack } from './src/plannerStore.js'
import PlannerApp from './components/PlannerApp.js'

initRouter()
loadConfig({ endpoint: '../../api/config', staticPath: '../../config.json' })
// Cross-app deep link from the browse app: #/?program=<id>&track=<trackKey>.
// The track is added here (idempotent) so the audit picks it up once the
// catalog data loads.
if (route.value.params.program && route.value.params.track) {
  addTrack(route.value.params.program, route.value.params.track)
}
loadCatalog({ baseUrl: '../../' })

const app = Vue.createApp({
  setup() {
    const serviceDefs = Vue.computed(() =>
      SERVICE_DEFS.filter((s) => isEnabled(s.key)).map((s) => ({
        ...s,
        href: s.key === 'planner' ? '#/' : `../${s.dir}/`,
      })),
    )
    return { route, loading, serviceDefs }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
      </div>
      <div class="nav-links">
        <a
          v-for="s in serviceDefs"
          :key="s.key"
          :href="s.href"
          :class="{ active: s.key === 'planner' && route.view === 'planner' }"
        >{{ s.label }}</a>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <PlannerApp v-else />
  `,
})

app.component('PlannerApp', PlannerApp)
app.mount('#app')
