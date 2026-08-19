// Browse app bootstrap: parse the hash route, then load the catalog into the
// shared refs (baseUrl reaches the repo-root JSON when co-deployed). Views are
// switched by route.view; components are registered globally for the template.
import { loading, loadCatalog } from '@major-vis/catalog-client'
import { loadConfig, isEnabled, SERVICE_DEFS } from '@major-vis/app-config'
import { route, initRouter } from './router.js'
import ProgramList from './components/ProgramList.js'
import ProgramDetail from './components/ProgramDetail.js'
import CourseDetail from './components/CourseDetail.js'
import RequirementSection from './components/RequirementSection.js'
import RequirementItem from './components/RequirementItem.js'

initRouter()
loadConfig({ endpoint: '../../api/config', staticPath: '../../config.json' })
loadCatalog({ baseUrl: '../../' })

const app = Vue.createApp({
  setup() {
    const serviceDefs = Vue.computed(() =>
      SERVICE_DEFS.filter((s) => isEnabled(s.key)).map((s) => ({
        ...s,
        href: s.key === 'program' ? '#/' : `../${s.dir}/`,
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
          :class="{ active: s.key === 'program' && (route.view === 'programs' || route.view === 'program-detail' || route.view === 'course-detail') }"
        >{{ s.label }}</a>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <ProgramList v-else-if="route.view === 'programs'" />
    <ProgramDetail v-else-if="route.view === 'program-detail'" />
    <CourseDetail v-else-if="route.view === 'course-detail'" />
  `,
})

app.component('ProgramList', ProgramList)
app.component('ProgramDetail', ProgramDetail)
app.component('CourseDetail', CourseDetail)
app.component('RequirementSection', RequirementSection)
app.component('RequirementItem', RequirementItem)
app.mount('#app')
