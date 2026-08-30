// Browse app bootstrap: parse the hash route, then load the catalog into the
// shared refs (baseUrl reaches the repo-root JSON when co-deployed). The root
// component (App.vue) switches views by route.view.
import { loadCatalog } from '@major-vis/catalog-client'
import { initRouter } from './router.js'
import { createApp } from 'vue'
import App from './App.vue'

initRouter()
// A catalog load failure rejects; App.vue renders `errorMessage` instead.
loadCatalog({ baseUrl: '../../' }).catch(() => {})

createApp(App).mount('#app')
