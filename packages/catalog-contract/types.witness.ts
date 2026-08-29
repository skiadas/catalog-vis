// Compile-time witness for the catalog contract types.
//
// Who checks what on the real emitted documents:
//   - the JSON Schemas are the DATA authority → `validate:catalog` runs them
//     over the actual files, including literal precision (const/enum/pattern);
//   - these types are the CODE contract. This file proves the type surface
//     resolves and that the documents' structural shape is compatible.
//
// JSON-module inference widens string literals (`type: "course"`, `"2.0"` →
// `string`), so the raw file can't be assigned straight into the strict
// discriminated unions. Where widening gets in the way we cast through
// `unknown` and note that the schema owns literal conformance. Deliberately a
// `.ts`: type-checked, never executed.

import type {
  MajorsDoc,
  RequirementsDoc,
  CoreRequirementsDoc,
  RequirementItem,
} from '@major-vis/catalog-contract'

import majorsJson from '../../majors.json'
import requirementsJson from '../../requirements_parsed.json'
import coreJson from '../../core_requirements.json'

// majors.json has no literal-widened discriminators left after `side` is
// modeled as string, so a direct assignment fully gates it.
const majorsDoc: MajorsDoc = majorsJson
void majorsDoc

// requirements/core carry the literal `type` discriminator, which the raw JSON
// widens; validate:catalog enforces the literal vocabulary, so we only gate the
// document shell here.
const requirementsDoc = requirementsJson as unknown as RequirementsDoc
const coreDoc = coreJson as unknown as CoreRequirementsDoc
void requirementsDoc
void coreDoc

// The discriminated union itself is exercised in code-land: constructing a
// node narrows to its branch, and the branch's own fields are visible.
const item: RequirementItem = { type: 'electives', count: 2 }
if (item.type === 'electives') {
  const count: number = item.count
  void count
}
