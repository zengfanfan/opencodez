import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { INITIAL_LEGACY_MIGRATION_STATE, type LegacyMigrationState } from "./machine"
import { countUnreadSessions, isSessionUnreadHere, type UnreadState } from "./unread-count"

const done: LegacyMigrationState = { status: "done", reported: new Map() }

const session = (id: string, time: SessionInfo["time"], extra?: Partial<SessionInfo>): SessionInfo => ({
  id,
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time,
  title: id,
  location: { directory: "/project" },
  ...extra,
})

const state = (legacy: LegacyMigrationState = done, manuallyUnread: readonly string[] = []): UnreadState => ({
  manuallyUnread: new Set(manuallyUnread),
  legacy,
})

const count = (sessions: readonly SessionInfo[], input = state(), muted: readonly string[] = []) =>
  countUnreadSessions(sessions, input, (id) => muted.includes(id))

describe("unread session count", () => {
  test("counts a root whose latest run is newer than its viewed watermark", () => {
    expect(count([session("a", { created: 1, updated: 2, idle: 2 })])).toBe(1)
  })

  test("excludes a read root", () => {
    expect(count([session("a", { created: 1, updated: 2, idle: 2, viewed: 2 })])).toBe(0)
  })

  test("excludes children, archived and muted sessions", () => {
    const sessions = [
      session("child", { created: 1, updated: 2, idle: 2 }, { parentID: "root" }),
      session("archived", { created: 1, updated: 2, idle: 2, archived: 2 }),
      session("muted", { created: 1, updated: 2, idle: 2 }),
      session("counted", { created: 1, updated: 2, idle: 2 }),
    ]

    expect(count(sessions, state(), ["muted"])).toBe(1)
  })

  test("counts a manually unread session even when the server says it is read", () => {
    expect(
      count([session("a", { created: 1, updated: 2, idle: 2, viewed: 2 })], state(done, ["a"])),
    ).toBe(1)
  })

  test("does not count while the legacy list is still loading", () => {
    expect(count([session("a", { created: 1, updated: 2, idle: 2 })], state(INITIAL_LEGACY_MIGRATION_STATE))).toBe(0)
  })

  test("counts each session once when an index row and a live row repeat", () => {
    const row = session("a", { created: 1, updated: 2, idle: 2 })

    expect(count([row, { ...row }])).toBe(1)
  })

  test("sums independent root sessions", () => {
    expect(
      count([
        session("a", { created: 1, updated: 2, idle: 2 }),
        session("b", { created: 1, updated: 3, idle: 3 }),
        session("c", { created: 1, updated: 4, idle: 4, viewed: 4 }),
      ]),
    ).toBe(2)
  })

  test("isSessionUnreadHere matches the count predicate", () => {
    const row = session("a", { created: 1, updated: 2, idle: 2 })

    expect(isSessionUnreadHere(state(), row)).toBe(true)
    expect(isSessionUnreadHere(state(done, ["a"]), { ...row, time: { ...row.time, viewed: 2 } })).toBe(true)
  })
})
