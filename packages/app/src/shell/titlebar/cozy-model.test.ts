import { describe, expect, test } from "bun:test"
// oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- partial fixtures stand in for the session and project records the model only reads
import type { Project } from "@/runtime/server/types"
import type { ServerConnection } from "@/runtime/server/registry"
import type { InboxEntry, InboxStatus } from "./inbox-model"
import {
  bumpedRecent,
  cozyCleanPins,
  cozyDropAllowed,
  cozyMixPins,
  cozyPlacement,
  cozyProjectKey,
  cozyProjectOrder,
  orderRecent,
  pageSlice,
  rememberRecentRecency,
  reorderCozyPins,
  reorderProjectOrder,
  type CozyProjectInfo,
  type CozySession,
} from "./cozy-model"

const project = (id: string, worktree: string, created: number, vcs: string | "none" = "git") =>
  ({
    id,
    worktree,
    worktrees: [],
    canonical: worktree,
    vcs: vcs === "none" ? undefined : vcs,
    name: id,
    time: { created, updated: created, active: created },
    sandboxes: [],
  }) as unknown as Project

const entry = (
  id: string,
  updated: number,
  server = "sidecar",
  status: InboxStatus = "ready",
  recency: number | "updated" | "none" = "updated",
  created = updated,
) => {
  // An omitted recency models a prompt at `updated`; "none" models an older server row without one.
  let value: number | undefined

  if (recency === "updated") value = updated
  else if (recency !== "none") value = recency

  const time = { created, updated, recency: value }

  return {
    key: `${server}\u0000${id}`,
    server: server as ServerConnection.Key,
    session: {
      id,
      title: id,
      projectID: "p",
      time,
      location: { directory: "/p" },
    },
    status,
    since: updated,
  } as unknown as InboxEntry
}

const info = (projectValue: Project): CozyProjectInfo => ({
  key: cozyProjectKey("sidecar" as ServerConnection.Key, projectValue.worktree),
  conn: {} as ServerConnection.Any,
  server: "sidecar" as ServerConnection.Key,
  project: projectValue,
})

const identity = (value: InboxEntry) => value.key

describe("cozyProjectOrder", () => {
  test("puts new projects first and keeps saved order", () => {
    const projects = [project("old", "C:/old", 1), project("new", "C:/new", 9), project("saved", "C:/saved", 4)]
    expect(cozyProjectOrder(projects, ["C:/saved", "C:/old"]).map((item) => item.id)).toEqual(["new", "saved", "old"])
  })
})

describe("cozyPlacement", () => {
  const defaultProject = project("default", "C:/default", 1, undefined)
  const other = project("other", "C:/other", 2)
  const projects = [info(defaultProject), info(other)]
  const entries = [entry("d1", 10), entry("d2", 20), entry("o1", 15), entry("o2", 5)]
  const resolve = (value: InboxEntry) => (value.session.id.startsWith("d") ? info(defaultProject).key : info(other).key)

  test("puts every unpinned session in both recent and its project, newest first", () => {
    const view = cozyPlacement({
      entries,
      projects,
      resolveProject: resolve,
      sessionKey: identity,
      pinnedSessions: new Set(),
      pinnedProjects: new Set(),
      pinnedOrder: [],
    })

    expect(view.recent.map((item) => item.entry.session.id)).toEqual(["d2", "o1", "d1", "o2"])
    const byKey = new Map(view.projects.flatMap((partition) => partition.items).map((item) => [item.key, item]))
    expect(byKey.get(info(defaultProject).key)?.sessions.map((item) => item.entry.session.id)).toEqual(["d2", "d1"])
    expect(byKey.get(info(other).key)?.sessions.map((item) => item.entry.session.id)).toEqual(["o1", "o2"])
  })

  test("a pinned project owns its sessions and leaves Recent; a pinned session leaves its project", () => {
    const view = cozyPlacement({
      entries,
      projects,
      resolveProject: resolve,
      sessionKey: identity,
      pinnedSessions: new Set(["sidecar\u0000o1"]),
      pinnedProjects: new Set([info(other).key]),
      pinnedOrder: [
        { kind: "session", key: "sidecar\u0000o1" },
        { kind: "project", key: info(other).key },
      ],
    })

    expect(view.pinned.map((item) => item.kind)).toEqual(["session", "project"])
    expect(view.pinned[1]).toMatchObject({
      kind: "project",
      project: { sessions: [{ entry: { session: { id: "o2" } } }] },
    })
    expect(view.recent.map((item) => item.entry.session.id)).toEqual(["d2", "d1"])
  })

  test("unknown project IDs are not placed anywhere", () => {
    const view = cozyPlacement({
      entries: [entry("unknown", 1)],
      projects,
      resolveProject: () => undefined,
      sessionKey: identity,
      pinnedSessions: new Set(),
      pinnedProjects: new Set(),
      pinnedOrder: [],
    })

    expect(view.recent).toHaveLength(0)
    expect(view.projects.flatMap((item) => item.items).flatMap((item) => item.sessions)).toHaveLength(0)
  })
})

