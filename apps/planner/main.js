// Planner app bootstrap: parse the hash route (including the cross-app deep
// link from browse — ?program=<id>&track=<key> — which is added before the
// catalog loads), then load the catalog into the shared refs. The root
// component (App.vue) renders the planner view.
import { loadCatalog } from '@major-vis/catalog-client'
import { route, initRouter } from './router.js'
import { createApp } from 'vue'
import { addTrack } from './src/plannerStore.js'
import App from './App.vue'

initRouter()
// Cross-app deep link from the browse app: #/?program=<id>&track=<trackKey>.
// The track is added here (idempotent) so the audit picks it up once the
// catalog data loads. A catalog load failure rejects; App.vue renders
// `errorMessage` instead.
if (route.value.params.program && route.value.params.track) {
  addTrack(route.value.params.program, route.value.params.track)
}
loadCatalog({ baseUrl: '../../' }).catch(() => {})

createApp(App).mount('#app')
