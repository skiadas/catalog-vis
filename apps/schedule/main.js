// Schedule app bootstrap: load the catalog (baseUrl reaches the repo-root JSON
// when co-deployed), then seed the "Sample schedule" collection once the catalog
// is available. The top-nav carries the schedule title, remote sign-in, and the
// help toggle; the app body below starts with the schedule picker.
//
// Standalone app: no cross-app navigation. The root launcher (index.html) is
// the only place that knows the other apps exist.
import { errorMessage, loading, loadCatalog } from '@major-vis/catalog-client'
import { initRouter } from './router.js'
import { createApp, ref } from 'vue'
import { initScheduleCollection, remote, currentUser, signIn, signOut } from './src/scheduleStore.js'
import ScheduleApp from './components/ScheduleApp.js'
import ScheduleHelp from './components/ScheduleHelp.js'

initRouter()
// Load the catalog (baseUrl reaches the repo-root JSON when co-deployed), then
// seed the schedule collection — from the backend when one is present, else the
// local "Sample schedule". A catalog load failure rejects (the banner renders
// `errorMessage`); seeding is skipped so a broken catalog never generates a
// garbage sample.
loadCatalog({ baseUrl: '../../' })
  .then(initScheduleCollection)
  .catch(() => {})

const app = createApp({
  components: { ScheduleApp, ScheduleHelp },
  setup() {
    // Remote sign-in (username self-identify). The shared schedules, pending
    // suggestions, and ownership roles all require a session.
    const usernameDraft = ref('')
    const authError = ref('')
    const doSignIn = async () => {
      authError.value = ''
      const ok = await signIn(usernameDraft.value)
      if (ok) {
        usernameDraft.value = ''
      } else {
        authError.value = 'Could not sign in — check the username and that the server is up.'
      }
    }
    const doSignOut = async () => {
      authError.value = ''
      await signOut()
    }
    const showHelp = ref(false)
    const toggleHelp = () => {
      showHelp.value = !showHelp.value
    }
    return {
      loading,
      errorMessage,
      remote,
      currentUser,
      usernameDraft,
      authError,
      doSignIn,
      doSignOut,
      showHelp,
      toggleHelp,
    }
  },
  template: `
    <nav class="top-nav">
      <div class="nav-brand">
        <span class="nav-logo">HC</span>
        <span>Hanover Catalog</span>
      </div>
      <span class="top-nav-title">Schedule Visualization</span>
      <div class="top-nav-right">
        <button class="schedule-help-toggle" title="How to use this page" @click="toggleHelp">?</button>
        <div v-if="remote && !currentUser" class="schedule-auth-cluster">
          <form class="schedule-auth-form" @submit.prevent="doSignIn">
            <input
              class="search-input schedule-auth-input"
              type="text"
              v-model="usernameDraft"
              placeholder="username"
              aria-label="Username"
            />
            <button class="filter-btn primary" type="submit" :disabled="!usernameDraft.trim()">Sign in</button>
          </form>
          <span v-if="authError" class="schedule-auth-error">{{ authError }}</span>
        </div>
        <div v-else-if="remote && currentUser" class="schedule-auth-cluster">
          <span class="schedule-auth-label">Signed in as <strong>{{ currentUser.username }}</strong></span>
          <button class="filter-btn" @click="doSignOut">Sign out</button>
        </div>
      </div>
    </nav>

    <div v-if="loading" class="loading">Loading catalog data...</div>
    <div v-else-if="errorMessage" class="catalog-error">{{ errorMessage }}</div>
    <ScheduleApp v-else />

    <ScheduleHelp :is-open="showHelp" @close="showHelp = false" />
  `,
})

app.mount('#app')
