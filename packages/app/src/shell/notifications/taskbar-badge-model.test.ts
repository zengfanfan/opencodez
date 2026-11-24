import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { Platform } from "@/runtime/platform/platform"
import { isSessionUnread } from "./machine"
import {
  badgeLabel,
  claimTaskbarBadgeWithRetry,
  patchTaskbarIndex,
  sendTaskbarBadge,
  taskbarBadgeEnabled,
  taskbarBadgeNeedsSync,
  taskbarBadgeQueryPlan,
  taskbarBadgeSummary,
  type TaskbarBadgeIndexEvent,
} from "./taskbar-badge-model"

const web: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
}

const desktop = (os: "windows" | "macos" | "linux", options?: { set?: boolean; claim?: boolean }): Platform => {
  const platform: Platform = {
    platform: "desktop",
    os,
    windowID: "window",
    openDirectoryPickerDialog: async () => null,
    openExternal() {},
    restart: async () => {},
    notify: async () => {},
  }

  if (options?.set !== false) platform.setTaskbarBadge = async () => {}

  if (options?.claim !== false) platform.claimTaskbarBadgeMount = async () => 1

  return platform
}

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

const envelope = {
  id: "evt",
  created: 50,
  durable: { aggregateID: "ses_a", seq: 1, version: 1 as const },
}

const event = <Type extends TaskbarBadgeIndexEvent["type"]>(
  type: Type,
  data: Extract<TaskbarBadgeIndexEvent, { type: Type }>["data"],
) =>
  // SAFETY: the fixture pairs each event type with its real payload shape; no wire data is parsed here.
  ({ ...envelope, type, data }) as Extract<TaskbarBadgeIndexEvent, { type: Type }>

describe("taskbar badge model", () => {
  test("labels 1-9 and caps at 9+", () => {
    expect([0, 1, 9, 10, 50].map(badgeLabel)).toEqual(["0", "1", "9", "9+", "9+"])
  })

  test("is enabled only on Windows with both platform methods", () => {
    expect(taskbarBadgeEnabled(web)).toBe(false)
    expect(taskbarBadgeEnabled(desktop("macos"))).toBe(false)
    expect(taskbarBadgeEnabled(desktop("linux"))).toBe(false)
    expect(taskbarBadgeEnabled(desktop("windows"))).toBe(true)
    expect(taskbarBadgeEnabled(desktop("windows", { set: false }))).toBe(false)
    expect(taskbarBadgeEnabled(desktop("windows", { claim: false }))).toBe(false)
  })

  test("query plan is empty on unsupported platforms", () => {
    expect(taskbarBadgeQueryPlan(web, ["a"])).toEqual([])
    expect(taskbarBadgeQueryPlan(desktop("windows"), ["a"])).toEqual(["a"])
  })

  test("summary is exact when no fetched index is full", () => {
    expect(taskbarBadgeSummary([{ count: 25, capped: false }, { count: 25, capped: false }])).toEqual({
      count: 50,
      atLeast: false,
    })
    expect(taskbarBadgeSummary([{ count: 50, capped: false }])).toEqual({ count: 50, atLeast: false })
    expect(taskbarBadgeSummary([{ count: 50, capped: true }, { count: 25, capped: false }])).toEqual({
      count: 75,
      atLeast: true,
    })
    expect(taskbarBadgeSummary([])).toEqual({ count: 0, atLeast: false })
    expect(taskbarBadgeSummary([{ count: 0, capped: false }])).toEqual({ count: 0, atLeast: false })
  })
})

