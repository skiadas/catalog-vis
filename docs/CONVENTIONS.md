# Conventions

General style and naming rules that hold across the repo's JavaScript and
Python code. These are the "how to name things" layer, distinct from the
per-piece contract READMEs and the tooling/workflow notes in `AGENTS.md`.

## Booleans read as predicates

A value that answers a yes/no question is named as that question, not as a
verb or bare noun.

- Good: `isOpen`, `isEnabled`, `canEdit`, `hasError`, `isLoading`, `isOwner`
- Avoid for booleans: `open`, `show`, `edit`, `error`, `loading`

This applies to props, refs, local variables, and object fields.

For Vue components in particular, the predicate form prevents a subtle
shadowing hazard: if a setup function and a prop share a name (a `open()`
helper next to an `open` prop), the setup binding silently hides the prop in
the template. A `isOpen` prop can never collide with a `load()`/`open()`
function. Boolean props render as `:is-open` in templates, matching the
`is-*` predicate read.

(More sections land here as conventions accumulate.)