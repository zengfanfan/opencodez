import type { MarkdownLocalFileMenu, OpenMarkdownLocalFile } from "../context/markdown"
import { selectionTouches } from "./markdown-selection"

/** The local file a click targets: a Markdown link or an inline-code path the host confirmed. */
type LocalLinkTarget = { path: string; element: HTMLElement }

function localLinkTarget(target: EventTarget | null): LocalLinkTarget | undefined {
  if (!(target instanceof Element)) return
  const link = target.closest<HTMLElement>("a[data-local-link]")

  if (link) {
    const path = link.dataset.localLink

    return path ? { path, element: link } : undefined
  }

  // Bare inline paths such as `src/app.ts` open like links when the host can resolve them.
  const code = target.closest<HTMLElement>(':not(pre) > code[data-inline-code-kind="path"]')

  if (!code || code.closest("a")) return
  const path = code.textContent?.trim()

  return path ? { path, element: code } : undefined
}

/**
 * Handles clicks and right-clicks on a Markdown root. The handlers read their callbacks on use, so a re-render that
 * replaces `open` or `menu` keeps working without re-registering the listeners.
 */
export function setupLocalLinks(
  root: HTMLElement,
  open: () => OpenMarkdownLocalFile | undefined,
  menu?: () => MarkdownLocalFileMenu | undefined,
) {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const target = localLinkTarget(event.target)

    if (!target || selectionTouches(target.element)) return
    const handler = open()

    if (!handler) return
    event.preventDefault()
    handler(target.path)
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.defaultPrevented) return

    if (!(event.target instanceof HTMLElement) || !event.target.matches("a[data-local-link]")) return
    const path = event.target.dataset.localLink
    const handler = open()

    if (!path || !handler) return
    event.preventDefault()
    handler(path)
  }

  const handleContextMenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return

    const target = localLinkTarget(event.target)
    const handler = menu?.()

    if (!target || !handler || selectionTouches(target.element)) return
    event.preventDefault()
    event.stopPropagation()
    handler({ path: target.path, x: event.clientX, y: event.clientY })
  }

  const handleMenuKey = (event: KeyboardEvent) => {
    if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return

    if (event.defaultPrevented) return

    const target = localLinkTarget(event.target)
    const handler = menu?.()

    if (!target || !handler) return
    const bounds = target.element.getBoundingClientRect()
    event.preventDefault()
    handler({ path: target.path, x: bounds.left, y: bounds.bottom })
  }

  root.addEventListener("click", handleClick)
  root.addEventListener("keydown", handleKeyDown)
  root.addEventListener("contextmenu", handleContextMenu)
  root.addEventListener("keydown", handleMenuKey)

  return () => {
    root.removeEventListener("click", handleClick)
    root.removeEventListener("keydown", handleKeyDown)
    root.removeEventListener("contextmenu", handleContextMenu)
    root.removeEventListener("keydown", handleMenuKey)
  }
}
