// Hand-authored type projection of the catalog data contract.
//
// The JSON Schemas in `schemas/` are the data-validation artifact (CI runs
// them over the emitted JSON in `validate:catalog`); these types are the
// code-facing projection consumers compile against. They are kept honest by
// `test/types.witness.ts`, which assigns the real emitted documents through
// the types under `npm run typecheck` — if the two projections drift, that
// check fails. When the contract changes, edit BOTH the schema and these
// types; the witness + `validate:catalog` are the tripwires.
//
// NOTE: these model the vocabulary in `REQUIREMENTS_SCHEMA.md` and the
// current emitted data, not every schema keyword (e.g. the course-code
// `pattern` is enforced by the schema / the pipeline's own checks).

/** A course code like `BIO 161` (or an alias/range in requirement text). */
export type CourseCode = string

// ---- majors.json ------------------------------------------------------------

export interface CatalogCourse {
  course_code: string
  course_name: string
  description?: string
  prerequisites?: string[]
  credit_hours?: number
  program?: string
  alt_description?: string
}

/** `majors.json.requirements`: raw requirement text per plan. */
export interface ProgramRequirementText {
  label: string
  text: string
}

export interface Program {
  id: string
  name: string
  type: string[]
  faculty?: string[]
  description?: string
  course_prefix?: string
  course_count?: number
  requirements?: Record<string, ProgramRequirementText>
  courses: CatalogCourse[]
}

export interface SourceDiscrepancy {
  code: string
  program: string
  program_description?: string
  search_description?: string
}

export interface PresenceDiscrepancy {
  code: string
  side: string
  program?: string
  title?: string
}

export interface MajorsDoc {
  catalog_year: string
  generated_at?: string
  source_url?: string
  total_programs: number
  total_courses: number
  source_discrepancies?: SourceDiscrepancy[]
  presence_discrepancies?: PresenceDiscrepancy[]
  catalog: Record<string, CatalogCourse>
  programs: Program[]
}

// ---- requirements_parsed.json ------------------------------------------------

/**
 * A structured requirement node. The union is discriminated on `type`;
 * `any_of` models its codes-or-items exclusivity as two branches (the schema's
 * `oneOf`) rather than optional fields, so "exactly one" survives in the type.
 */
export type RequirementItem =
  | { type: 'course'; code: string; note?: string }
  | { type: 'any_of'; codes: CourseCode[]; note?: string }
  | { type: 'any_of'; items: RequirementItem[]; note?: string }
  | { type: 'each_of'; items: RequirementItem[]; note?: string }
  | { type: 'some_of'; items: RequirementItem[]; min?: number; max?: number; note?: string }
  | { type: 'electives'; count: number; label?: string; note?: string; constraints?: Constraint[] }
  | { type: 'custom'; text: string }

/** A filter a candidate course either passes or fails (see REQUIREMENTS_SCHEMA.md). */
export type Constraint =
  | { type: 'level'; level: number; atLeast?: number; atMost?: number; orAbove?: boolean }
  | { type: 'level'; min: number; max: number; atLeast?: number; atMost?: number; orAbove?: boolean }
  | {
      type: 'discipline'
      prefixes?: string[]
      atLeast?: number
      atMost?: number
      distinctAtLeast?: number
      sameDiscipline?: boolean
    }
  | { type: 'from'; codes?: CourseCode[]; note?: string }
  | { type: 'exclude'; codes: CourseCode[]; atLeast?: number; atMost?: number }
  | { type: 'max_from'; codes: CourseCode[]; atLeast?: number; atMost?: number; note?: string }
  | { type: 'min_from'; codes: CourseCode[]; atLeast?: number; atMost?: number; note?: string }
  | { type: 'note'; text?: string }

export interface RequirementSection {
  heading: string
  items: RequirementItem[]
  total?: number
}

export interface ProgramRequirement {
  label: string
  sections: RequirementSection[]
}

export interface RequirementsProgram {
  id: string
  name: string
  requirements: ProgramRequirement[]
}

export interface RequirementsDoc {
  schema_version: string
  generated_at?: string
  source?: string
  programs: RequirementsProgram[]
}

// ---- core_requirements.json ---------------------------------------------------

/** A core (CCR/ACE) area; unlike program requirements it carries an `id`. */
export interface CoreRequirement {
  id: string
  label: string
  rule?: string
  courses?: CourseCode[]
  sections: RequirementSection[]
}

export interface CoreProgram {
  id: string
  name: string
  requirements: CoreRequirement[]
}

export interface CoreRequirementsDoc {
  schema_version: string
  source?: string
  programs: CoreProgram[]
}