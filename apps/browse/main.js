// Browse app bootstrap: mount with the vue-router (hash) history, then load
// the catalog into the shared refs (baseUrl reaches the repo-root JSON when
// co-deployed). The root component (App.vue) switches views by route name.
import { loadCatalog } from '@major-vis/catalog-client'
import { createApp } from 'vue'
import { router } from './router.js'
import App from './App.vue'

createApp(App).use(router).mount('#app')
// A catalog load failure rejects; App.vue renders `errorMessage` instead.
loadCatalog({ baseUrl: '../../' }).catch(() => {})
