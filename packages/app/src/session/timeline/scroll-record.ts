/** Where the reader left a timeline, before a route or panel switch detached it. */
export type ScrollRecord = {
  following: boolean
  offset: number
  presentationKey: string
}

export type ScrollRestore = { readonly type: "end" } | { readonly type: "offset"; readonly offset: number }

/** A record restores only when the reader had left the end and the layout still matches. */
export function selectScrollRestore(
  record: ScrollRecord | undefined,
  presentationKey: string,
): ScrollRestore {
  if (!record || record.presentationKey !== presentationKey || record.following) return { type: "end" }

  return { type: "offset", offset: record.offset }
}
