import type { SessionInfo } from "@opencode/client/promise"
import { selectSessionUnread, type LegacyMigrationState } from "./machine"

/** The two client-local inputs that decide whether a session shows an unread dot. */
export type UnreadState = {
  readonly manuallyUnread: ReadonlySet<string>
  readonly legacy: LegacyMigrationState
}

/** Whether the session shows unread here, matching the dot the app draws for it. */
export function isSessionUnreadHere(state: UnreadState, session?: Pick<SessionInfo, "id" | "time">) {
  return (!!session && state.manuallyUnread.has(session.id)) || selectSessionUnread(state.legacy, session)
}

/** Counts unread root sessions, excluding children, archived sessions, muted sessions and duplicates. */
export function countUnreadSessions(
  sessions: readonly SessionInfo[],
  state: UnreadState,
  isMuted: (sessionID: string) => boolean,
) {
  const seen = new Set<string>()
  let count = 0

  for (const session of sessions) {
    if (session.parentID || session.time.archived !== undefined || isMuted(session.id)) continue

    if (seen.has(session.id)) continue

    seen.add(session.id)

    if (isSessionUnreadHere(state, session)) count++
  }

  return count
}
