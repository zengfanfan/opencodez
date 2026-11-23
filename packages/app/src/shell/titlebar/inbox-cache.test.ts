import { describe, expect, test } from "bun:test"
// oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- partial fixtures stand in for session records the cache only passes through
import type { SessionInfo } from "@opencode/client/promise"
import {
  applyArchiveFacts,
  archivedSessionQueryKey,
  markSessionArchived,
  markSessionDeleted,
  markSessionRestored,
  prependSession,
  removeSession,
  sessionIndexKeys,
  sessionQueryKey,
} from "./inbox-cache"

const session = (id: string, archived?: number) => ({ id, time: { archived } }) as unknown as SessionInfo

describe("session index keys", () => {
  test("Cozy reads Home's query instead of a second activity index", () => {
    const conn = "server"
    expect(sessionQueryKey("home", conn)).toEqual(["home-sessions", conn])
    expect(sessionQueryKey("inbox", conn)).toEqual(["inbox-sessions", conn])
    expect(archivedSessionQueryKey(conn)).toEqual(["inbox-archived-sessions", conn])
    expect(sessionIndexKeys(conn)).toEqual([
      ["home-sessions", conn],
      ["inbox-sessions", conn],
      ["inbox-archived-sessions", conn],
    ])
  })
})

describe("applyArchiveFacts", () => {
  test("hides a deleted session and keeps an archived timestamp over stale data", () => {
    markSessionDeleted("facts-server", "ses_deleted")
    markSessionArchived("facts-server", "ses_archived", 42)

    const rows = applyArchiveFacts("facts-server", [
      session("ses_live"),
      session("ses_deleted"),
      session("ses_archived"),
    ])

    expect(rows.map((row) => row.id)).toEqual(["ses_live", "ses_archived"])
    expect(rows[1]?.time.archived).toBe(42)
  })

  test("clears an archived timestamp after the server restores the session", () => {
    markSessionArchived("restore-server", "ses_restored", 7)
    markSessionRestored("restore-server", "ses_restored")

    expect(applyArchiveFacts("restore-server", [session("ses_restored", 7)])[0]?.time.archived).toBeUndefined()
  })

  test("leaves unrelated server facts alone", () => {
    markSessionDeleted("server-a", "ses_same")
    expect(applyArchiveFacts("server-b", [session("ses_same")])).toHaveLength(1)
  })
})

describe("cached index helpers", () => {
  test("removes one row and prepends a replacement without duplicating it", () => {
    expect(removeSession([session("a"), session("b")], "a").map((row) => row.id)).toEqual(["b"])
    expect(prependSession([session("a"), session("b")], session("b")).map((row) => row.id)).toEqual(["b", "a"])
  })
})
