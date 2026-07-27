# Requirements Codification Schema

This document describes how raw requirement text in `majors.json` is transformed into structured JSON in `requirements_parsed.json`.

## Purpose

Each program in `majors.json` has a `requirements` dict where each entry has a `label` and `text`. The text is free-form prose. This schema codifies that text into a structured representation that programs can traverse programmatically.

## Known Course Prefixes

The following 42 prefixes are used by Hanover College courses. Always normalize to uppercase.

```
ANTH, ARTD, ARTH, AST, BCH, BIO, BUSN, CHE, CLA, COM, CS,
DSCI, ECO, EDU, ENG, ENGR, ENV, FRE, GEO, GER, GNDS, GRE,
HIS, HMS, ID, INS, KIP, LAT, MAT, ML, MRS, MUS, NUR, PHI,
PHY, PLS, PSY, SMGT, SOC, SPA, THR, THS
```

## Output Structure

### Top Level

`requirements_parsed.json` is a JSON object with:

```json
{
  "schema_version": "1.0",
  "generated_at": "2026-07-27",
  "source": "majors.json",
  "programs": [
    {
      "id": "biology",
      "name": "Biology",
      "requirements": [
        {
          "label": "Major: Bachelor of Arts",
          "sections": [ ... ]
        }
      ]
    }
  ]
}
```

### Section Structure

Each requirement contains one or more `sections`. A section has:

```json
{
  "heading": "Biology courses",
  "items": [ ... ]
}
```

The heading is the group name (e.g. "Biology courses", "Cognate courses", "Core", etc.). A section with no explicit heading uses `"heading": ""` or groups by implication from the text.

### Item Types

#### `course` — A specific course requirement

```json
{"type": "course", "code": "BIO 161"}
```

| Field   | Description |
|---------|-------------|
| `code`  | Full course code with uppercase prefix and number, e.g. `"BIO 161"` |
| `note`  | Optional note, e.g. `"Culminating experience"`, `"or equivalent"` |

#### `any_of` — A list of alternatives (choose one or more)

```json
{"type": "any_of", "codes": ["BIO 336", "BIO 314"], "note": "choose one"}
```

| Field   | Description |
|---------|-------------|
| `codes` | Array of course code strings |
| `note`  | Optional note |

#### `electives` — A count of courses from a pool with constraints

```json
{
  "type": "electives",
  "count": 5,
  "constraints": [
    {"type": "level", "level": 300, "min": 2},
    {"type": "exclude", "codes": ["BIO 301", "BIO 307"]},
    {"type": "from", "codes": ["BIO 223", "BIO 235", "BIO 313"]}
  ]
}
```

| Field   | Description |
|---------|-------------|
| `count` | Number of courses to choose (integer or null if unspecified) |
| `constraints` | Array of constraint objects (see below) |

**Constraint types**:
- `{"type": "level", "level": 300, "min": 2}` — at least N courses at that level
- `{"type": "level", "level": 200, "min": null, "comparison": "or_above"}` — at the 200 level or above
- `{"type": "exclude", "codes": ["BIO 301"]}` — courses that cannot count
- `{"type": "from", "codes": ["BIO 223", "BIO 235"]}` — explicit pool of eligible courses
- `{"type": "from", "note": "any course at or above the 300 level"}` — descriptive pool

#### `level_gate` — A standalone level requirement

```json
{"type": "level_gate", "level": 100, "comparison": "exclude", "note": "not including 100 level courses"}
```

Or for inclusion:

```json
{"type": "level_gate", "level": 300, "comparison": "at_least", "count": 2, "note": "two at the 300 level"}
```

#### `custom` — A requirement that cannot be cleanly codified

```json
{"type": "custom", "text": "Any five Communication units."}
```

## Common Text Patterns and How to Handle Them

### 1. Semicolons separate items

> `161; 185; 221; 462 (Culminating experience); five others`

Each semicolon-delimited piece is an item. Split on semicolons first.

### 2. Bare numbers belong to current department

> `161; 185; 221` → `BIO 161`, `BIO 185`, `BIO 221` (when prefix is BIO)

Prepend the program's `course_prefix` to bare numbers.

### 3. "or" introduces alternatives

> `335 or 352` → `any_of` with codes `BIO 335`, `BIO 352`
> `CHE 341 and 342` → `any_of` with codes `CHE 341`, `CHE 342` (both required as a pair)
> `457 or 471` → `any_of` with codes

### 4. "and" joins required-together courses

> `CHE 341 and 342` → these must both be taken (a pair)

### 5. "at the 300 level" — level constraints

> `two of which must be at the 300 level` → `level` constraint with `level: 300, min: 2`
> `at the 200-level or above` → `level` constraint with `level: 200, comparison: "or_above"`
> `not including 100 level courses` → `level_gate` with `comparison: "exclude"`

### 6. Exclusion phrases

> `but not include 301, 307, 308` → `exclude` constraint
> `not to include 301, 302, 307` → `exclude` constraint
> `excluding 308, 309, and 372` → `exclude` constraint
> `not including 115 or 116` → `exclude` constraint

### 7. Counts

> `five others` → `electives` with `count: 5`
> `four additional courses` → `electives` with `count: 4`
> `three other courses` → `electives` with `count: 3`
> `Total of 9 major courses` → stored as `total` in the section

### 8. Ranges with "x"

> `GEO 16x` → any GEO 160-169 level course
> `EDU 33X` → any EDU 330-339 level course

### 9. Pairs and groups

> `one pair from the following: CHE 341 and 342 / CS 220 and either 223 or 229 / ...`
> Each sub-group is an `any_of` of courses within that pair.

### 10. Percent and unit notations

> `.25 unit` → stored as `unit` item

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
- "or" introduces alternatives → use type "any_of"
- "and" joins courses that must be taken together
- Level phrases ("at the 300 level", "200-level or above") become "level" constraints
- Exclusion phrases ("not include", "not to include", "excluding", "other than") become "exclude" constraints
- Count words ("five others", "two additional") become elective counts
- "Culminating experience" in parens after a course → note field
- Only reference course codes actually mentioned in the text (including bare numbers with prefix prepended)
- Do NOT hallucinate courses
- If something cannot be codified, use {"type": "custom", "text": "..."}

Output JSON for the sections array only (no wrapper).
```
