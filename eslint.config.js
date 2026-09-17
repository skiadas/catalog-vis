import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import vueAccessibility from 'eslint-plugin-vuejs-accessibility'

export default [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
  {
    // SFC accessibility rules for the schedule app (the app under the a11y
    // review). Browse/planner .vue files aren't linted yet; extending this
    // config glob to them is the follow-up.
    files: ['apps/schedule/**/*.vue'],
    plugins: { vue: pluginVue, 'vuejs-accessibility': vueAccessibility },
    languageOptions: {
      parser: vueParser,
      parserOptions: { ecmaVersion: 2025, sourceType: 'module' },
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'vuejs-accessibility/aria-props': 'error',
      'vuejs-accessibility/aria-role': 'error',
      'vuejs-accessibility/aria-unsupported-elements': 'error',
      'vuejs-accessibility/form-control-has-label': 'error',
      'vuejs-accessibility/interactive-supports-focus': 'error',
      // The codebase pairs `for`/`id` (not nesting); id association is what
      // WCAG requires for programmatic association.
      'vuejs-accessibility/label-has-for': ['error', { required: { every: ['id'] } }],
      'vuejs-accessibility/role-has-required-aria-props': 'error',
      'vuejs-accessibility/tabindex-no-positive': 'error',
    },
    processor: pluginVue.processors['.vue'],
  },
  {
    // Server runs on Node (not the browser); give it Node globals.
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Root configs that run under Node (the Playwright test runner).
    files: ['playwright.config.js'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Store tests run the browser-facing store under node and deliberately shim
    // `localStorage` (see apps/schedule/test/helpers.mjs).
    files: ['apps/**/test/**/*.mjs'],
    languageOptions: {
      globals: {
        localStorage: 'readonly',
      },
    },
  },
  {
    // E2E specs pass browser objects (DataTransfer, …) into page.evaluate.
    files: ['apps/**/e2e/**/*.mjs'],
    languageOptions: {
      globals: {
        DataTransfer: 'readonly',
      },
    },
  },
  prettier,
]
