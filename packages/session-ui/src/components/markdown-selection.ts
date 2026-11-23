/** Whether the current selection covers any part of `element`, so a click or menu must not hijack it. */
export function selectionTouches(element: Element) {
  const selection = window.getSelection()

  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false

  return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).some((range) =>
    range.intersectsNode(element),
  )
}
