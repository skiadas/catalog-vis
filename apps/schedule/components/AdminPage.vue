<template>
  <section class="admin-page" aria-labelledby="admin-title">
    <div class="admin-head">
      <h2 id="admin-title" class="admin-title">User directory</h2>
      <RouterLink class="filter-btn" to="/">← Schedules</RouterLink>
    </div>

    <div v-if="!canManage" class="admin-denied" role="status">
      <p>{{ deniedMessage }}</p>
      <p>
        <RouterLink class="filter-btn" to="/">Back to schedules</RouterLink>
      </p>
    </div>

    <template v-else>
      <p v-if="feedback" class="suggested-feedback" role="status">{{ feedback }}</p>
      <p class="modal-intro">
        Accounts are created when people first sign in; this directory links them to their real name and the
        departments they belong to. People added here can be granted access before they ever sign in, and a
        non-owner's suggested changes are limited to their departments.
      </p>

      <section class="admin-import" aria-labelledby="admin-import-title">
        <h3 id="admin-import-title" class="admin-section-title">Bulk import</h3>
        <p class="field-hint">
          Upload a CSV with the columns <code>username,displayName,departments</code> — a header row is
          optional, and departments go in one cell separated by commas, semicolons, or spaces. Existing
          accounts are updated; new ones are created.
        </p>
        <div class="admin-import-actions">
          <label class="filter-btn admin-file-label" :class="{ disabled: importing }" for="admin-import-file">
            Choose CSV…
            <input
              id="admin-import-file"
              class="admin-file-input"
              type="file"
              accept=".csv,text/csv"
              aria-label="Import CSV file"
              :disabled="importing"
              @change="onImportFile"
            />
          </label>
          <button type="button" class="filter-btn" @click="downloadTemplate">Download template</button>
        </div>
        <p v-if="importing" class="field-hint" role="status">Importing…</p>
        <p v-else-if="importSummary" class="suggested-feedback" role="status">{{ importSummary }}</p>
        <ul v-if="importErrors.length" class="admin-import-errors">
          <li v-for="e in importErrors" :key="e.row + ':' + e.reason">
            Row {{ e.row }}: {{ errorText(e.reason) }}
          </li>
        </ul>
      </section>

      <section class="admin-accounts" aria-labelledby="admin-accounts-title">
        <h3 id="admin-accounts-title" class="admin-section-title">Accounts</h3>

        <div class="field">
          <span class="field-label">Add account</span>
          <div class="directory-add">
            <input
              class="search-input"
              type="text"
              placeholder="username"
              aria-label="Directory username"
              v-model="newUsername"
            />
            <input
              class="search-input"
              type="text"
              placeholder="Real name"
              aria-label="Directory display name"
              v-model="newDisplayName"
            />
            <button class="filter-btn primary" :disabled="!newUsername.trim() || saving" @click="doAdd">
              Add
            </button>
          </div>
        </div>

        <div class="field">
          <label class="field-label" for="admin-filter">Filter</label>
          <input
            id="admin-filter"
            class="search-input"
            type="search"
            placeholder="Search name or username"
            v-model="query"
          />
        </div>

        <div v-if="!filteredUsers.length" class="schedule-manage-empty">
          {{ users.length ? 'No accounts match that filter.' : 'No accounts yet.' }}
        </div>
        <div v-else class="directory-list">
          <div v-for="u in filteredUsers" :key="u.id" class="directory-row">
            <div class="directory-main">
              <span class="directory-name">{{ displayName(u.displayName || u.username) }}</span>
              <span class="directory-username" :title="u.username">{{ displayName(u.username) }}</span>
              <div class="directory-depts">
                <span v-for="d in u.departments" :key="d" class="directory-dept">
                  {{ d }}
                  <button
                    class="directory-dept-remove"
                    :aria-label="
                      'Remove department ' + d + ' from ' + displayName(u.displayName || u.username)
                    "
                    title="Remove"
                    @click="removeDept(u, d)"
                  >
                    ×
                  </button>
                </span>
                <span v-if="!u.departments.length" class="directory-dept-none">no departments</span>
                <button
                  class="directory-dept-add"
                  :aria-label="'Add department for ' + displayName(u.displayName || u.username)"
                  title="Add department"
                  @click="editingDeptFor = editingDeptFor === u.id ? null : u.id"
                >
                  +
                </button>
              </div>
              <div v-if="editingDeptFor === u.id" class="directory-dept-editor">
                <input
                  class="search-input"
                  type="text"
                  placeholder="e.g. CS"
                  aria-label="Department prefix"
                  list="directory-dept-prefixes"
                  v-model="deptDraft"
                  @keydown.enter.prevent="addDept(u)"
                />
                <button class="filter-btn" :disabled="!deptDraft.trim()" @click="addDept(u)">Add</button>
              </div>
            </div>
            <input
              class="search-input directory-name-edit"
              type="text"
              :value="u.displayName || ''"
              placeholder="Real name"
              :aria-label="'Display name for ' + displayName(u.username)"
              @change="setName(u, $event)"
            />
          </div>
        </div>
        <datalist id="directory-dept-prefixes">
          <option v-for="p in deptPrefixes" :key="p" :value="p"></option>
        </datalist>
      </section>
    </template>
  </section>
</template>

