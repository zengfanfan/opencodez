import { afterEach, describe, expect, test } from "bun:test"
import type { WebContents } from "electron"
import {
  applyTaskbarBadge,
  claimTaskbarBadgeMount,
  decideTaskbarBadge,
  isOverlaySize,
  resetTaskbarBadge,
  TASKBAR_DESCRIPTION_MAX,
  TASKBAR_ICON_MAX,
  taskbarBadgeDecoded,
  taskbarBadgeImage,
  taskbarBadgeUpdate,
  truncateTaskbarDescription,
  type TaskbarBadgeImage,
  type TaskbarBadgeRequest,
  type TaskbarBadgeWindow,
} from "./taskbar-badge"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

const image = (width = 32, height = width, empty = false): TaskbarBadgeImage => ({
  isEmpty: () => empty,
  getSize: () => ({ width, height }),
})

const request = (overrides: Partial<TaskbarBadgeRequest> = {}): TaskbarBadgeRequest => ({
  count: 3,
  icon: "data:image/png;base64,abc",
  description: "3 unread sessions",
  mount: 2,
  sequence: 1,
  ...overrides,
})

const fakeWindow = (destroyed = false) => {
  const calls: Array<{ image: unknown; description: string }> = []

  const window: TaskbarBadgeWindow = {
    isDestroyed: () => destroyed,
    setOverlayIcon: (value, description) => calls.push({ image: value, description }),
  }

  return { calls, window }
}

// SAFETY: the fake is only used as a WeakMap key; no WebContents method is called.
const fakeContents = () => ({}) as WebContents

describe("taskbar badge update", () => {
  test("decodes a fresh request and clears for zero or an overlong icon", () => {
    expect(taskbarBadgeUpdate(undefined, request())).toMatchObject({ kind: "decode", state: { mount: 2, sequence: 1 } })
    expect(taskbarBadgeUpdate(undefined, request({ count: 0 }))).toMatchObject({ kind: "clear" })
    expect(taskbarBadgeUpdate(undefined, request({ icon: "x".repeat(TASKBAR_ICON_MAX + 1) }))).toMatchObject({
      kind: "clear",
    })
  })

  test("rejects invalid mount and sequence values", () => {
    for (const mount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(taskbarBadgeUpdate(undefined, request({ mount }))).toEqual({ kind: "ignore" })
    }

    for (const sequence of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(taskbarBadgeUpdate(undefined, request({ sequence }))).toEqual({ kind: "ignore" })
    }
  })

  test("accepts higher sequences on the same mount and a higher mount; rejects equal or lower", () => {
    const previous = { mount: 2, sequence: 5 }

    expect(taskbarBadgeUpdate(previous, request({ sequence: 6 }))).toMatchObject({ kind: "decode" })
    expect(taskbarBadgeUpdate(previous, request({ sequence: 5 }))).toEqual({ kind: "ignore" })
    expect(taskbarBadgeUpdate(previous, request({ sequence: 4 }))).toEqual({ kind: "ignore" })
    expect(taskbarBadgeUpdate(previous, request({ mount: 3, sequence: 1 }))).toMatchObject({ kind: "decode" })
    expect(taskbarBadgeUpdate(previous, request({ mount: 1, sequence: 99 }))).toEqual({ kind: "ignore" })
  })

  test("truncates a long description without splitting surrogate pairs", () => {
    expect(truncateTaskbarDescription("a".repeat(TASKBAR_DESCRIPTION_MAX + 1))).toHaveLength(TASKBAR_DESCRIPTION_MAX)
    expect(truncateTaskbarDescription("a".repeat(TASKBAR_DESCRIPTION_MAX - 1) + "😀")).toBe(
      "a".repeat(TASKBAR_DESCRIPTION_MAX - 1) + "😀",
    )
    expect(taskbarBadgeUpdate(undefined, request({ description: "d".repeat(300) }))).toMatchObject({
      kind: "decode",
      description: "d".repeat(TASKBAR_DESCRIPTION_MAX),
    })
  })
})

