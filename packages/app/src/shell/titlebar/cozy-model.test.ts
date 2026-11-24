import { describe, expect, test } from "bun:test"
// oxlint-disable anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions -- partial fixtures stand in for the session and project records the model only reads
import type { Project } from "@/runtime/server/types"
import type { ServerConnection } from "@/runtime/server/registry"
import type { InboxEntry, InboxStatus } from "./inbox-model"
import {
  cozyCleanPins,
  cozyMixPins,
  cozyPlacement,
  cozyProjectKey,
  cozyProjectOrder,
  pageSlice,
  reorderCozyPins,
  reorderProjectOrder,
  type CozyProjectInfo,
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

const entry = (id: string, updated: number, server = "sidecar", status: InboxStatus = "ready") =>
  ({
    key: `${server}\u0000${id}`,
    server: server as ServerConnection.Key,
    session: {
      id,
      title: id,
      projectID: "p",
      time: { created: updated, updated },
      location: { directory: "/p" },
    },
    status,
    since: updated,
  }) as unknown as InboxEntry

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
