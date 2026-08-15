import { loading, loadCatalog } from '@major-vis/catalog-client'
import { route, initRouter } from './router.js'
import { seedSampleSchedule } from './src/scheduleStore.js'
import ScheduleApp from './components/ScheduleApp.js'

initRouter()
loadCatalog({ baseUrl: '../../' }).then(seedSampleSchedule)

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
        <a href="#/" :class="{ active: route.view.startsWith('schedule') }">Schedule</a>
        <a href="../planner/">Planner</a>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <ScheduleApp v-else />
  `,
})

app.component('ScheduleApp', ScheduleApp)
app.mount('#app')