<script>
// The admin page: the user directory (real names + department prefixes for the
// JIT-provisioned accounts) plus bulk CSV import. Admins reach it from the
// header's Directory link; everyone else sees a denial message. Departments are
// the scope used to decide whose suggestions may touch which courses. Route
// component, so it unmounts on navigation — state resets for free.

import * as backend from '../src/backend.js'
import { allCourses } from '@major-vis/catalog-client'
import { displayName } from '../src/names.js'
import { remote, currentUser, isAdmin, serverDetected } from '../src/scheduleStore.js'

import { computed, onMounted, ref, watch } from 'vue'

const IMPORT_TEMPLATE =
  'username,displayName,departments\ncskiadas,Charilaos Skiadas,"CS, MATH"\nwahl,John Wahl,CS\n'

const IMPORT_ERROR_TEXT = {
  missing_username: 'missing username',
  bad_departments: 'invalid department (one prefix per entry, up to 12 characters)',
  unreadable_csv: 'the file could not be read as CSV',
}

export default {
  name: 'AdminPage',
  setup() {
    const users = ref([])
    const query = ref('')
    const feedback = ref('')
    const saving = ref(false)
    const newUsername = ref('')
    const newDisplayName = ref('')
    const editingDeptFor = ref(null)
    const deptDraft = ref('')
    const importing = ref(false)
    const importSummary = ref('')
    const importErrors = ref([])

    // Department autocomplete: the course prefixes that exist in the catalog.
    const deptPrefixes = computed(() => {
      const set = new Set()
      for (const code of Object.keys(allCourses.value)) set.add(code.split(' ')[0])
      return Array.from(set).sort()
    })

    const filteredUsers = computed(() => {
      const q = query.value.trim().toLowerCase()
      if (!q) return users.value
      return users.value.filter((u) => {
        const name = String(u.displayName || '').toLowerCase()
        const username = String(u.username || '').toLowerCase()
        return name.includes(q) || username.includes(q)
      })
    })

    const canManage = computed(() => Boolean(remote.value && isAdmin.value))
    const deniedMessage = computed(() => {
      if (!serverDetected.value || !remote.value)
        return 'Directory management needs the schedule server; this session is offline.'
      if (!currentUser.value) return 'Sign in to manage the user directory.'
      return 'Only administrators can manage the user directory.'
    })

    const load = async () => {
      feedback.value = ''
      editingDeptFor.value = null
      users.value = await backend.fetchAdminUsers()
    }
    onMounted(() => {
      if (canManage.value) void load()
    })
    // A hard load of #/admin mounts before the session is fetched; once the
    // admin flag arrives, load the list.
    watch(canManage, (ok) => {
      if (ok && !users.value.length) void load()
    })

    const doAdd = async () => {
      if (saving.value) return
      saving.value = true
      feedback.value = ''
      const created = await backend.createAdminUser({
        username: newUsername.value,
        displayName: newDisplayName.value.trim() || null,
      })
      saving.value = false
      if (!created) {
        feedback.value = 'Could not add the account — check the username.'
        return
      }
      newUsername.value = ''
      newDisplayName.value = ''
      await load()
      feedback.value = 'Account added.'
    }

    const setName = async (u, e) => {
      const displayNameValue = String(e.target.value || '').trim() || null
      if (displayNameValue === (u.displayName || null)) return
      const saved = await backend.updateAdminUser(u.id, { displayName: displayNameValue })
      if (saved) {
        u.displayName = saved.displayName
        feedback.value = 'Saved.'
      } else {
        feedback.value = 'Could not save — try again.'
      }
    }

    const addDept = async (u) => {
      const raw = deptDraft.value.trim().toUpperCase()
      if (!raw) return
      deptDraft.value = ''
      const departments = [...new Set([...(u.departments || []), raw])]
      const saved = await backend.updateAdminUser(u.id, { departments })
      if (saved) {
        u.departments = saved.departments
        editingDeptFor.value = null
        feedback.value = 'Saved.'
      } else {
        feedback.value = 'Could not save the department.'
      }
    }

    const removeDept = async (u, d) => {
      const departments = (u.departments || []).filter((x) => x !== d)
      const saved = await backend.updateAdminUser(u.id, { departments })
      if (saved) u.departments = saved.departments
      else feedback.value = 'Could not save — try again.'
    }

    const errorText = (reason) => IMPORT_ERROR_TEXT[reason] || reason

    const onImportFile = async (e) => {
      const file = e.target.files && e.target.files[0]
      if (!file) return
      importing.value = true
      importSummary.value = ''
      importErrors.value = []
      const result = await backend.importDirectory(await file.text())
      importing.value = false
      e.target.value = ''
      if (!result) {
        importSummary.value = 'Could not import the file — try again.'
        return
      }
      importSummary.value = `Imported ${result.added} new account${result.added === 1 ? '' : 's'} and updated ${result.updated}.`
      importErrors.value = result.errors || []
      await load()
    }

    const downloadTemplate = () => {
      const blob = new Blob([IMPORT_TEMPLATE], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'directory-template.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }

    return {
      users,
      query,
      feedback,
      saving,
      newUsername,
      newDisplayName,
      editingDeptFor,
      deptDraft,
      importing,
      importSummary,
      importErrors,
      deptPrefixes,
      filteredUsers,
      canManage,
      deniedMessage,
      doAdd,
      setName,
      addDept,
      removeDept,
      errorText,
      onImportFile,
      downloadTemplate,
      displayName,
    }
  },
}
</script>
