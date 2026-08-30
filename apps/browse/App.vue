<template>
  <nav class="top-nav">
    <div class="nav-brand">
      <span class="nav-logo">HC</span>
      <span>Hanover Catalog</span>
    </div>
  </nav>

  <div v-if="loading" class="loading">Loading catalog data...</div>
  <div v-else-if="errorMessage" class="catalog-error">{{ errorMessage }}</div>
  <ProgramList v-else-if="route.view === 'programs'" />
  <ProgramDetail v-else-if="route.view === 'program-detail'" />
  <CourseDetail v-else-if="route.view === 'course-detail'" />
</template>

<script>
// Browse app root: the top-nav plus the route-driven view switch. The catalog
// is loaded (and the hash route parsed) by main.js before this mounts.
import { errorMessage, loading } from '@major-vis/catalog-client'
import { route } from './router.js'
import ProgramList from './components/ProgramList.vue'
import ProgramDetail from './components/ProgramDetail.vue'
import CourseDetail from './components/CourseDetail.vue'

export default {
  name: 'BrowseApp',
  components: { ProgramList, ProgramDetail, CourseDetail },
  setup() {
    return { route, loading, errorMessage }
  },
}
</script>
