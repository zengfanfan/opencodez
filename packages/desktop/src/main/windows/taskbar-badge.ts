import type { NativeImage, WebContents } from "electron"

/** Electron always rasterizes the Windows overlay at this size; see `drawBadge` in the app. */
export const TASKBAR_ICON_SIZE = 16

/** A 16x16 PNG data URL is a few KB; cap the string so a client cannot send an unbounded payload. */
export const TASKBAR_ICON_MAX = 100_000

/** Accessibility descriptions are short; truncate rather than reject a badge because of a long translation. */
export const TASKBAR_DESCRIPTION_MAX = 200

export type TaskbarBadgeSequenceState = {
  readonly mount: number
  readonly sequence: number
}

export type TaskbarBadgeRequest = {
  readonly count: number
  readonly icon: string
  readonly description: string
  readonly mount: number
  readonly sequence: number
}

export type TaskbarBadgeUpdate =
  | { readonly kind: "ignore" }
  | { readonly kind: "clear"; readonly state: TaskbarBadgeSequenceState }
  | { readonly kind: "decode"; readonly state: TaskbarBadgeSequenceState; readonly description: string }

export type TaskbarBadgeImage = {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
}

export type TaskbarBadgeDecision =
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly image: TaskbarBadgeImage; readonly description: string }

export type TaskbarBadgeWindow = {
  isDestroyed(): boolean
  setOverlayIcon(image: NativeImage | null, description: string): void
}

const mounts = new WeakMap<WebContents, number>()

const sequences = new WeakMap<WebContents, TaskbarBadgeSequenceState>()

/** The handler's whole validation and ordering decision; stores state only for an accepted update. */
export function taskbarBadgeUpdate(
  previous: TaskbarBadgeSequenceState | undefined,
  request: TaskbarBadgeRequest,
): TaskbarBadgeUpdate {
  if (!Number.isSafeInteger(request.mount) || request.mount <= 0) return { kind: "ignore" }

  if (!Number.isSafeInteger(request.sequence) || request.sequence < 0) return { kind: "ignore" }

  if (previous) {
    if (request.mount < previous.mount) return { kind: "ignore" }

    if (request.mount === previous.mount && request.sequence <= previous.sequence) return { kind: "ignore" }
  }

  const state = { mount: request.mount, sequence: request.sequence }

  if (request.count <= 0) return { kind: "clear", state }

  if (!validIcon(request.icon)) return { kind: "clear", state }

  return { kind: "decode", state, description: truncateTaskbarDescription(request.description) }
}

export function truncateTaskbarDescription(description: string) {
  return Array.from(description).slice(0, TASKBAR_DESCRIPTION_MAX).join("")
}

/** Electron draws the overlay at a fixed 16x16, so any other bitmap size would just be rescaled. */
export function isTaskbarBadgeIconSize(size: { readonly width: number; readonly height: number }) {
  return size.width === TASKBAR_ICON_SIZE && size.height === TASKBAR_ICON_SIZE
}

/** A decoder that throws, or an empty or wrong-sized bitmap, always clears rather than leaving a stale badge. */
export function taskbarBadgeDecoded(
  icon: string,
  description: string,
  decode: (dataUrl: string) => TaskbarBadgeImage | null | undefined,
): TaskbarBadgeDecision {
  try {
    const image = decode(icon)

    if (!image || image.isEmpty() || !isTaskbarBadgeIconSize(image.getSize())) return { kind: "clear" }

    return { kind: "set", image, description }
  } catch {
    return { kind: "clear" }
  }
}

function validIcon(icon: string) {
  return icon.length > 0 && icon.length <= TASKBAR_ICON_MAX
}

/** Issues the next mount id for a window. Non-destructive: a late claim cannot clear or reset a newer badge. */
export function claimTaskbarBadgeMount(contents: WebContents) {
  const next = (mounts.get(contents) ?? 0) + 1
  mounts.set(contents, next)

  return next
}

/** Clears the overlay on navigation and reserves a barrier so updates from the old document are rejected. */
export function resetTaskbarBadge(contents: WebContents, window: TaskbarBadgeWindow | null) {
  const barrier = claimTaskbarBadgeMount(contents)
  sequences.set(contents, { mount: barrier, sequence: 0 })
  applyTaskbarBadge(window, { kind: "clear" })
}

/** Gets, decides and stores the window's sequence state; the only non-pure part of the handler. */
export function decideTaskbarBadge(contents: WebContents, request: TaskbarBadgeRequest) {
  const update = taskbarBadgeUpdate(sequences.get(contents), request)

  if (update.kind !== "ignore") sequences.set(contents, update.state)

  return update
}

export function applyTaskbarBadge(window: TaskbarBadgeWindow | null | undefined, decision: TaskbarBadgeDecision) {
  if (process.platform !== "win32" || !window || window.isDestroyed()) return

  if (decision.kind === "clear") {
    window.setOverlayIcon(null, "")

    return
  }

  // SAFETY: the handler passes a NativeImage; tests use a structural stand-in for the same call.
  window.setOverlayIcon(decision.image as NativeImage, decision.description)
}
