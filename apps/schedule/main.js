// Schedule app bootstrap: load the catalog (baseUrl reaches the repo-root JSON
// when co-deployed), then seed the "Sample schedule" collection once the catalog
// is available. The root component (App.vue) renders the top-nav (schedule
// title, remote sign-in, help) and the schedule app body.
//
// Standalone app: no cross-app navigation. The root launcher (index.html) is
// the only place that knows the other apps exist.
import { loadCatalog } from '@major-vis/catalog-client'
import { watchAppVersion } from '@major-vis/app-config'
import { notify } from '@major-vis/shared-components'
import { createApp } from 'vue'
import { Pencil, Eye, EyeOff, Lock, Trash2, Copy, FlaskConical, MessageSquarePlus } from 'lucide-vue-next'
import { router } from './router.js'
import { initScheduleCollection, flushDrafts } from './src/scheduleStore.js'
import App from './App.vue'
import '../../style/schedule.scss'

// Icon components (lucide) registered globally as `Icon<Name>` so any
// component's template can use them without per-file imports. Only the icons
// listed here are bundled (tree-shaken).
const icons = { Pencil, Eye, EyeOff, Lock, Trash2, Copy, FlaskConical, MessageSquarePlus }
const app = createApp(App)
for (const [name, component] of Object.entries(icons)) app.component(`Icon${name}`, component)
app.use(router).mount('#app')
// Load the catalog (baseUrl reaches the repo-root JSON when co-deployed), then
// seed the schedule collection — from the backend when one is present, else the
// local "Sample schedule". A catalog load failure rejects (App.vue renders
// `errorMessage`); seeding is skipped so a broken catalog never generates a
// garbage sample.
loadCatalog({ baseUrl: '../../' })
  .then(initScheduleCollection)
  .catch(() => {})

// Offer a refresh when the server has moved past this bundle. The unsent draft
// is flushed first so the reload restores it (see draftPersistence.js); no-op in
// dev / static hosting, where there is no /api/version or build id.
watchAppVersion({
  current: __APP_VERSION__,
  endpoint: '../../api/version',
  onStale: () =>
    notify.action('A newer version of this app is available.', {
      label: 'Refresh',
      onClick: () => {
        flushDrafts()
        location.reload()
      },
    }),
})
