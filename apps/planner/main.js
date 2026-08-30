// Planner app bootstrap: mount with the vue-router (hash) history, then load
// the catalog into the shared refs. The root component (App.vue) renders the
// planner view.
import { loadCatalog } from '@major-vis/catalog-client'
import { createApp } from 'vue'
import { addTrack } from './src/plannerStore.js'
import { router } from './router.js'
import App from './App.vue'

createApp(App).use(router).mount('#app')
// Cross-app deep link from the browse app: #/?program=<id>&track=<trackKey>.
// The track is added here (idempotent) so the audit picks it up once the
// catalog data loads. A catalog load failure rejects; App.vue renders
// `errorMessage` instead.
router.isReady().then(() => {
  const q = router.currentRoute.value.query
  if (q.program && q.track) addTrack(String(q.program), String(q.track))
})
loadCatalog({ baseUrl: '../../' }).catch(() => {})