describe("orderRecent", () => {
  const session = (
    id: string,
    recency: number | undefined,
    updated = recency ?? 0,
    created = recency ?? updated,
  ): CozySession => ({
    key: `sidecar\u0000${id}`,
    entry: entry(id, updated, "sidecar", "ready", recency === undefined ? "none" : recency, created),
    pinned: false,
  })

  const sessions = (): CozySession[] => [session("a", 30), session("b", 20), session("c", 10)]
  const ids = (items: readonly CozySession[]) => items.map((item) => item.entry.session.id)

  test("keeps the stored order and appends a late-loaded row", () => {
    expect(ids(orderRecent(sessions(), ["sidecar\u0000c", "sidecar\u0000a"]))).toEqual(["c", "a", "b"])
  })

  test("a new row newer than every stored row goes to the top", () => {
    expect(ids(orderRecent([...sessions(), session("d", 40)], ["sidecar\u0000c", "sidecar\u0000a"]))).toEqual([
      "d",
      "c",
      "a",
      "b",
    ])
  })

  test("a stored order wins over recency", () => {
    expect(ids(orderRecent(sessions(), ["sidecar\u0000a", "sidecar\u0000b", "sidecar\u0000c"]))).toEqual([
      "a",
      "b",
      "c",
    ])
  })

  test("an empty stored order sorts by recency", () => {
    expect(ids(orderRecent(sessions(), []))).toEqual(["a", "b", "c"])
  })

  test("stored keys that are no longer present are skipped", () => {
    expect(
      ids(orderRecent(sessions(), ["sidecar\u0000missing", "sidecar\u0000c", "sidecar\u0000a"])),
    ).toEqual(["c", "a", "b"])
  })

  test("a duplicate key keeps the first occurrence", () => {
    const items = [session("a", 30), session("b", 20), session("b", 99)]

    expect(ids(orderRecent(items, []))).toEqual(["a", "b"])
    expect(ids(orderRecent(items, ["sidecar\u0000b"]))).toEqual(["a", "b"])
    expect(orderRecent(items, ["sidecar\u0000b"])[1]?.entry.session.time.recency).toBe(20)
  })

  test("a row without recency orders by creation, not updated", () => {
    const legacy = session("legacy", undefined, 900, 1)

    expect(ids(orderRecent([session("a", 30), legacy, session("c", 10)], []))).toEqual(["a", "c", "legacy"])
  })

  test("a tie with the newest stored row appends", () => {
    expect(ids(orderRecent([...sessions(), session("d", 30)], ["sidecar\u0000c", "sidecar\u0000a"]))).toEqual([
      "c",
      "a",
      "d",
      "b",
    ])
  })
})

