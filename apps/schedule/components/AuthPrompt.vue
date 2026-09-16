<template>
  <div v-if="authPromptOpen" class="modal-overlay" @click.self="dismiss">
    <div ref="modalEl" class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-auth-title">
      <div class="modal-head">
        <h3 id="schedule-auth-title">{{ offlineMode ? 'Go online?' : 'Sign in or work offline' }}</h3>
        <button class="modal-close" @click="dismiss" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-intro">
          <template v-if="offlineMode">
            Your offline work stays in <strong>this browser only</strong> and will
            <strong>not</strong> transfer to the server when you sign in. Offline mode is for your testing use
            only.
          </template>
          <template v-else>
            A shared server is available. Sign in to save and share schedules with your group, or work offline
            for your testing use only — offline work stays in this browser and never transfers to the server.
          </template>
        </p>

        <div class="auth-prompt-actions">
          <button v-if="!showForm" class="filter-btn primary" @click="beginOnline">
            {{ isOidc ? 'Sign in with SSO' : 'Sign in' }}
          </button>
          <button v-if="!offlineMode && !showForm" class="filter-btn" @click="workOffline">
            Work offline
          </button>
          <button v-if="offlineMode && !showForm" class="filter-btn" @click="dismiss">Stay offline</button>
        </div>

        <form v-if="showForm" class="schedule-auth-form auth-prompt-form" @submit.prevent="submit">
          <input
            class="search-input schedule-auth-input"
            type="text"
            v-model="usernameDraft"
            placeholder="username"
            aria-label="Username"
          />
          <button class="filter-btn primary" type="submit" :disabled="!usernameDraft.trim()">Sign in</button>
        </form>
        <span v-if="authError || redirectError" class="schedule-auth-error" role="alert">
          {{ authError || redirectError }}
        </span>
      </div>
    </div>
  </div>
</template>

<script>
// "Sign in or work offline" auth prompt, shown at boot when a server is present
// but the visitor has no session (and when leaving offline mode). Sign-in is
// either username self-identify (inline form) or the server's OIDC redirect (a
// button that leaves for the issuer). Work done offline stays local-only and
// never transfers; the dialog says so at every branch.
import {
  offlineMode,
  authPromptOpen,
  authProvider,
  authError as redirectError,
  signIn,
  startSsoLogin,
  workOffline,
  resumeOnline,
  closeAuthPrompt,
} from '../src/scheduleStore.js'
import { useModalFocus } from '../src/modalFocus.js'

import { computed, ref } from 'vue'

export default {
  name: 'AuthPrompt',
  setup() {
    const usernameDraft = ref('')
    const authError = ref('')
    const showForm = ref(false)
    const modalEl = ref(null)
    const isOidc = computed(() => authProvider.value === 'oidc')

    // "Sign in": leave offline mode if needed and check for a session. With a
    // live session the dialog closes; with OIDC the browser leaves for the
    // issuer; with username self-identify the form appears.
    const beginOnline = async () => {
      const resumed = await resumeOnline()
      authError.value = ''
      if (resumed) return
      if (isOidc.value) {
        startSsoLogin()
        return
      }
      showForm.value = true
    }
    const submit = async () => {
      authError.value = ''
      const ok = await signIn(usernameDraft.value)
      if (ok) {
        closeAuthPrompt()
        usernameDraft.value = ''
        showForm.value = false
      } else {
        authError.value = 'Could not sign in — check the username and that the server is up.'
      }
    }
    const dismiss = () => {
      closeAuthPrompt()
      usernameDraft.value = ''
      authError.value = ''
      showForm.value = false
    }
    useModalFocus(authPromptOpen, modalEl, dismiss)
    return {
      modalEl,
      offlineMode,
      authPromptOpen,
      isOidc,
      redirectError,
      usernameDraft,
      authError,
      showForm,
      beginOnline,
      submit,
      workOffline,
      dismiss,
    }
  },
}
</script>
