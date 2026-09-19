// Shared open/close state for the edit/suggest mode picker ("pencil menu").
// The picker appears both on the header pills and on the manage rows, so the
// two surfaces would otherwise duplicate this state and its outside-click
// handling. A document pointerdown outside any `.mode-menu-wrap` closes the
// menu (the picker's own controls stop propagation, like the CSV menu).

import { onBeforeUnmount, ref, watch } from 'vue'

export function useModeMenu() {
  const menuFor = ref(null)

  const toggle = (id) => {
    menuFor.value = menuFor.value === id ? null : id
  }
  const close = () => {
    menuFor.value = null
  }

  const onDocumentPointerdown = (e) => {
    if (!e.target.closest || !e.target.closest('.mode-menu-wrap')) close()
  }

  watch(menuFor, (open) => {
    if (typeof document === 'undefined') return
    if (open) document.addEventListener('pointerdown', onDocumentPointerdown)
    else document.removeEventListener('pointerdown', onDocumentPointerdown)
  })
  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') document.removeEventListener('pointerdown', onDocumentPointerdown)
  })

  return { menuFor, toggle, close }
}
