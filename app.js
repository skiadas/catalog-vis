import { loading } from './lib/store.js'
import { loadData } from './lib/store.js'
import { initRouter, route, goSchedule, goHome } from './lib/router.js'
import ProgramList from './components/ProgramList.js'
import ProgramDetail from './components/ProgramDetail.js'
import CourseDetail from './components/CourseDetail.js'
import RequirementSection from './components/RequirementSection.js'
import RequirementItem from './components/RequirementItem.js'
import ScheduleApp from './components/ScheduleApp.js'
import WeeklyCalendar from './components/WeeklyCalendar.js'

const app = Vue.createApp({
  setup() {
    Vue.onMounted(() => {
      loadData()
      initRouter()
    })
    return { route, loading, goSchedule, goHome }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand" @click="goHome()">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
      </div>
      <div class="nav-links">
        <a :class="{ active: route.view === 'programs' }" @click="goHome()">Programs</a>
        <a :class="{ active: route.view === 'schedule' }" @click="goSchedule()">Schedule</a>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <ProgramList v-else-if="route.view === 'programs'" />
    <ProgramDetail v-else-if="route.view === 'program-detail'" />
    <CourseDetail v-else-if="route.view === 'course-detail'" />
    <ScheduleApp v-else-if="route.view === 'schedule'" />
  `,
})

app.component('ProgramList', ProgramList)
app.component('ProgramDetail', ProgramDetail)
app.component('CourseDetail', CourseDetail)
app.component('RequirementSection', RequirementSection)
app.component('RequirementItem', RequirementItem)
app.component('ScheduleApp', ScheduleApp)
app.component('WeeklyCalendar', WeeklyCalendar)
app.mount('#app')
