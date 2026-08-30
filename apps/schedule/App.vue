<template>
  <nav class="top-nav">
    <div class="nav-brand">
      <span class="nav-logo">HC</span>
      <span>Hanover Catalog</span>
    </div>
    <span class="top-nav-title">Schedule Visualization</span>
    <div class="top-nav-right">
      <button class="schedule-help-toggle" title="How to use this page" @click="toggleHelp">?</button>
      <div v-if="offlineMode" class="schedule-auth-cluster">
        <span class="schedule-offline-badge">ⓘ Offline — testing only · work stays in this browser</span>
        <button class="filter-btn" @click="openAuthPrompt()">Go online</button>
      </div>
      <div v-else-if="remote && !currentUser" class="schedule-auth-cluster">
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
        <span class="schedule-auth-label"
          >Signed in as <strong>{{ currentUser.username }}</strong></span
        >
        <button class="filter-btn" @click="doSignOut">Sign out</button>
      </div>
    </div>
  </nav>

  <div v-if="loading" class="loading">Loading catalog data...</div>
  <div v-else-if="errorMessage" class="catalog-error">{{ errorMessage }}</div>
  <RouterView v-else />

  <ScheduleHelp :is-open="showHelp" @close="showHelp = false" />
  <AuthPrompt />
</template>

<script>
// Schedule app root: the top-nav carries the schedule title, remote sign-in,
// and the help toggle; the app body below is the route component (ScheduleApp,
// which starts with the schedule picker). main.js loads the catalog and seeds
// the collection first. The auth prompt (sign in or work offline) is shown at
// boot when a server is present but the visitor has no session.
import { errorMessage, loading } from '@major-vis/catalog-client'
import { remote, currentUser, offlineMode, openAuthPrompt, signIn, signOut } from './src/scheduleStore.js'
import ScheduleHelp from './components/ScheduleHelp.vue'
import AuthPrompt from './components/AuthPrompt.vue'

import { ref } from 'vue'

export default {
  name: 'ScheduleAppRoot',
  components: { ScheduleHelp, AuthPrompt },
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
      offlineMode,
      openAuthPrompt,
      usernameDraft,
      authError,
      doSignIn,
      doSignOut,
      showHelp,
      toggleHelp,
    }
  },
}
</script>
