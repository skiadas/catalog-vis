# Requirements Codification Schema

This document describes how raw requirement text in `majors.json` is transformed into structured JSON in `requirements_parsed.json`.

The model is designed so a future program can **evaluate** a requirement against a chosen set of courses: each item type reduces to a satisfiability check, and each `constraints` entry is a filter a course either passes or fails.

## Known Course Prefixes

The following 42 prefixes are used by Hanover College courses. Always normalize to uppercase.

```
ANTH, ARTD, ARTH, AST, BCH, BIO, BUSN, CHE, CLA, COM, CS,
DSCI, ECO, EDU, ENG, ENGR, ENV, FRE, GEO, GER, GNDS, GRE,
HIS, HMS, ID, INS, KIP, LAT, MAT, ML, MRS, MUS, NUR, PHI,
PHY, PLS, PSY, SMGT, SOC, SPA, THR, THS
```

A course's **discipline** is its prefix. Cross-listed courses carry multiple prefixes (e.g. `CLA/HIS 252`) and satisfy a discipline constraint if any of their prefixes matches.

## Output Structure

### Top Level

```json
{
  "schema_version": "2.0",
  "generated_at": "2026-07-27",
  "source": "majors.json",
  "programs": [
    {
      "id": "biology",
      "name": "Biology",
      "requirements": [
        { "label": "Major: Bachelor of Arts", "sections": [ ... ] }
      ]
    }
  ]
}
```

### Section Structure

Each requirement has one or more `sections`:

```json
{ "heading": "Biology courses", "items": [ ... ] }
```

`heading` is the group name (e.g. "Biology courses", "Cognate courses"). A section with no explicit heading uses `"heading": ""`.

## Item Types

Every item has a `type`. `course`, `any_of`, `each_of`, `electives`, and `custom` are the canonical set. `pair` and `level_gate` are legacy and should be migrated away.

#### `course` — a specific course

```json
{"type": "course", "code": "BIO 161"}
```

| Field  | Description |
|--------|-------------|
| `code` | Full course code, uppercase prefix + number (e.g. `"BIO 161"`). |
| `note` | Optional note, e.g. `"Culminating experience"`. |

#### `any_of` — choose exactly one of the alternatives

```json
{"type": "any_of", "codes": ["BIO 336", "BIO 314"], "note": "choose one"}

{"type": "any_of", "items": [
  {"type": "pair", "codes": ["CHE 341", "CHE 342"]},
  {"type": "any_of", "codes": ["GEO 161", "GEO 162", "GEO 163"]}
], "note": "choose one option"}
```

| Field  | Description |
|--------|-------------|
| `codes` | Flat list of alternative course codes (use when alternatives are single courses). |
| `items` | Nested list of **arbitrary item types** — alternatives that are themselves structured requirements. Items recurse (an item may itself be `any_of`, `each_of`, `electives`, etc.). |
| `note`  | Optional label; defaults to "Choose one:". |

Exactly one of `codes` or `items` must be present, never both. Satisfied when **exactly one** child is satisfied.

#### `each_of` — satisfy ALL of the listed sub-requirements

```json
{"type": "each_of", "items": [
  {"type": "any_of", "codes": ["GEO 161", "GEO 162", "GEO 163"]},
  {"type": "any_of", "codes": ["GEO 224", "GEO 323", "GEO 327", "GEO 328", "GEO 334"]}
], "note": "one course from each group"}
```

| Field  | Description |
|--------|-------------|
| `items` | List of arbitrary item types, all of which must be satisfied. |
| `note`  | Optional label; defaults to "Complete all of the following:". |

Use for "one from group A **and** one from group B", and as the target form for a multi-pool `electives` (one sub-`electives` per pool). Replaces `pair`.

> `pair` (legacy) is semantically `each_of` where all children are `course` items; migrate `pair` → `each_of` of `course` children.

#### `some_of` — satisfy at least N of the listed sub-requirements

