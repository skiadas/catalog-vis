// "How to use this page" help modal. Visibility via the `isOpen` prop.

export default {
  name: 'ScheduleHelp',
  props: {
    isOpen: { type: Boolean, default: false },
  },
  emits: ['close'],
  setup(props, { emit }) {
    return {
      props,
      close: () => emit('close'),
    }
  },
  template: `
    <div v-if="props.isOpen" class="modal-overlay" @click.self="close">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="schedule-help-title">
        <div class="modal-head">
          <h3 id="schedule-help-title">Using the Schedule page</h3>
          <button class="modal-close" @click="close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <p class="modal-intro">
            This is a made-up, illustrative schedule. Browse it by view with the tabs, and drill down by clicking.
            The <strong>Department</strong> / <strong>Instructor</strong> chips filter which offerings are highlighted.
          </p>

          <div class="help-section">
            <h4>Grid view</h4>
            <p>Shows the whole week as colored blocks. Switch between the <em>Departments</em> and <em>Instructors</em>
            filter modes, then click a chip to highlight matching offerings. Click a time block to open that day and
            slot, and click an individual course chip to jump to its conflicts.</p>
          </div>

          <div class="help-section">
            <h4>Day &amp; slot views</h4>
            <p>Click any offering (or time slot) in the grid to drill into a single day and then a specific slot.
            Each slot lists its offerings, color-coded if a filter is active.</p>
          </div>

          <div class="help-section">
            <h4>Course conflicts</h4>
            <p>Pick a course from the dropdown. It lists every scheduled section (days, time, instructor) and flags other
            courses whose times overlap, so you can see what would collide in a student schedule.</p>
          </div>

          <div class="help-section">
            <h4>Instructor view</h4>
            <p>Select an instructor to see their weekly timetable. Any double-bookings (two courses at the same time)
            are shown as alerts at the top.</p>
          </div>

          <div class="help-section">
            <h4>Tips</h4>
            <ul>
              <li>Use <strong>Clear</strong> to reset the active filter.</li>
              <li>The tabs (Grid / Course conflicts / Instructor) always return you to the top-level views.</li>
              <li>Everything here is a synthetic sample, not the real catalog.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `,
}
