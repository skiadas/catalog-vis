// Schedule app bootstrap: load the catalog (baseUrl reaches the repo-root JSON
// when co-deployed), then seed the "Sample schedule" collection once the catalog
// is available.
//
// Standalone app: no cross-app navigation. The root launcher (index.html) is
// the only place that knows the other apps exist.
import { loading, loadCatalog } from '@major-vis/catalog-client'
import { initRouter } from './router.js'
import { createApp } from 'vue'
import { initScheduleCollection } from './src/scheduleStore.js'
import ScheduleApp from './components/ScheduleApp.js'

initRouter()
// Load the catalog (baseUrl reaches the repo-root JSON when co-deployed), then
// seed the schedule collection — from the backend when one is present, else the
// local "Sample schedule".
loadCatalog({ baseUrl: '../../' }).then(initScheduleCollection)

const app = createApp({
  setup() {
    return { loading }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <ScheduleApp v-else />
  `,
})

app.component('ScheduleApp', ScheduleApp)
app.mount('#app')
