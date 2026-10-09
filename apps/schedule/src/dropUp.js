// Decides whether an anchored dropdown should flip above its input. The
// instructor comboboxes live inside a scrollable modal body (or the table's
// clip container); a list anchored below an input near the bottom gets clipped,
// which is how the browser's native autofill ends up as the only visible menu.
// Measuring against the nearest clipping ancestor (falling back to the
// viewport) lets the dropdown open upward when that's where the room is.

// The nearest ancestor that clips its content (overflow-y not `visible`), or
// the viewport when there is none. Only that box's top/bottom matter.
function clipBox(el) {
  let node = el.parentElement
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
      return node.getBoundingClientRect()
    }
    node = node.parentElement
  }
  return { top: 0, bottom: window.innerHeight }
}

/**
 * Whether a dropdown anchored below `el` should instead open above it: when the
 * room below inside `el`'s clipping ancestor is too small for `minHeight` and
 * there is more room above than below. Safe to call with a missing element.
 * @param {HTMLElement | null | undefined} el
 * @param {number} [minHeight]
 * @returns {boolean}
 */
export function shouldDropUp(el, minHeight = 200) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false
  const rect = el.getBoundingClientRect()
  const box = clipBox(el)
  const below = box.bottom - rect.bottom
  const above = rect.top - box.top
  return below < minHeight && above > below
}
