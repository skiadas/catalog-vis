import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { checkDocsSite } from '../screenshots/validate.mjs'

// The docs-site root, one level up from this config.
const root = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  // One build serves both skiadas.github.io/catalog-vis/docs/ and
  // catalog.harisskiadas.com/docs/.
  base: '/docs/',
  title: 'Major Catalog Visualizer',
  description: 'User guide for the catalog, schedule, and planner apps',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Schedule', link: '/guide/schedule' },
      { text: 'Admin', link: '/guide/admin' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Schedule', link: '/guide/schedule' },
          { text: 'Admin', link: '/guide/admin' },
        ],
      },
    ],
  },
  buildEnd() {
    const problems = checkDocsSite(root)
    if (problems.length > 0) {
      throw new Error(
        `screenshot binding failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
      )
    }
  },
})
