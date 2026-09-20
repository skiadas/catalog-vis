<script>
import { withBase } from 'vitepress'
import { entries } from '../../../screenshots/manifest.mjs'

export default {
  name: 'Shot',
  props: {
    file: { type: String, required: true },
    caption: { type: String, default: '' },
  },
  computed: {
    entry() {
      return entries.find((item) => item.file === this.file) || {}
    },
    src() {
      return withBase(`/screenshots/${this.file}`)
    },
    alt() {
      return this.entry.alt || this.file
    },
    text() {
      return this.caption || this.entry.caption || ''
    },
  },
}
</script>

<template>
  <figure class="shot">
    <img :src="src" :alt="alt" loading="lazy" />
    <figcaption v-if="text">{{ text }}</figcaption>
  </figure>
</template>

<style scoped>
.shot {
  margin: 1.5rem 0;
}

.shot img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.shot figcaption {
  margin-top: 0.5rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}
</style>
