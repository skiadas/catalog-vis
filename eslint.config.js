import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default [
  { ignores: ['node_modules/', 'dist/'] },
  js.configs.recommended,
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
  prettier,
]
