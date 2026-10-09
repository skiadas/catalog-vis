// Keeps an anchored dropdown (see `anchoredDropdown.js`) pinned to its input
// while it is open. Recomputes against the viewport on open and whenever the
// page or the input's own scroll container scrolls, so the list does not drift
// away from the anchor — and, because it is fixed-positioned, never gets
// clipped to the anchor's overflow ancestor.

import { onBeforeUnmount, ref, watch } from 'vue'
import { dropdownStyle } from './anchoredDropdown.js'

const viewportRect = () => ({
  top: 0,
  right: window.innerWidth,
  bottom: window.innerHeight,
})

/**
 * @param {() => HTMLElement | null | undefined} getAnchorEl
 * @param {import('vue').Ref<boolean>} isOpen
 * @param {{ gap?: number, minHeight?: number }} [options]
 * @returns {{ style: import('vue').Ref<Record<string, string> | null> }}
 */
export function useAnchoredDropdown(getAnchorEl, isOpen, options) {
  const style = ref(null)
  const reposition = () => {
    const el = getAnchorEl()
    if (!el || typeof el.getBoundingClientRect !== 'function') return
    style.value = dropdownStyle(el.getBoundingClientRect(), viewportRect(), options)
  }
  const listen = () => {
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    requestAnimationFrame(reposition)
  }
  const unlisten = () => {
    window.removeEventListener('scroll', reposition, true)
    window.removeEventListener('resize', reposition)
  }

  watch(isOpen, (open) => (open ? listen() : unlisten()))
  onBeforeUnmount(unlisten)

  return { style }
}