describe("taskbar badge claim", () => {
  test("returns the first successful claim", async () => {
    let calls = 0

    const mount = await claimTaskbarBadgeWithRetry(async () => {
      calls++

      return 7
    }, new AbortController().signal)

    expect(mount).toBe(7)
    expect(calls).toBe(1)
  })

  test("retries once and returns the second claim", async () => {
    let calls = 0

    const mount = await claimTaskbarBadgeWithRetry(async () => {
      calls++

      if (calls === 1) throw new Error("first")

      return 9
    }, new AbortController().signal)

    expect(mount).toBe(9)
    expect(calls).toBe(2)
  })

  test("returns undefined after both attempts fail", async () => {
    let calls = 0

    const mount = await claimTaskbarBadgeWithRetry(async () => {
      calls++
      throw new Error("nope")
    }, new AbortController().signal)

    expect(mount).toBeUndefined()
    expect(calls).toBe(2)
  })

  test("returns undefined when the outer signal aborts while the claim is pending", async () => {
    const controller = new AbortController()

    const mount = claimTaskbarBadgeWithRetry(
      (signal) =>
        new Promise<number>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
      controller.signal,
    )

    controller.abort()

    expect(await mount).toBeUndefined()
  })

  test("does not claim when the signal is already aborted", async () => {
    let calls = 0
    const controller = new AbortController()
    controller.abort()

    const mount = await claimTaskbarBadgeWithRetry(async () => {
      calls++

      return 1
    }, controller.signal)

    expect(mount).toBeUndefined()
    expect(calls).toBe(0)
  })
})

describe("taskbar badge send", () => {
  test("does nothing on an unsupported platform", async () => {
    let drawn = 0
    let sent = 0

    const platform: Platform = {
      ...web,
      setTaskbarBadge: async () => {
        sent++
      },
    }

    await sendTaskbarBadge(platform, { mount: 1, sequence: 1 }, 3, "3 unread", () => {
      drawn++

      return [{ scaleFactor: 1, dataUrl: "icon" }]
    })

    expect(drawn).toBe(0)
    expect(sent).toBe(0)
  })

  test("skips a stale attempt before drawing", async () => {
    let drawn = 0
    let sent = 0

    const platform: Platform = {
      ...desktop("windows"),
      setTaskbarBadge: async () => {
        sent++
      },
    }

    await sendTaskbarBadge(platform, { mount: 1, sequence: 1 }, 3, "3 unread", () => {
      drawn++

      return [{ scaleFactor: 1, dataUrl: "icon" }]
    }, () => false)

    expect(drawn).toBe(0)
    expect(sent).toBe(0)
  })

  test("sends a clear for count 0", async () => {
    const sent: unknown[] = []

    const platform: Platform = {
      ...desktop("windows"),
      setTaskbarBadge: async (update) => {
        sent.push(update)
      },
    }

    await sendTaskbarBadge(platform, { mount: 2, sequence: 3 }, 0, "", () => [])

    expect(sent).toEqual([{ mount: 2, sequence: 3, count: 0, icons: [], description: "" }])
  })

  test("draws and sends the current count", async () => {
    const sent: unknown[] = []

    const platform: Platform = {
      ...desktop("windows"),
      setTaskbarBadge: async (update) => {
        sent.push(update)
      },
    }

    await sendTaskbarBadge(platform, { mount: 2, sequence: 3 }, 4, "4 unread", () => [
      { scaleFactor: 1, dataUrl: "icon" },
    ])

    expect(sent).toEqual([
      { mount: 2, sequence: 3, count: 4, icons: [{ scaleFactor: 1, dataUrl: "icon" }], description: "4 unread" },
    ])
  })

  test("clears with a fresh sequence when a current draw throws", async () => {
    const sent: unknown[] = []
    let allocated = 0

    const platform: Platform = {
      ...desktop("windows"),
      setTaskbarBadge: async (update) => {
        sent.push(update)
      },
    }

    await sendTaskbarBadge(
      platform,
      { mount: 2, sequence: 3 },
      4,
      "4 unread",
      () => {
        throw new Error("draw failed")
      },
      () => true,
      () => ({ mount: 2, sequence: ++allocated + 3 }),
    )

    expect(allocated).toBe(1)
    expect(sent).toEqual([{ mount: 2, sequence: 4, count: 0, icons: [], description: "" }])
  })

  test("does not clear when a stale attempt fails", async () => {
    let allocated = 0

    const platform: Platform = {
      ...desktop("windows"),
      setTaskbarBadge: async () => {
        throw new Error("rejected")
      },
    }

    await sendTaskbarBadge(platform, { mount: 2, sequence: 3 }, 4, "4 unread", () => [
      { scaleFactor: 1, dataUrl: "icon" },
    ], () => false, () => {
      allocated++

      return { mount: 2, sequence: 4 }
    })

    expect(allocated).toBe(0)
  })

  test("clears with a fresh sequence when the platform rejects a current update", async () => {
    const sent: unknown[] = []
    let calls = 0

    const platform: Platform = {
      ...desktop("windows"),
      setTaskbarBadge: async (update) => {
        calls++
        sent.push(update)

        if (calls === 1) throw new Error("rejected")
      },
    }

    await sendTaskbarBadge(platform, { mount: 2, sequence: 3 }, 4, "4 unread", () => [
      { scaleFactor: 1, dataUrl: "icon" },
    ], () => true, () => ({
      mount: 2,
      sequence: 4,
    }))

    expect(sent).toEqual([
      {
        mount: 2,
        sequence: 3,
        count: 4,
        icons: [{ scaleFactor: 1, dataUrl: "icon" }],
        description: "4 unread",
      },
      { mount: 2, sequence: 4, count: 0, icons: [], description: "" },
    ])
  })
})

