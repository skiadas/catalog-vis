<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="$emit('close')">
    <div
      ref="modalEl"
      class="modal modal-wide"
      role="dialog"
      aria-modal="true"
      aria-labelledby="directory-title"
    >
      <div class="modal-head">
        <h3 id="directory-title">User directory</h3>
        <button class="modal-close" @click="$emit('close')" aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p v-if="feedback" class="suggested-feedback" role="status">{{ feedback }}</p>
        <p class="modal-intro">
          Accounts are created when people first sign in; this directory links them to their real name and the
          departments they belong to. People added here can be granted access before they ever sign in.
        </p>

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

        <div v-if="!users.length" class="schedule-manage-empty">No accounts yet.</div>
        <div v-else class="directory-list">
          <div v-for="u in users" :key="u.id" class="directory-row">
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
        <div class="controls">
          <span class="controls-spacer"></span>
          <button class="filter-btn" @click="$emit('close')">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// The admin-managed user directory: real names and department prefixes for
// the JIT-provisioned accounts. Admins see the Directory button in the nav;
// this modal lists everyone, edits display names and departments, and
// pre-creates accounts for people who haven't signed in yet. The departments
// are the scope used later to decide whose suggestions may touch which
// courses.

import * as backend from '../src/backend.js'
import { displayName } from '../src/names.js'
import { useModalFocus } from '../src/modalFocus.js'

import { ref, watch } from 'vue'

export default {
  name: 'DirectoryModal',
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const modalEl = ref(null)
    useModalFocus(
      () => props.isOpen,
      modalEl,
      () => emit('close'),
    )
    const users = ref([])
    const feedback = ref('')
    const saving = ref(false)
    const newUsername = ref('')
    const newDisplayName = ref('')
    const editingDeptFor = ref(null)
    const deptDraft = ref('')

    const load = async () => {
      feedback.value = ''
      editingDeptFor.value = null
      users.value = await backend.fetchAdminUsers()
    }
    watch(
      () => props.isOpen,
      (open) => {
        if (open) void load()
      },
    )

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

    return {
      modalEl,
      users,
      feedback,
      saving,
      newUsername,
      newDisplayName,
      editingDeptFor,
      deptDraft,
      doAdd,
      setName,
      addDept,
      removeDept,
      displayName,
    }
  },
}
</script>
