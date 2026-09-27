# The views at a glance

The tabs **Grid**, **Table**, **Course conflicts**, and **Instructor** are
always one click away, and they always bring you back to the top level of each
view. The term buttons (**Fall**, **Winter**, **Spring**) apply to whichever
view you are in.

## Grid — the whole week

The default view: five columns, one per weekday, with a time ruler down the
left. Each class meeting is a colored block in its day and time. Click a block
to open it and see the courses inside, then **View slot** for the full list at
that time.

::: tip
The days are labelled **M T W R F**. **R stands for Thursday** — a registrar
shorthand. Thursday is not "T"; Tuesday is.
:::

## Day — one day in detail

Click a day name at the top of a column (for example **M Monday**) to get that
full day on a vertical timeline, with **←** and **→** to step through the week.
Every meeting for that day appears, including unusual times.

<Shot file="schedule-day.png" />

## Slot — everything at one time

Click **View slot** on a block, or the time label in the day view, to see a list
of everything meeting at that exact day and time — useful for comparing sections
side by side.

## Table — one row per offering

Every offering of the selected schedules' term as a compact, spreadsheet-like
row: course and section, title, instructor, meeting, seats, core areas, and the
schedule it came from. **Departments** and **Instructors** chips hide everything
that does not match — pick several chips to widen, **Clear** to reset. The
Instructors row starts collapsed (expand it from its header); you can collapse a
row again even with chips selected — the header then shows how many are selected
— and each row's chips are one uniform width so long names don't make the list
ragged. The choice lives
in the address (`#/table?dept=CS&dept=MAT&instructor=jsmith`), so clicking a
course link and coming back (or the browser Back button) keeps the filters. When
you start editing (or suggesting), the cells you are allowed
to change become editable in place: the instructor cell suggests names as you
type (and shows just the lead, with a **+N** when co-teachers are attached —
the full editor manages those), and the meeting cell picks from the term's
standard time slots (with a **Custom…** field when a course meets at another
time). Enter or click away commits a cell, Esc cancels. The row's pencil opens
the full [course editor](/guide/schedule/edit-course) for labs and
cross-listing, and **＋ Add course** adds a section. Rows from the other selected
schedules are dimmed as references, just like in the Grid.

<Shot file="schedule-table.png" />

## Course conflicts — follow one course

Pick a course and see all of its sections (each with its seat count and, for a
special-topics section, its own title) and
everything they collide with. See
[Checking for conflicts](/guide/schedule/conflicts).

## Instructor — follow one teacher

Pick a teacher to see their week and any double-bookings. See
[Checking for conflicts](/guide/schedule/conflicts).

<Shot file="schedule-instructor.png" />

## Filtering what stands out

On the **Grid**, **Day**, and **Slot** views, the **Departments** and
**Instructors** buttons open a row of chips. Click chips to pick departments or
teachers; matching classes are highlighted and colored, and everything else is
dimmed. **Clear** resets it. (The **Table** view has its own **Department**
selector instead.)

::: tip
Filters make matching classes stand out — they do not remove the others from
view. If a class looks faded, it simply does not match the current filter.
:::