describe("bumpedRecent", () => {
  test("returns known sessions whose recency advanced, newest first", () => {
    const known = new Set(["sidecar\u0000a", "sidecar\u0000b", "sidecar\u0000c"])

    const seen = new Map([
      ["sidecar\u0000a", 10],
      ["sidecar\u0000b", 20],
      ["sidecar\u0000c", 5],
    ])

    expect(
      bumpedRecent(known, seen, [
        { key: "sidecar\u0000a", recency: 30 },
        { key: "sidecar\u0000b", recency: 40 },
        { key: "sidecar\u0000c", recency: 6 },
      ]),
    ).toEqual(["sidecar\u0000b", "sidecar\u0000a", "sidecar\u0000c"])
  })

  test("a new row is never bumped", () => {
    const known = new Set(["sidecar\u0000a"])
    const seen = new Map([["sidecar\u0000a", 10]])

    expect(
      bumpedRecent(known, seen, [
        { key: "sidecar\u0000a", recency: 10 },
        { key: "sidecar\u0000new", recency: 999 },
      ]),
    ).toEqual([])
  })

  test("activity-only rows without a real recency never move", () => {
    const known = new Set(["sidecar\u0000a"])
    const seen = new Map<string, number>()

    expect(bumpedRecent(known, seen, [{ key: "sidecar\u0000a", recency: undefined }])).toEqual([])
  })
})

describe("rememberRecentRecency", () => {
  test("keeps the highest recency seen", () => {
    const seen = new Map([["sidecar\u0000a", 100]])

    rememberRecentRecency(seen, [{ key: "sidecar\u0000a", recency: 50 }])
    expect(seen.get("sidecar\u0000a")).toBe(100)
    expect(bumpedRecent(new Set(["sidecar\u0000a"]), seen, [{ key: "sidecar\u0000a", recency: 100 }])).toEqual([])

    rememberRecentRecency(seen, [{ key: "sidecar\u0000a", recency: 150 }])
    expect(seen.get("sidecar\u0000a")).toBe(150)
  })
})

describe("cozy pins", () => {
  test("cleans stale session slots, keeps project slots, and appends new sessions", () => {
    const stored = ["s:sidecar\u0000a", "p:sidecar\u0000C:/p", "s:sidecar\u0000b"]
    const cleaned = cozyCleanPins({ ready: true, stored, sessions: ["sidecar\u0000b"] })

    expect(cleaned).toEqual(["p:sidecar\u0000C:/p", "s:sidecar\u0000b"])
    expect(
      cozyMixPins({
        stored: cleaned!,
        pinnedProjects: new Set(["sidecar\u0000C:/p"]),
        sessions: ["sidecar\u0000b", "sidecar\u0000c"],
      }),
    ).toEqual(["p:sidecar\u0000C:/p", "s:sidecar\u0000b", "s:sidecar\u0000c"])
  })

  test("does not clean before pins are ready", () => {
    expect(cozyCleanPins({ ready: false, stored: ["s:sidecar\u0000a"], sessions: [] })).toBeUndefined()
  })

  test("reorders only when the visible set matches", () => {
    expect(reorderCozyPins(["a", "b", "c"], ["a", "b"], ["b", "a"])).toEqual(["b", "a", "c"])
    expect(reorderCozyPins(["a", "b"], ["a", "b"], ["a"])).toEqual(["a", "b"])
    expect(reorderProjectOrder(["a", "b"], ["a", "b"], ["b", "a"])).toEqual(["b", "a"])
  })

  test("reorders project and session rows together", () => {
    const base = ["p:sidecar\u0000C:/p", "s:sidecar\u0000a", "s:sidecar\u0000b"]

    expect(reorderCozyPins(base, base, ["s:sidecar\u0000b", "p:sidecar\u0000C:/p", "s:sidecar\u0000a"])).toEqual([
      "s:sidecar\u0000b",
      "p:sidecar\u0000C:/p",
      "s:sidecar\u0000a",
    ])
    expect(reorderCozyPins(base, base, ["s:sidecar\u0000a", "s:sidecar\u0000b", "p:sidecar\u0000C:/p"])).toEqual([
      "s:sidecar\u0000a",
      "s:sidecar\u0000b",
      "p:sidecar\u0000C:/p",
    ])
  })

  test("pairs sessions in pin order while keeping project slots in place", () => {
    expect(
      cozyMixPins({
        stored: ["p:sidecar\u0000C:/p", "s:sidecar\u0000c", "s:sidecar\u0000a"],
        pinnedProjects: new Set(["sidecar\u0000C:/p"]),
        sessions: ["sidecar\u0000a", "sidecar\u0000b", "sidecar\u0000c"],
      }),
    ).toEqual(["p:sidecar\u0000C:/p", "s:sidecar\u0000a", "s:sidecar\u0000b", "s:sidecar\u0000c"])
  })
})

