import type { SessionInfo } from "@opencode/client/promise"

/** Ordering key: the last user prompt, falling back to the last activity for rows written by older servers. */
export const sessionRecency = (session: SessionInfo) =>
  session.time.recency ?? session.time.updated ?? session.time.created

/** Display key: the last real activity (user, AI, tool, shell, compaction, run end, revert). */
export const sessionActivity = (session: SessionInfo) => session.time.updated ?? session.time.created
