import DefaultTheme from 'vitepress/theme'
import Shot from './components/Shot.vue'

// The <Shot file="…" /> component binds a docs figure to a manifest entry;
// see docs-site/screenshots/manifest.mjs.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Shot', Shot)
  },
}