```json
{"type": "some_of", "min": 2, "note": "choose any two", "items": [
  {"type": "course", "code": "PSY 231"},
  {"type": "electives", "count": 1, "constraints": [{"type": "discipline", "prefixes": ["KIP"]}, {"type": "level", "level": 300, "orAbove": true}]},
  {"type": "electives", "count": 1, "constraints": [{"type": "discipline", "prefixes": ["HMS"]}, {"type": "level", "level": 300, "orAbove": true}]}
]}
```

| Field  | Description |
|--------|-------------|
| `min`   | Minimum number of sub-requirements to satisfy (defaults to 1). |
| `max`   | Optional maximum number (defaults to `items.length`). |
| `items` | List of arbitrary item types. |
| `note`  | Optional label; defaults to "Choose N of the following:". |

Use for "any two of the following:", "three others from …", etc. Generalizes `any_of` (min 1, max 1) and `each_of` (min = all), which remain separate node types for readability.

#### `electives` — choose N courses from a pool, with constraints

```json
{
  "type": "electives",
  "count": 5,
  "note": "ETC courses",
  "constraints": [
    {"type": "level", "level": 300, "atLeast": 2},
    {"type": "level", "level": 200, "orAbove": true, "atLeast": 4},
    {"type": "discipline", "atMost": 2},
    {"type": "exclude", "codes": ["BIO 301", "BIO 307"]},
    {"type": "from", "codes": ["BIO 223", "BIO 235", "BIO 313"]}
  ]
}
```

| Field        | Description |
|--------------|-------------|
| `count`      | Number of courses to choose (integer, or `null` if unspecified). |
| `note`       | Optional label/context. |
| `constraints`| Filters every candidate course must pass (conjunctive). |

`constraints` iterate over the candidate universe of courses; a course satisfies the `electives` count only if it passes **all** constraints.

**Constraint types:**

- `{"type": "level", "level": 300, "atLeast": 2}` — at least 2 at (exactly) the 300 level.
- `{"type": "level", "level": 200, "orAbove": true, "atLeast": 4}` — at least 4 at or above the 200 level.
- `{"type": "level", "level": 100, "atMost": 1}` — no more than 1 at the 100 level.
- `{"type": "level", "level": 300}` — any course at the 300 level.
- `{"type": "level", "min": 160, "max": 169}` — a **range** band (e.g. "GEO 16x").
- `{"type": "discipline"}` — any discipline.
- `{"type": "discipline", "prefixes": ["GER"], "atLeast": 7}` — at least 7 courses with a GER prefix.
- `{"type": "discipline", "atMost": 2}` — no more than 2 in any single discipline.
- `{"type": "discipline", "distinctAtLeast": 3}` — courses drawn from at least 3 different disciplines.
 - `{"type": "discipline", "sameDiscipline": true}` — every chosen course shares at least one common discipline (e.g. a 2-unit World-Language sequence in the *same* language).
 - `{"type": "from", "codes": [...]}` — explicitly eligible pool.
- `{"type": "from", "codes": [...], "note": "may be taken in English"}` — pool with context.
- `{"type": "exclude", "codes": [...]}` — explicitly ineligible.
- `{"type": "max_from", "codes": [...], "atMost": 1, "note": "may be taken in English"}` — no more than `atMost` of the chosen courses may come from this set (a cap, not a filter).
- `{"type": "min_from", "codes": [...], "atLeast": 2, "note": "geographical area courses"}` — at least `atLeast` of the chosen courses must come from this set.
- `{"type": "note", "text": "..."}` — advisory phrasing only (ignored by evaluation, shown for context).

> Legacy `level` constraint fields `comparison` (`or_above` | `at_most` | `exclude`) and `min` are still understood by the renderer but should be migrated to `orAbove`, `atLeast`, `atMost`.

> Legacy: a note-only `from` (e.g. `{"type":"from","note":"at least 7 courses must be in German"}`) should be migrated to a `discipline` constraint. Advisory-only prose becomes a `note` constraint.

#### `level_gate` (legacy)

A standalone level requirement, e.g. `{"type":"level_gate","level":300,"atLeast":4,"note":"Four of six at the 300 level"}`. Migrate to `electives` (with an implicit count) + a `level` constraint.

#### `custom` — a requirement that cannot be cleanly codified

