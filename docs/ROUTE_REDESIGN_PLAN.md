# UX redesign — modal → route plan

Status: **in progress** — phases 1 (manage → `#/schedules`), 2 (access →
`#/schedule/<id>/access`), and 3 (mode → `?mode=edit|suggest&id=<id>`) have
shipped; phase 4 remains. The docs-site plan is paused behind this.

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
| Suggested changes panel | `SuggestedChanges.vue` | referential | `#/schedule/<id>/proposals` |
| Course editor | `ScheduleCourseEdit.vue` | referential, needs grid context | overlay route `#/schedule/<id>/course/<code>/edit` |
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
4. **`#/schedule/<id>/proposals`** and the **course editor** as overlay routes.

Order is by value; each step is independently shippable.

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

Routing is one lever on "overwhelming". Worth examining in the same redesign
pass: the nested dialog stack (manage → create/access), the per-row mode menu
plus the edit bar, and whether some controls can be demoted, merged, or moved
behind the routes above. (To be scoped when the redesign starts.)

## Open questions

- ~~Manage as a **full page** vs an **overlay route**.~~ **Decided: full page.**
  The rule that falls out of it: a navigational hub is a page; a surface that
  operates on the grid's content is an overlay route.
- Is mode (edit/suggest) part of the first slice, or a second round? (Lean:
  second round — it adds a second source of truth with the store's
  `editingId`/`editingRole`, so it wants its own guard work.)
- How much of the broader "simplify" work happens alongside routing vs after.
