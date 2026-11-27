import type { SessionInfo } from "@opencode/client/promise"

/**
 * Ordering key: the last user prompt. Rows written by older servers have no recency; order those by creation so
 * activity from the AI can never move them.
 */
export const sessionRecency = (session: SessionInfo) => session.time.recency ?? session.time.created

/** Display key: the last real activity (user, AI, tool, shell, compaction, run end, revert). */
export const sessionActivity = (session: SessionInfo) => session.time.updated ?? session.time.created

/** The newer of two optional server timestamps; undefined never wins over a value. */
export function newerTime(a: number | undefined, b: number | undefined) {
  if (a === undefined) return b

  if (b === undefined) return a

  return Math.max(a, b)
}