```json
{"type": "custom", "text": "Students must elect one of four tracks."}
```

Used only for genuinely prose/advisory requirements (program admission, "consult advisor", track-selection narration, `Recommended: …`, `.25 unit` credit notes, cross-counting policy). Nothing else.

## Common Text Patterns

### 1. Semicolons separate items
> `161; 185; 221; 462 (Culminating experience); five others`
Each semicolon piece is an item. Split on semicolons first.

### 2. Bare numbers belong to current department
> `161; 185; 221` → `BIO 161`, `BIO 185`, `BIO 221` (prefix BIO)
Prepend the program's `course_prefix`.

### 3. "or" introduces alternatives
> `335 or 352` → `any_of` with codes `BIO 335`, `BIO 352`

### 4. "and" joins courses taken together
> `CHE 341 and 342` → must both be taken → `each_of` of two `course` items (formerly `pair`).

### 5. "one from X and one from Y"
> `One of GEO 161,162,163; and one of GEO 224,323,327,328,334` → `each_of` containing two `any_of`s.

### 6. Level phrases
> `two of which must be at the 300 level` → `level` with `atLeast: 2`
> `at the 200-level or above` → `level` with `orAbove: true`
> `at least four of the five at the 200 level or above` → `level` with `atLeast: 4, orAbove: true`
> `no more than one 100-level course` → `level` with `atMost: 1`
> `not including 100 level courses` → `level` with `atMost: 0`
> `but not include 301, 307, 308` → `exclude` constraint

### 8. Counts
> `five others` → `electives` with `count: 5`. `Total of 9 major courses` → store as `total` in the section.

### 9. Ranges with "x"
> `GEO 16x` → `level` with `{min: 160, max: 169}`. `EDU 33X` → `{min: 330, max: 339}`.

### 10. Discipline / distribution
> `no more than two courses in any single discipline` → `discipline` with `atMost: 2`
> `at least 7 courses must be in German` → `discipline` with `prefixes: ["GER"], atLeast: 7`
> `courses from three different disciplines` → `discipline` with `distinctAtLeast: 3`

### 11. "at most / no more than" — upper bounds
See level patterns above. A standalone upper bound may also be a `level_gate` (legacy) or an `electives` + `level` constraint.

## Processing Prompt (for LLM-based reproduction)

When reprocessing, use the following prompt template with each requirement entry:

```
You are codifying Hanover College course requirements into structured JSON.
Use the schema defined in REQUIREMENTS_SCHEMA.md.

Program name: {program_name}
Course prefix: {course_prefix}
Known prefixes: ANTH, ARTD, ARTH, ..., THS

Requirement label: {label}
Requirement text: {text}

Rules:
- Bare numbers (e.g. "161") get the program's course_prefix prepended (e.g. "BIO 161")
- Semicolons separate individual requirement items
- "or" introduces alternatives -> type "any_of" (codes, or items for nested options)
- "and" between courses that must be taken together -> type "each_of" with course items
- "one from X and one from Y" -> type "each_of" containing the two selections
- "one pair from the following" -> `any_of` with `items` (each item a requirement)
- "any two/three of the following" -> type "some_of" with `min`
- Level phrases -> "level" constraints; use `atLeast`/`atMost` for counts and `orAbove` for "or above"
- Ranges ("GEO 16x") -> level with `min`/`max`
- Discipline phrases ("no more than two in any single discipline", "must be in German") -> "discipline" constraints
- "no more than N from [a set]" / "at most N may be taken in [a set]" -> "max_from" constraint with `atMost`
- Exclusion phrases ("not include", "excluding", "other than") -> "exclude" constraint
- Count words ("five others", "three additional") -> type "electives" with count
- When a constraint note lists course codes, ALWAYS extract them into a "codes" array; keep the note for context
- Section headings in the raw text ("Biology courses:", "Cognate courses:") -> split into separate sections
- "Culminating experience" in parens -> note field on that course
- Only reference course codes actually mentioned in the text (including bare numbers with prefix prepended); do NOT hallucinate
- If something cannot be codified cleanly, use {"type": "custom", "text": "..."}

Output JSON for the sections array only (no wrapper).
```