describe("taskbar badge index", () => {
  test("needs a sync only when an unarchived row is absent and not loaded", () => {
    const other = session("other", { created: 1, updated: 1 })

    expect(taskbarBadgeNeedsSync(undefined, false, "target")).toBe(true)
    expect(taskbarBadgeNeedsSync([], false, "target")).toBe(true)
    expect(taskbarBadgeNeedsSync([other], false, "target")).toBe(true)
    expect(taskbarBadgeNeedsSync([other], true, "target")).toBe(false)
    expect(taskbarBadgeNeedsSync([session("target", { created: 1, updated: 1 })], false, "target")).toBe(false)
  })

  test("returns undefined for an undefined cache", () => {
    expect(patchTaskbarIndex(undefined, event("session.deleted", { sessionID: "a" }))).toBeUndefined()
    expect(patchTaskbarIndex(undefined, event("session.archived", { sessionID: "a" }))).toBeUndefined()
    expect(patchTaskbarIndex(undefined, event("session.unarchived", { sessionID: "a" }))).toBeUndefined()
    expect(patchTaskbarIndex(undefined, event("session.viewed", { sessionID: "a", idle: 2 }))).toBeUndefined()
  })

  test("applies deleted, archived, unarchived and viewed events", () => {
    const row = session("a", { created: 1, updated: 2 })

    expect(patchTaskbarIndex([row], event("session.deleted", { sessionID: "a" }))).toEqual([])
    expect(patchTaskbarIndex([row], event("session.archived", { sessionID: "a" }))?.[0]?.time.archived).toBe(50)
    expect(
      patchTaskbarIndex([{ ...row, time: { ...row.time, archived: 40 } }], event("session.unarchived", { sessionID: "a" }))?.[0]
        ?.time.archived,
    ).toBeUndefined()
    expect(patchTaskbarIndex([row], event("session.viewed", { sessionID: "a", idle: 7 }))?.[0]?.time.viewed).toBe(7)
  })

  test("the first view writes the idle watermark instead of NaN", () => {
    const row = session("a", { created: 1, updated: 2 })
    const patched = patchTaskbarIndex([row], event("session.viewed", { sessionID: "a", idle: 10 }))![0]!
    const read = { ...patched, time: { ...patched.time, idle: 10 } }

    expect(patched.time.viewed).toBe(10)
    expect(Number.isNaN(patched.time.viewed)).toBe(false)
    expect(isSessionUnread(read)).toBe(false)
    expect(isSessionUnread({ ...patched, time: { ...patched.time, idle: 20 } })).toBe(true)
  })

  test("a later view clears unread and a backward idle never moves the watermark", () => {
    const row = session("a", { created: 1, updated: 2, idle: 20 })
    const viewed = patchTaskbarIndex([row], event("session.viewed", { sessionID: "a", idle: 25 }))![0]!
    const backward = patchTaskbarIndex([viewed], event("session.viewed", { sessionID: "a", idle: 5 }))![0]!

    expect(viewed.time.viewed).toBe(25)
    expect(isSessionUnread({ ...viewed, time: { ...viewed.time, idle: 25 } })).toBe(false)
    expect(backward.time.viewed).toBe(25)
  })

  test("leaves other rows untouched", () => {
    const other = session("other", { created: 1, updated: 1 })
    const patched = patchTaskbarIndex([other], event("session.deleted", { sessionID: "missing" }))!

    expect(patched).toEqual([other])
  })
})
