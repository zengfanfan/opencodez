import type { SessionInfo } from "@opencode/client/promise"
import { createSignal } from "solid-js"

export type SessionIndexMode = "inbox" | "home"

/** The live activity index each layout reads. Cozy reuses Home's query instead of fetching a second one. */
export function sessionQueryKey(mode: SessionIndexMode, conn: unknown) {
  return [mode === "home" ? "home-sessions" : "inbox-sessions", conn] as const
}

export function archivedSessionQueryKey(conn: unknown) {
  return ["inbox-archived-sessions", conn] as const
}

/** Every cached session index an archive, restore, or delete must invalidate for one connection. */
export function sessionIndexKeys(
  conn: unknown,
): ReadonlyArray<readonly ["home-sessions" | "inbox-sessions" | "inbox-archived-sessions", unknown]> {
  return [
    ["home-sessions", conn],
    ["inbox-sessions", conn],
    ["inbox-archived-sessions", conn],
  ]
}

/** A stale index read must not put an archived or deleted session back on screen. */
type ArchiveFact = number | "restored" | "deleted"

const [archiveFacts, setArchiveFacts] = createSignal<Record<string, ArchiveFact>>({})

const factKey = (server: string, sessionID: string) => `${server}\u0000${sessionID}`

const writeFact = (key: string, fact: ArchiveFact) => setArchiveFacts((current) => ({ ...current, [key]: fact }))

export function markSessionArchived(server: string, sessionID: string, at = Date.now()) {
  writeFact(factKey(server, sessionID), at)
}

export function markSessionRestored(server: string, sessionID: string) {
  writeFact(factKey(server, sessionID), "restored")
}

export function markSessionDeleted(server: string, sessionID: string) {
  writeFact(factKey(server, sessionID), "deleted")
}

export function sessionArchivedAt(server: string, sessionID: string) {
  const fact = archiveFacts()[factKey(server, sessionID)]

  return typeof fact === "number" ? fact : undefined
}

export function sessionDeleted(server: string, sessionID: string) {
  return archiveFacts()[factKey(server, sessionID)] === "deleted"
}

/** Applies the latest observed state over a server or cached index. */
export function applyArchiveFacts(server: string, sessions: readonly SessionInfo[]) {
  const facts = archiveFacts()

  return sessions.flatMap((session) => {
    const fact = facts[factKey(server, session.id)]

    if (fact === "deleted") return []
    if (fact === "restored") {
      if (session.time.archived === undefined) return [session]

      return [{ ...session, time: { ...session.time, archived: undefined } }]
    }

    if (typeof fact === "number") {
      if (session.time.archived === fact) return [session]

      return [{ ...session, time: { ...session.time, archived: fact } }]
    }

    return [session]
  })
}

export function removeSession(sessions: readonly SessionInfo[], sessionID: string) {
  return sessions.filter((session) => session.id !== sessionID)
}

export function prependSession(sessions: readonly SessionInfo[], session: SessionInfo) {
  return [session, ...sessions.filter((item) => item.id !== session.id)]
}
