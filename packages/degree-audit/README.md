# @major-vis/degree-audit

Pure, testable requirements evaluator for Hanover's academic catalog. No
framework or DOM dependencies; all data is passed in as arguments, so it runs
under `node --test`, in the browser, or as a server-side degree-audit service.

## Contract

Inputs are always supplied explicitly — the module never imports catalog data.

Course codes are strings like `BIO 161`; cross-listed `ENG/COM 251`, aliased
`GNDR 499` (`GNDR` → `GNDS`), and ranges `ENV 408-409` are resolved by
`expandCode`. `catalog` is any collection keyed by concrete course code (the
planner passes `allCourses`).

### Code helpers

- `courseInfo(code)` → `{ prefixes: string[], number: number|null }`
- `expandCode(code)` → concrete catalog code(s) for a requirement code
  (splits slash codes, applies prefix aliases, expands ranges; keeps the
  original spelling in the set)
- `prefixMatch(code, prefixes)` → boolean

### Node evaluation

- `satisfied(item, taken, catalog, excluded?)` → `{ status, matched, missing,
  needed, count, min, max }` for a single item (`course`, `any_of`,
  `each_of`, `some_of`, `electives`, `pair` (legacy), `custom`/`level_gate` →
  `status: 'unknown'`)
- `assignRequirement(requirement, taken, catalog)` → per-section
  `{ sectionIndex, item, ok, plan, used, pool }` entries, solving the
  "one course per node per track" assignment with backtracking; honors
  `requirement.independentSections` (core curriculum) where sections evaluate
  against the full taken set
- `evaluateRequirement(requirement, taken, catalog)` → `{ label, sections }`
- `evaluateProgram(requirements, taken, catalog)` → list of the above

### Constraints (on `electives`)

Filters scope the universe (`from` codes, plain `discipline`, plain `level`);
aggregates verify counts over the chosen set (`level.atLeast/atMost`,
`discipline.atLeast/atMost/distinctAtLeast`, `sameDiscipline`, `max_from`,
`min_from`). See `packages/catalog-contract` for the full schema.

- `passes(code, constraint)` → boolean
- `filteredUniverse(constraints, catalog)` → `Set<string>` of eligible codes
- `checkAggregates(chosen, constraints)` → boolean

### Planning / audit helpers

- `planGaps(item, taken, catalog)` → `{ need, courses, aggregate?, unknown? }`
- `gapGroups(item, taken, catalog, excluded?)` → `[{ label?, codes?, note? }]`
  human-readable still-needed groups
- `describeConstraints(constraints)` → string
- `audit(evaluatedProgram)` → per-requirement/section status rollup
  (`satisfied`/`partial`/`unsatisfied`/`unknown` + tallies)

## Test

```sh
npm test            # from this package
```

## Reimplementing elsewhere

The behavior contract is `satisfied`/`assignRequirement`/`planGaps`/`audit`
over the item/constraint vocabulary defined by `packages/catalog-contract`
(`requirements.schema.json` + `REQUIREMENTS_SCHEMA.md`). Keep it dependency-free
so it stays embeddable server-side.
