// Keyboard activation for non-interactive elements that handle clicks (spans
// and divs that can't become real buttons because of nesting — calendar
// blocks, offering rows, pills). Enter and Space both trigger the click
// handler, matching button semantics. The elements keep `tabindex="0"` in the
// template so they join the tab order.

export function onKeyActivate(e, handler) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  handler(e)
}