describe("cozyDropAllowed", () => {
  const session = (projectKey: string | undefined) => ({
    kind: "session" as const,
    key: "sidecar\u0000A",
    server: "sidecar",
    sessionID: "A",
    projectKey,
    recency: 1,
  })

  const project = {
    kind: "project" as const,
    key: "sidecar\u0000C:/p",
    server: "sidecar",
    worktree: "C:/p",
  }

  test("accepts the four cross-group pin moves and same-group reorder", () => {
    const allowed = (source: ReturnType<typeof session> | typeof project, from: string, to: string) =>
      cozyDropAllowed({
        source,
        from,
        to,
        pinnedProjects: new Set<string>(),
        projectKeys: new Set(["sidecar\u0000C:/p"]),
      })

    expect(allowed(session("sidecar\u0000C:/p"), "recent", "pinned")).toBe(true)
    expect(allowed(session("sidecar\u0000C:/p"), "pinned", "recent")).toBe(true)
    expect(allowed(project, "projects:sidecar", "pinned")).toBe(true)
    expect(allowed(project, "pinned", "projects:sidecar")).toBe(true)
    expect(allowed(session("sidecar\u0000C:/p"), "recent", "recent")).toBe(true)
    expect(allowed(project, "projects:sidecar", "projects:sidecar")).toBe(true)
  })

  test("rejects an invisible landing place", () => {
    const allowed = (source: ReturnType<typeof session> | typeof project, from: string, to: string, pinned = false) =>
      cozyDropAllowed({
        source,
        from,
        to,
        pinnedProjects: new Set(pinned ? ["sidecar\u0000C:/p"] : []),
        projectKeys: new Set(["sidecar\u0000C:/p"]),
      })

    expect(allowed(session("sidecar\u0000C:/p"), "pinned", "recent", true)).toBe(false)
    expect(allowed(session(undefined), "pinned", "recent")).toBe(false)
    expect(allowed(session("sidecar\u0000C:/p"), "recent", "projects:sidecar")).toBe(false)
    expect(allowed(project, "projects:sidecar", "recent")).toBe(false)
    expect(allowed(project, "pinned", "projects:other")).toBe(false)
    expect(allowed(project, "projects:sidecar", "projects:other")).toBe(false)
  })
})

describe("pageSlice", () => {
  test("reports the 10/20 boundaries", () => {
    expect(
      pageSlice(
        Array.from({ length: 10 }, (_, index) => index),
        10,
      ),
    ).toMatchObject({ less: false, more: false })
    expect(
      pageSlice(
        Array.from({ length: 12 }, (_, index) => index),
        10,
      ),
    ).toMatchObject({ less: false, more: true })
    expect(
      pageSlice(
        Array.from({ length: 12 }, (_, index) => index),
        20,
      ),
    ).toMatchObject({ less: true, more: false })
    expect(
      pageSlice(
        Array.from({ length: 21 }, (_, index) => index),
        10,
      ),
    ).toMatchObject({ less: false, more: true })
  })
})