describe("taskbar badge image decisions", () => {
  test("accepts only 16x16 and 32x32 images", () => {
    expect(isOverlaySize({ width: 16, height: 16 })).toBe(true)
    expect(isOverlaySize({ width: 32, height: 32 })).toBe(true)
    expect(isOverlaySize({ width: 16, height: 32 })).toBe(false)
    expect(isOverlaySize({ width: 64, height: 64 })).toBe(false)
    expect(isOverlaySize({ width: 0, height: 0 })).toBe(false)
  })

  test("clears for null, undefined, empty, wrong-sized or throwing images", () => {
    expect(taskbarBadgeImage(null, "x")).toEqual({ kind: "clear" })
    expect(taskbarBadgeImage(undefined, "x")).toEqual({ kind: "clear" })
    expect(taskbarBadgeImage(image(32, 32, true), "x")).toEqual({ kind: "clear" })
    expect(taskbarBadgeImage(image(64), "x")).toEqual({ kind: "clear" })
    expect(
      taskbarBadgeImage(
        {
          isEmpty: () => false,
          getSize: () => {
            throw new Error("size")
          },
        },
        "x",
      ),
    ).toEqual({ kind: "clear" })
    expect(taskbarBadgeImage(image(32), "x")).toMatchObject({ kind: "set", description: "x" })
  })

  test("clears when the decoder throws or returns an invalid image", () => {
    expect(
      taskbarBadgeDecoded("icon", "x", () => {
        throw new Error("decode")
      }),
    ).toEqual({ kind: "clear" })
    expect(taskbarBadgeDecoded("icon", "x", () => image(64))).toEqual({ kind: "clear" })
    expect(taskbarBadgeDecoded("icon", "x", () => image(32))).toMatchObject({ kind: "set" })
  })
})

describe("taskbar badge window ordering", () => {
  test("claims a monotonic mount id per window", () => {
    const a = {}
    const b = {}

    expect(claimTaskbarBadgeMount(a)).toBe(1)
    expect(claimTaskbarBadgeMount(a)).toBe(2)
    expect(claimTaskbarBadgeMount(b)).toBe(1)
  })

  test("stores state only for accepted updates", () => {
    const contents = fakeContents()

    expect(decideTaskbarBadge(contents, request({ mount: 1, sequence: 1 }))).toMatchObject({ kind: "decode" })
    expect(decideTaskbarBadge(contents, request({ mount: 1, sequence: 1 }))).toEqual({ kind: "ignore" })
    expect(decideTaskbarBadge(contents, request({ mount: 1, sequence: 2 }))).toMatchObject({ kind: "decode" })
    expect(decideTaskbarBadge(contents, request({ mount: 2, sequence: 1 }))).toMatchObject({ kind: "decode" })
  })

  test("navigation resets to a barrier and rejects the old mount", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const contents = fakeContents()
    const { calls, window } = fakeWindow()
    const first = claimTaskbarBadgeMount(contents)

    expect(decideTaskbarBadge(contents, request({ mount: first, sequence: 4 }))).toMatchObject({ kind: "decode" })
    resetTaskbarBadge(contents, window)

    expect(calls).toEqual([{ image: null, description: "" }])
    expect(decideTaskbarBadge(contents, request({ mount: first, sequence: 99 }))).toEqual({ kind: "ignore" })

    const next = claimTaskbarBadgeMount(contents)

    expect(next).toBe(3)
    expect(decideTaskbarBadge(contents, request({ mount: next, sequence: 1 }))).toMatchObject({ kind: "decode" })
  })

  test("a late old claim only consumes an id and does not clear or reset", () => {
    Object.defineProperty(process, "platform", { value: "win32" })
    const contents = fakeContents()
    const { calls, window } = fakeWindow()

    const first = claimTaskbarBadgeMount(contents)
    expect(decideTaskbarBadge(contents, request({ mount: first, sequence: 1 }))).toMatchObject({ kind: "decode" })

    const late = claimTaskbarBadgeMount(contents)

    expect(late).toBe(first + 1)
    expect(calls).toEqual([])
    expect(decideTaskbarBadge(contents, request({ mount: first, sequence: 2 }))).toMatchObject({ kind: "decode" })
  })

  test("apply clears, sets, and skips destroyed, missing or non-Windows windows", () => {
    const { calls, window } = fakeWindow()

    Object.defineProperty(process, "platform", { value: "darwin" })
    applyTaskbarBadge(window, { kind: "clear" })
    expect(calls).toEqual([])

    Object.defineProperty(process, "platform", { value: "win32" })
    applyTaskbarBadge(null, { kind: "clear" })
    applyTaskbarBadge(undefined, { kind: "clear" })
    applyTaskbarBadge(fakeWindow(true).window, { kind: "clear" })
    expect(calls).toEqual([])

    applyTaskbarBadge(window, { kind: "clear" })
    const badgeImage = image(32)
    applyTaskbarBadge(window, { kind: "set", image: badgeImage, description: "badge" })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual({ image: null, description: "" })
    expect(calls[1]?.image).toBe(badgeImage)
    expect(calls[1]?.description).toBe("badge")
  })
})
