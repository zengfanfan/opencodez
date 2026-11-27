import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { buildHomeSessionRecords, homeSessionLocation } from "./records"

const session = (id: string, directory: string, projectID: string) =>
  // SAFETY: the fixture supplies the session fields the record builder reads.
  ({
    id,
    projectID,
    title: id,
    location: { directory },
    time: { created: 1, updated: 1 },
  }) as SessionInfo

describe("buildHomeSessionRecords", () => {
  // SAFETY: the fixture supplies the project fields the record builder reads.
  const opened = { id: "project-a", worktree: "/repo/a" } as LocalProject
  const sessions = [session("a", "/repo/a", "project-a"), session("b", "/repo/b", "project-b")]

  test("includes sessions outside added projects when unfiltered", () => {
    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => undefined,
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["a", "b"])
    expect(records[1]?.project).toMatchObject({ id: "project-b", worktree: "/repo/b" })
  })

  test("filters sessions when a project is selected", () => {
    const records = buildHomeSessionRecords({
      sessions: () => sessions,
      projectDirectories: () => ["/repo/a"],
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["a"])
  })

  test("labels a worktree session with its project before that project's inventory has loaded", () => {
    const records = buildHomeSessionRecords({
      sessions: () => [session("w", "/repo/a/.worktrees/feature", "project-a")],
      projectDirectories: () => undefined,
      projects: () => [{ ...opened, name: "Project A" }],
    })

    expect(records[0]?.project).toMatchObject({ id: "project-a", worktree: "/repo/a" })
    expect(records[0]?.projectName).toBe("Project A")
  })

  test("prefers the added project whose directory matches over a sibling entry with the same ID", () => {
    // SAFETY: the fixture supplies the project fields the record builder reads.
    const nested = { id: "project-a", worktree: "/repo/a/packages/app" } as LocalProject

    const records = buildHomeSessionRecords({
      sessions: () => [session("n", "/repo/a/packages/app", "project-a")],
      projectDirectories: () => undefined,
      projects: () => [opened, nested],
    })

    expect(records[0]?.project.worktree).toBe("/repo/a/packages/app")
  })

  test("orders by the last user prompt and uses the id only to break equal recency", () => {
    const at = (id: string, time: { created: number; updated: number; recency?: number }) => ({
      ...session(id, "/repo/a", "project-a"),
      time,
    })

    const records = buildHomeSessionRecords({
      sessions: () => [
        at("ses_z", { created: 1, updated: 2, recency: 2 }),
        at("ses_old", { created: 1, updated: 1, recency: 1 }),
        at("ses_a", { created: 1, updated: 2, recency: 2 }),
      ],
      projectDirectories: () => undefined,
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["ses_a", "ses_z", "ses_old"])
  })

  test("does not order by update time when the server has no recency", () => {
    const at = (id: string, created: number, updated: number) => ({
      ...session(id, "/repo/a", "project-a"),
      time: { created, updated },
    })

    const records = buildHomeSessionRecords({
      sessions: () => [at("a", 1, 100), at("z", 2, 2)],
      projectDirectories: () => undefined,
      projects: () => [opened],
    })

    expect(records.map((record) => record.session.id)).toEqual(["z", "a"])
  })
})

test("homeSessionLocation returns the worktree directory name and branch when known", () => {
  expect(homeSessionLocation("/repo/.worktrees/crisp-cactus", "feature/home")).toEqual({
    worktree: "crisp-cactus",
    branch: "feature/home",
  })
  expect(homeSessionLocation("/repo/.worktrees/crisp-cactus")).toEqual({ worktree: "crisp-cactus", branch: undefined })
})
