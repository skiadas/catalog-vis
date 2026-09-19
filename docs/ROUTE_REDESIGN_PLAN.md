# UX redesign — modal → route plan

Status: **complete** — all four phases shipped (manage page, access overlay,
focused edit/suggest session, proposals + course editor overlays). The
docs-site plan can resume.

Motivation: the current schedule UX is overwhelming — nested dialogs, mode
toggles, and controls stacked on top of each other. Routing is one lever to
simplify it: stable, referential state should be a page/URL the user can link
to, bookmark, or close with the back button; only transient, contextual state
should stay modal.

This also unblocks the docs work (`docs/DOCS_SITE_PLAN.md`): most "state" shots
become a plain route, and the screenshot manifest keeps explicit steps only for
genuinely sequential walkthroughs.

## Principle

- **Route** when the state is stable and referential — “would a user want to
  link to this, or have the browser back button close it?”
- **Modal** when the state is transient or contextual — form drafts,
  history/undo context, boot prompts.
- **Local storage** for preferences (a toggle is not a location).
- Prefer **overlay routes**: the route renders the same dialog-styled UI over
  the grid (lightbox pattern), so context is preserved *and* the state is in
  the URL. This keeps the visual UX largely intact while making it navigable.

## Inventory (schedule app)

| Surface | Component | Nature | Proposal |
| --- | --- | --- | --- |
| Manage list (search, year filter, 3 sections) | `ScheduleManage.vue` | a page in dialog clothing | `#/schedules` (done — **full page**, not overlay) |
| Access dialog | `ScheduleAccess.vue` | stable, referential | `#/schedule/<id>/access` (done — overlay route) |
| Create form / CSV import | `ScheduleManage.vue` | transient form state | surface may route; form state stays component-local |
| Edit vs. suggest mode | store (`editingId`/`editingRole`) | stable, referential | `?mode=edit`/`?mode=suggest&id=<id>` (done — focused session) |
| Suggested changes panel | `SuggestedChanges.vue` | referential | `#/schedule/<id>/proposals` (done — overlay route) |
| Course editor | `ScheduleCourseEdit.vue` | referential, needs grid context | overlay route `#/schedule/<id>/course/<code>/edit` (done — with a section/lab switcher) |
| Add course | `ScheduleAddCourse.vue` | transient, contextual | keep modal (or fold into the editor) |
| History panel | `ScheduleHistory.vue` | session-local undo context | keep modal |
| Help | `ScheduleHelp.vue` | docs-ish | `#/help` (low priority) |
| Auth prompt / offline badge | `AuthPrompt.vue` | boot flow | keep as-is |

Existing routes (`apps/schedule/router.js`, hash history):
`/`, `/day/:day`, `/slot/:day/:time`, `/course/:code`, `/instructor/:instructor`,
`/admin`. View switches are already URL-addressable; the gap is everything
modal.

## Phasing

1. **Manage → `#/schedules`** (**done** — full page, not overlay). Removes the
   largest / most nested modal; create and access become nested surfaces
   beneath it. The page replaces the active sub-view (like `/admin`) rather
   than floating over it: managing schedules is a navigation hub, not a tool
   that operates on the grid, so grid context buys nothing and the page is
   simpler (no scrim, no focus trap, no mounted-while-closed state). Overlay
   routes are reserved for the context-dependent surfaces (access, mode,
   proposals, course editor) in the phases below.
2. **Access → `#/schedule/<id>/access`** (**done** — overlay route). The dialog
   moved out of `ScheduleManage.vue` into its own `ScheduleAccess.vue`; the
   shell renders it over the surface it was opened from (the manage page, or
   the grid on a deep link) and keeps that surface mounted, so context and
   instance state survive. First use of the shell's `meta.overlay` +
   underlay-memory mechanism, which phases 3–4 reuse. Non-owners reaching the
   URL directly get a denial state (the manage row button is owner-only).
3. **Mode into the URL** (**done** — `?mode=edit|suggest&id=<id>`, a **focused
   session** rather than a plain route). Mode is orthogonal to the view, so it
   rides in the query and every view route keeps its params — the session
   survives grid/day/slot switches and stays deep-linkable. Entering scopes the
   app to the session: the edited schedule is live, the other selected
   schedules are dimmed read-only **references** (the selection *is* the
   reference set, so an existing comparison carries straight into editing),
   the picker reduces to the pills, manage is unreachable, and leaving (Done,
   back, a header link) ends the session — with a discard confirm on an
   unsaved suggest draft. View navigation during a session replaces the entry,
   so back leaves the session rather than walking its view history.
4. **`#/schedule/<id>/proposals`** and the **course editor**
   (`#/schedule/<id>/course/<code>/edit`) as overlay routes (**done**).
   Overlays are **session-transparent**: they neither end nor are ended by the
   session, so the proposals panel keeps a suggest session's draft available and
   closing returns to the session view. The course editor route names the
   course (base code); its header switches between that course's sections and
   labs, remounting the form per section, and a switch with unsaved changes
   asks first (never a silent discard). A deep link to the editor implies
   editing: it auto-enters the session on the schedule (bouncing if the user
   may not edit). Entering the overlay from the store side (`courseEditTarget`)
   is what drives navigation, so every existing opener (grid pencils,
   add-course, history's Edit) works unchanged.

All four phases shipped; each step was independently shippable.

## Non-goals (stay as they are)

- Show-proposals toggle, schedule colors, year filter → preferences
  (`localStorage`), not URLs.
- Half-typed form input, CSV import in progress → never in URLs.
- Auth/offline boot flow.
- History panel (session-local).

## Risks

- `ScheduleManage.vue` is the most complex component (list + create + access).
  Route-ifying it was a real refactor with e2e churn; as a full page it now
  unmounts on leave, so the old mounted-while-closed `menuFor` reset watcher
  is gone (the leak it guarded against cannot happen).
- `docs/ARCHITECTURE.md` documents the deep-link URL contract — every new route
  extends that contract deliberately.
- Keep selection behavior (multi-select picker pills, persisted selection) as
  it is for now; this plan is about surfacing state, not reworking selection.

## Beyond routing

Routing was one lever on "overwhelming", and it is now spent. The remaining
simplification work is UI: the per-row mode menu became a **split button** (the
pencil starts the default mode; a chevron opens the picker for the other
choice) and the edit bar dropped its prose down to an Editing/Suggesting chip
plus a right-aligned action cluster. Still open: whether the course editor's
single-section form should become a true multi-section view (the switcher is the
interim; a per-section form extraction would be its own redesign). (To be
scoped separately.)

## Decisions (were open questions)

- **Manage is a full page** — the rule that fell out: a navigational hub is a
  page; a surface that operates on the grid's content is an overlay route.
- **Mode is a second round** — as expected, it carried the guard work (a
  second source of truth with `editingId`/`editingRole`); it landed as a
  focused session, not just a URL.
- **Broader simplification stays out of the routing pass** — the routes are the
  foundation; the visual/control cleanup is a separate effort.
