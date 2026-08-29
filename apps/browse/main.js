// Browse app bootstrap: parse the hash route, then load the catalog into the
// shared refs (baseUrl reaches the repo-root JSON when co-deployed). Views are
// switched by route.view; components are registered globally for the template.
import { loading, loadCatalog } from '@major-vis/catalog-client'
import { route, initRouter } from './router.js'
import { createApp } from 'vue'
import ProgramList from './components/ProgramList.js'
import ProgramDetail from './components/ProgramDetail.js'
import CourseDetail from './components/CourseDetail.js'
import RequirementSection from './components/RequirementSection.js'
import RequirementItem from './components/RequirementItem.js'

initRouter()
loadCatalog({ baseUrl: '../../' })

const app = createApp({
  setup() {
    return { route, loading }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
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
