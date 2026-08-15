import { loading, loadCatalog } from '@major-vis/catalog-client'
import { route, initRouter } from './router.js'
import ProgramList from './components/ProgramList.js'
import ProgramDetail from './components/ProgramDetail.js'
import CourseDetail from './components/CourseDetail.js'
import RequirementSection from './components/RequirementSection.js'
import RequirementItem from './components/RequirementItem.js'

initRouter()
loadCatalog()

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
        <a
          href="#/"
          :class="{ active: route.view === 'programs' || route.view === 'program-detail' || route.view === 'course-detail' }"
        >Programs</a>
        <a href="../schedule/">Schedule</a>
        <a href="../planner/">Planner</a>
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
