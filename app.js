import { loading } from './lib/store.js'
import { loadData } from './lib/store.js'
import { initRouter, route } from './lib/router.js'
import ProgramList from './components/ProgramList.js'
import ProgramDetail from './components/ProgramDetail.js'
import CourseDetail from './components/CourseDetail.js'
import RequirementSection from './components/RequirementSection.js'

const app = Vue.createApp({
  setup() {
    Vue.onMounted(() => {
      loadData()
      initRouter()
    })
    return { route, loading }
  },
  template: `
    <div v-if="loading" class="loading">Loading catalog data...</div>
    <ProgramList v-if="!loading && route.view === 'programs'" />
    <ProgramDetail v-if="!loading && route.view === 'program-detail'" />
    <CourseDetail v-if="!loading && route.view === 'course-detail'" />
  `
})

app.component('ProgramList', ProgramList)
app.component('ProgramDetail', ProgramDetail)
app.component('CourseDetail', CourseDetail)
app.component('RequirementSection', RequirementSection)
app.mount('#app')
