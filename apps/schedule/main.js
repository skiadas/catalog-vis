// Schedule app bootstrap: resolve service config, parse the hash route, load
// the catalog (baseUrl reaches the repo-root JSON when co-deployed), then seed
// the "Sample schedule" collection once the catalog is available.
//
// The nav renders only the services the deployment enables. Schedule is today's
// default service, so it links to its own route; other services link to their
// app directories (relative URLs keep apps liftable).
import { loading, loadCatalog } from '@major-vis/catalog-client'
import { loadConfig, isEnabled, SERVICE_DEFS } from '@major-vis/app-config'
import { route, initRouter } from './router.js'
import { initScheduleCollection } from './src/scheduleStore.js'
import ScheduleApp from './components/ScheduleApp.js'

initRouter()
// Resolve which services are enabled (server /api/config, else ../config.json,
// else all services). The schedule app is the planned default, but the nav
// reflects whatever the deployment enables.
loadConfig({ endpoint: '../../api/config', staticPath: '../../config.json' })

// Load the catalog (baseUrl reaches the repo-root JSON when co-deployed), then
// seed the schedule collection — from the backend when one is present, else the
// local "Sample schedule".
loadCatalog({ baseUrl: '../../' }).then(initScheduleCollection)

const app = Vue.createApp({
  setup() {
    const serviceDefs = Vue.computed(() =>
      SERVICE_DEFS.filter((s) => isEnabled(s.key)).map((s) => ({
        ...s,
        href: s.key === 'schedule' ? '#/' : `../${s.dir}/`,
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
          :class="{ active: s.key === 'schedule' && route.view.startsWith('schedule') }"
        >{{ s.label }}</a>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <ScheduleApp v-else />
  `,
})

app.component('ScheduleApp', ScheduleApp)
app.mount('#app')
