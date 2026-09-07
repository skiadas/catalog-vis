// Shared modal focus management for the schedule dialogs. Moves focus into the
// dialog while it's open, traps Tab inside it, closes on Escape, and restores
// focus to the element that had it before the dialog opened — so keyboard and
// screen-reader users can't tab into the page behind a dialog.
//
// `isOpen` may be any watchable (a ref, or a getter over props); `dialogRef` is
// the ref bound to the dialog element itself (not the overlay). Only one
// consumer should be open at a time; if two dialogs can overlap (the manage
// list and the create form it opens), gate each with mutually exclusive
// conditions.

import { onBeforeUnmount, watch } from 'vue'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useModalFocus(isOpen, dialogRef, onClose) {
  let lastFocused = null

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab') return
    const el = dialogRef.value
    if (!el || !el.contains(document.activeElement)) return
    const items = Array.from(el.querySelectorAll(FOCUSABLE))
    if (!items.length) {
      e.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const detach = () => {
    document.removeEventListener('keydown', onKeydown, true)
  }

  // The dialog element is often `v-if`'d by the same condition, so focus is
  // moved after the next paint has rendered it. Never steals focus that is
  // already inside the dialog (e.g. the course editor's own refocus while the
  // mount animation frame is still pending).
  const moveFocusIn = () => {
    const el = dialogRef.value
    if (!el) return
    if (el.contains(document.activeElement)) return
    const first = el.querySelector(FOCUSABLE)
    if (first) first.focus()
    else el.focus()
  }

  const handler = (open) => {
    if (open) {
      lastFocused = document.activeElement
      document.addEventListener('keydown', onKeydown, true)
      requestAnimationFrame(moveFocusIn)
    } else {
      detach()
      if (lastFocused && lastFocused.focus) lastFocused.focus()
    }
  }

  // Immediate: dialogs mounted already-open (the course editor) attach their
  // trap at mount, not on the first open/close toggle.
  const stop = watch(isOpen, handler, { immediate: true })

  onBeforeUnmount(() => {
    stop()
    detach()
    if (isOpen.value) {
      if (lastFocused && lastFocused.focus) lastFocused.focus()
    }
  })
}
