// Browser-safe runtime entry for the catalog contract.
//
// The JSON Schemas in `schemas/` are the data-validation artifact (CI runs
// them over the committed catalog files in `validate:catalog`); this module is
// the same machinery callable from the browser, so apps can validate fetched
// catalog documents before rendering them — fail loud instead of rendering
// garbage. `validate.mjs` (the CLI used by CI) shells into `validateCatalog`
// here, so the pipeline and the apps judge documents identically.
//
// The types shipped alongside (`types.d.ts`, resolvable via the `types`
// export condition) are the code-facing projection; this entry is the runtime
// counterpart. The two must stay in sync: shipping a `validateCatalog` here
// without declaring it there (or vice versa) breaks consumers at runtime or
// typecheck.

import Ajv2020 from 'ajv/dist/2020.js'
import majorsSchema from './schemas/majors.schema.json' with { type: 'json' }
import requirementsSchema from './schemas/requirements.schema.json' with { type: 'json' }
import coreSchema from './schemas/core.schema.json' with { type: 'json' }

// The three canonical catalog artifacts. `docs` passed to `validateCatalog` is
// keyed by these filenames regardless of where the documents were fetched from.
export const CATALOG_FILES = ['majors.json', 'requirements_parsed.json', 'core_requirements.json']

const ajv = new Ajv2020({ allErrors: true })
/** @type {Array<[string, import('ajv/dist/2020.js').ValidateFunction]>} */
const checkers = [
  ['majors.json', ajv.compile(majorsSchema)],
  ['requirements_parsed.json', ajv.compile(requirementsSchema)],
  ['core_requirements.json', ajv.compile(coreSchema)],
]

/**
 * Validates the three catalog documents against the contract schemas. Returns
 * null when every document conforms, or the per-file failures otherwise.
 *
 * @param {import('./types.d.ts').CatalogDocs} docs
 * @returns {import('./types.d.ts').CatalogValidationIssue[] | null}
 */
export function validateCatalog(docs) {
  const failures = []
  for (const [file, check] of checkers) {
    const data = docs[file]
    if (data === undefined) {
      failures.push({ file, errors: [{ instancePath: '', message: 'document missing' }] })
      continue
    }
    if (!check(data)) {
      failures.push({
        file,
        errors: check.errors.map((e) => ({ instancePath: e.instancePath, message: e.message })),
      })
    }
  }
  return failures.length ? failures : null
}
