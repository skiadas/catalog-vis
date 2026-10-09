// Geometry for an anchored dropdown that escapes a clipping ancestor. The
// instructor comboboxes and the course picker live inside scroll/clip boxes
// (the table's `overflow-x` wrapper, the editor modal body), where an
// absolutely-positioned list gets cropped to that box. Pinning the list with
// `position: fixed` and placing it from the anchor's viewport rect keeps it
// fully visible regardless of the ancestors.

/**
 * The inline style that pins a dropdown to `anchorRect` within `viewportRect`.
 * Opens below the anchor, or above it when the room below is too small for
 * `minHeight` and there is more room above. `left`/`width` follow the anchor so
 * the list lines up with its input (a class may impose a larger min-width).
 *
 * @param {{ left: number, top: number, right: number, bottom: number, width: number }} anchorRect
 * @param {{ top: number, right: number, bottom: number }} viewportRect
 * @param {{ gap?: number, minHeight?: number }} [options]
 * @returns {Record<string, string>}
 */
export function dropdownStyle(anchorRect, viewportRect, { gap = 4, minHeight = 200 } = {}) {
  const below = viewportRect.bottom - anchorRect.bottom
  const above = anchorRect.top - viewportRect.top
  const openUp = below < minHeight && above > below
  const style = {
    left: `${anchorRect.left}px`,
    width: `${anchorRect.width}px`,
  }
  if (openUp) style.bottom = `${viewportRect.bottom - anchorRect.top + gap}px`
  else style.top = `${anchorRect.bottom + gap}px`
  return style
}
