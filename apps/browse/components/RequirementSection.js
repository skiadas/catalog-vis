import { computed } from 'vue'

export default {
  name: 'RequirementSection',
  props: {
    section: { type: Object, required: true },
  },
  setup(props) {
    const groupedItems = computed(() => {
      const items = props.section && props.section.items
      if (!items) return []
      const result = []
      let currentGroup = null
      for (const item of items) {
        if (item.type === 'course') {
          if (!currentGroup) {
            currentGroup = { type: 'course_group', courses: [] }
            result.push(currentGroup)
          }
          currentGroup.courses.push(item)
        } else {
          currentGroup = null
          result.push(item)
        }
      }
      return result
    })

    return { groupedItems }
  },
  template: `
    <div class="req-section">
      <div v-if="section.heading" class="req-section-heading">{{ section.heading }}</div>
      <div class="req-items">
        <div v-for="(item, idx) in groupedItems" :key="idx" class="req-item">
          <RequirementItem :item="item" />
        </div>
      </div>
    </div>
  `,
}
