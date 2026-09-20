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
      { text: 'Schedule', link: '/guide/schedule/' },
      { text: 'Admin', link: '/guide/admin' },
    ],
    sidebar: [
      {
        text: 'Schedule guide',
        items: [
          { text: 'Getting around', link: '/guide/schedule/' },
          { text: 'Your schedules', link: '/guide/schedule/your-schedules' },
          { text: 'Sharing a schedule', link: '/guide/schedule/sharing' },
          { text: 'The views at a glance', link: '/guide/schedule/views' },
          { text: 'Checking for conflicts', link: '/guide/schedule/conflicts' },
          { text: 'Where a course can hide', link: '/guide/schedule/hiding' },
          { text: 'Editing vs suggesting', link: '/guide/schedule/edit-vs-suggest' },
          { text: 'Adding a course', link: '/guide/schedule/add-course' },
          { text: 'Changing a course', link: '/guide/schedule/edit-course' },
          { text: 'Adding a lab', link: '/guide/schedule/labs' },
          { text: 'Submitting changes', link: '/guide/schedule/proposals' },
          { text: 'Downloading a CSV', link: '/guide/schedule/csv' },
          { text: 'Words used in this app', link: '/guide/schedule/glossary' },
        ],
      },
      {
        text: 'Admin',
        items: [{ text: 'Admin guide', link: '/guide/admin' }],
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
