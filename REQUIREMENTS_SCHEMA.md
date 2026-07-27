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
| `codes` | Array of course code strings (use when alternatives are single courses) |
| `items` | Array of nested item objects (use when alternatives are groups like `pair`) |
| `note`  | Optional note — becomes the group label when `items` is present |

Simple case — flat list of alternative codes:
```json
{"type": "any_of", "codes": ["BIO 336", "BIO 314"]}
```

Nested case — alternatives that are themselves structured items (pairs, etc.):
```json
{"type": "any_of", "items": [
  {"type": "pair", "codes": ["CHE 341", "CHE 342"]},
  {"type": "pair", "codes": ["KIP 215", "KIP 230"]}
], "note": "choose one pair"}
```

One of `codes` or `items` must be present, never both.

#### `pair` — Courses that must be taken together

```json
{"type": "pair", "codes": ["CHE 341", "CHE 342"], "note": "must be taken together"}
```

| Field   | Description |
|---------|-------------|
| `codes` | Array of 2+ course code strings — all required |
| `note`  | Optional note |

Renders as: `[CHE 341] + [CHE 342]` with the note as a contextual label.

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
- `{"type": "level", "level": 100, "comparison": "at_most", "min": 1}` — at most N courses at that level
- `{"type": "exclude", "codes": ["BIO 301"]}` — courses that cannot count
- `{"type": "from", "codes": ["BIO 223", "BIO 235"]}` — explicit pool of eligible courses
- `{"type": "from", "codes": ["BIO 223", "BIO 235"], "note": "geographical area courses"}` — pool with context. *When codes appear in the source text, always extract them into a `codes` array and keep the note for context.*

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
> Use `any_of` with `items`, where each sub-item is a `pair`. Each `pair` contains the courses that must be taken together within that option.

```json
{"type": "any_of", "items": [
  {"type": "pair", "codes": ["CHE 341", "CHE 342"]},
  {"type": "pair", "codes": ["CS 220", "CS 223"], "note": "or CS 229"}
], "note": "choose one pair"}
```

> `Either KIP 162 and 186, or KIP 215 and 230` → same pattern, two pair alternatives
> `Either PHY 408 and PHY 409, or PHY 471` → `any_of` with one `pair` and one `course`
> `PHY 408 and 409` → `pair` with codes `["PHY 408", "PHY 409"]`
> `CHE 341 and 342` → `pair` with codes `["CHE 341", "CHE 342"]`

### 10. "at most / no more than" — upper bounds

> `No more than one 100-level course may count toward the major`
> → `level` constraint with `comparison: "at_most"` (or a `level_gate`)

```json
{"type": "level", "level": 100, "comparison": "at_most", "min": 1}
```

As a standalone item:

```json
{"type": "level_gate", "level": 100, "comparison": "at_most", "count": 1, "note": "no more than one 100-level course"}
```

### 11. "at least X in language Y" — distribution rules

> `A minimum of 7 courses must be in German. 1 course may be taken in English from: GER 222, GER 243, ...`
> The English-allowable courses should be extracted as a `from` constraint inside the main `electives`. The minimum-in-language rule should be a separate `from` note constraint.

```json
{"type": "electives", "count": 8, "constraints": [
  {"type": "from", "codes": ["GER 222", "GER 243", ...], "note": "may be taken in English"},
  {"type": "from", "note": "at least 7 courses must be in German"}
]}
```

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
- "and" between course codes that must be taken together → use type "pair" (e.g. "CHE 341 and 342")
- "either X and Y, or Z and W" → `any_of` with two `pair` items
- "one pair from the following" → `any_of` with `items` (each item is a `pair`)
- Level phrases ("at the 300 level", "two of which must be at the 300 level", "200-level or above", "at or above the X level") → "level" constraints
- "No more than" / "at most" / upper bound phrases → "level" constraint with comparison "at_most"
- Exclusion phrases ("not include", "not to include", "excluding", "other than", "but not include") → "exclude" constraint
- Count words ("five others", "three additional") → type "electives" with count
- When a constraint note mentions specific course codes, ALWAYS extract them into a "codes" array on that constraint; keep the note for context
- Section headings in the raw text ("Biology courses:", "Cognate courses:") → split into separate sections
- "Culminating experience" in parens → note field on that course
- "or equivalent" after a course → note "or equivalent"
- Only reference course codes actually mentioned in the text (including bare numbers with prefix prepended)
- Do NOT hallucinate courses
- If something cannot be codified, use {"type": "custom", "text": "..."}

Output JSON for the sections array only (no wrapper).
```
