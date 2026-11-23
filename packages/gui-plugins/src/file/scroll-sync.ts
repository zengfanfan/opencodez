import { createSignal, onCleanup, untrack } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createKeyed } from "@opencode/plugin/gui"
import {
  FILE_SCROLL_INTERACTED,
  FILE_SCROLL_RESTORE_REQUESTED,
  FILE_SCROLL_REVEAL_REQUESTED,
  canRestoreFileScroll,
  canSaveFileScroll,
  createFileScrollState,
  sameFileScrollContext,
  transitionFileScroll,
  type FileScrollContext,
  type FileScrollEffect,
  type FileScrollEvent,
  type FileScrollPos,
} from "./scroll-machine"

/** The code view's scroll element and the animation frame that restores or stores its scroll. */
type ScrollTarget = { element?: HTMLDivElement; frame?: number }

/**
 * The code columns a diff scrolls beside its viewport. Plain document previews have none, so they scroll the viewport
 * alone.
 */
type ScrollCode = {
  elements: (viewport: HTMLDivElement) => HTMLElement[]
}

export function createScrollSync(input: {
  context: () => Omit<FileScrollContext, "scroller">
  get: () => FileScrollPos | undefined
  write: (sessionKey: string, scrollKey: string, position: FileScrollPos) => void
  code?: ScrollCode
}) {
  const scroller: ScrollTarget = {}
  const [hasScroller, setHasScroller] = createSignal(false)
  const [code, setCode] = createSignal<HTMLElement[]>([])
  const [scrollState, setScrollState] = createSignal(createFileScrollState())

  const dispatch = (event: FileScrollEvent) => {
    const next = transitionFileScroll(untrack(scrollState), event)

    setScrollState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: FileScrollEffect) => {
    if (effect.type === "save.write") return input.write(effect.sessionKey, effect.scrollKey, effect.position)

    if (scroller.frame !== undefined) cancelAnimationFrame(scroller.frame)
    scroller.frame = undefined

    if (effect.type === "frame.cancel") return
    const attempt = effect.attempt

    if (effect.type === "frame.save") {
      scroller.frame = requestAnimationFrame(() => {
        scroller.frame = undefined
        dispatch({ type: "save.stepped", attempt })
      })

      return
    }

    scroller.frame = requestAnimationFrame(() => {
      scroller.frame = undefined

      if (canRestoreFileScroll(untrack(scrollState), attempt)) restore()
      dispatch({ type: "restore.stepped", attempt })
    })
  }

  const interacted = () => dispatch(FILE_SCROLL_INTERACTED)

  const getCode = () => {
    const el = scroller.element

    if (!el) return []

    return input.code?.elements(el) ?? []
  }

  const onCodeScroll = (event: Event) => {
    const el = scroller.element

    if (!el || !canSaveFileScroll(untrack(scrollState))) return

    const target = event.currentTarget

    if (!(target instanceof HTMLElement)) return

    dispatch({ type: "scrolled", position: { x: target.scrollLeft, y: el.scrollTop } })
  }

  const sync = () => {
    const next = getCode()
    const current = code()

    if (next.length === current.length && next.every((el, i) => el === current[i])) return
    setCode(next)
  }

  const restore = () => {
    const el = scroller.element

    if (!el || el.clientHeight === 0 || el.clientWidth === 0) return

    const pos = input.get()

    if (!pos) return

    sync()

    if (code().length > 0) {
      for (const item of code()) {
        if (item.scrollLeft !== pos.x) item.scrollLeft = pos.x
      }
    }

    if (el.scrollTop !== pos.y) el.scrollTop = pos.y

    if (code().length > 0) return

    if (el.scrollLeft !== pos.x) el.scrollLeft = pos.x
  }

  // Scroll events a restore or a layout clamp fires arrive while restoring and are not the user's to store.
  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    if (!canSaveFileScroll(untrack(scrollState))) return

    if (code().length === 0) sync()

    dispatch({
      type: "scrolled",
      position: { x: code()[0]?.scrollLeft ?? event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop },
    })
  }

  // The diff's code columns scroll on their own; listen to the ones on screen.
  createKeyed(code, (items) => items.forEach((item) => makeEventListener(item, "scroll", onCodeScroll)))

  createKeyed(
    () => ({ ...input.context(), scroller: hasScroller() }),
    (context) => dispatch({ type: "context.synced", context }),
    { equals: sameFileScrollContext },
  )

  // The ref runs before the file renders into the element; the machine restores a frame after the mount.
  const setViewport = (el: HTMLDivElement) => {
    scroller.element = el
    // Input, not the scroll events a restore or a layout change fires, hands the view to the user.
    makeEventListener(el, "wheel", interacted, { passive: true, capture: true })
    makeEventListener(el, "mousewheel", interacted, { passive: true, capture: true })
    makeEventListener(el, "pointerdown", interacted, { passive: true, capture: true })
    makeEventListener(el, "touchstart", interacted, { passive: true, capture: true })
    makeEventListener(el, "keydown", interacted, { capture: true })
    setHasScroller(true)
    onCleanup(() => {
      if (scroller.element !== el) return
      scroller.element = undefined
      setCode([])
      setHasScroller(false)
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    handleScroll,
    interacted,
    requestRestore: () => dispatch(FILE_SCROLL_RESTORE_REQUESTED),
    reveal: () => dispatch(FILE_SCROLL_REVEAL_REQUESTED),
    setViewport,
  }
}
