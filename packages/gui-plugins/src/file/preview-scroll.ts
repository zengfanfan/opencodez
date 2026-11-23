import type { MountedSession } from "@opencode/plugin/gui"
import type { FileScrollPos } from "./scroll-machine"
import { createScrollSync } from "./scroll-sync"

export type PreviewScrollOptions = {
  session: () => MountedSession
  scrollKey: string
  fileReady: () => boolean
  active: () => boolean
  layoutReady: () => boolean
  /** The rendered preview is the one on screen, not the source and not another hidden tab. */
  shown: () => boolean
  get: () => FileScrollPos | undefined
  write: (sessionKey: string, scrollKey: string, position: FileScrollPos) => void
}

/** Keeps a rendered document's scroll, using the same machine as the code view. */
export function createPreviewScroll(input: PreviewScrollOptions) {
  return createScrollSync({
    context: () => ({
      sessionKey: input.session().key,
      scrollKey: input.scrollKey,
      loaded: true,
      fileReady: input.fileReady(),
      layoutReady: input.layoutReady(),
      shown: input.shown(),
    }),
    get: input.get,
    write: input.write,
  })
}
