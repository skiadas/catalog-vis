// Browse app bootstrap: mount with the vue-router (hash) history, then load
// the catalog into the shared refs (baseUrl reaches the repo-root JSON when
// co-deployed). The root component (App.vue) switches views by route name.
import { loadCatalog } from '@major-vis/catalog-client'
import { watchAppVersion } from '@major-vis/app-config'
import { notify } from '@major-vis/shared-components'
import { createApp } from 'vue'
import { router } from './router.js'
import App from './App.vue'
import '../../style/browse.scss'

createApp(App).use(router).mount('#app')
// A catalog load failure rejects; App.vue renders `errorMessage` instead.
loadCatalog({ baseUrl: '../../' }).catch(() => {})

// Offer a refresh when the server has moved past this bundle (no-op in dev /
// static hosting, where there is no /api/version or no build id).
watchAppVersion({
  current: __APP_VERSION__,
  endpoint: '../../api/version',
  onStale: () =>
    notify.action('A newer version of this app is available.', {
      label: 'Refresh',
      onClick: () => location.reload(),
    }),
})
