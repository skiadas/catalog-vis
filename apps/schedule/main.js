// Schedule app bootstrap: load the catalog (baseUrl reaches the repo-root JSON
// when co-deployed), then seed the "Sample schedule" collection once the catalog
// is available. The root component (App.vue) renders the top-nav (schedule
// title, remote sign-in, help) and the schedule app body.
//
// Standalone app: no cross-app navigation. The root launcher (index.html) is
// the only place that knows the other apps exist.
import { loadCatalog } from '@major-vis/catalog-client'
import { initRouter } from './router.js'
import { createApp } from 'vue'
import { initScheduleCollection } from './src/scheduleStore.js'
import App from './App.vue'

initRouter()
// Load the catalog (baseUrl reaches the repo-root JSON when co-deployed), then
// seed the schedule collection — from the backend when one is present, else the
// local "Sample schedule". A catalog load failure rejects (App.vue renders
// `errorMessage`); seeding is skipped so a broken catalog never generates a
// garbage sample.
loadCatalog({ baseUrl: '../../' })
  .then(initScheduleCollection)
  .catch(() => {})

createApp(App).mount('#app')
