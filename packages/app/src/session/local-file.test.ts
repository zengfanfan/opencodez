import { describe, expect, test } from "bun:test"
import {
  absoluteLocalPath,
  displayedLocalPath,
  joinLocalPath,
  localFileActions,
  resolvableLocalPath,
  selectLocalFile,
} from "./local-file"

describe("local file paths", () => {
  test("drops the line suffix the file viewer adds", () => {
    expect(displayedLocalPath("src/foo.ts:12")).toBe("src/foo.ts")
    expect(displayedLocalPath("src/foo.ts#L12-L18")).toBe("src/foo.ts")
    expect(displayedLocalPath("C:/repo/foo.ts:3")).toBe("C:/repo/foo.ts")
    expect(displayedLocalPath("src/foo.ts")).toBe("src/foo.ts")
  })

  test("recognizes drive and rooted paths", () => {
    expect(absoluteLocalPath("C:/repo/foo.ts")).toBe(true)
    expect(absoluteLocalPath("/home/user/foo.ts")).toBe(true)
    expect(absoluteLocalPath("src/foo.ts")).toBe(false)
    expect(absoluteLocalPath("~/foo.ts")).toBe(false)
  })

  test("normalizes relative and absolute paths the menu can resolve", () => {
    expect(resolvableLocalPath("src/foo.ts")).toEqual({ absolute: false, path: "src/foo.ts" })
    expect(resolvableLocalPath("./src/foo.ts")).toEqual({ absolute: false, path: "src/foo.ts" })
    expect(resolvableLocalPath("././src/foo.ts")).toEqual({ absolute: false, path: "src/foo.ts" })
    expect(resolvableLocalPath("src\\foo.ts")).toEqual({ absolute: false, path: "src/foo.ts" })
    expect(resolvableLocalPath("C:/repo/foo.ts")).toEqual({ absolute: true, path: "C:/repo/foo.ts" })
    expect(resolvableLocalPath("C:\\repo\\foo.ts")).toEqual({ absolute: true, path: "C:/repo/foo.ts" })
    expect(resolvableLocalPath("/home/user/foo.ts")).toEqual({ absolute: true, path: "/home/user/foo.ts" })
    expect(resolvableLocalPath("./C:/repo/foo.ts")).toEqual({ absolute: true, path: "C:/repo/foo.ts" })
  })

  test("keeps unsafe or ambiguous paths on Copy Path", () => {
    for (const path of [
      "",
      "~/foo.ts",
      "./~/foo.ts",
      ".//server",
      "//server/share",
      "src//foo.ts",
      "src/./foo.ts",
      "src/../foo.ts",
      "..\\..\\secret",
      "file:/tmp/foo.ts",
      "\\server\\share",
      "\\\\server\\share",
      "src/\t/foo.ts",
      "C:",
      "C:/",
      "/",
    ]) {
      expect(resolvableLocalPath(path)).toBeUndefined()
    }
  })

  test("joins workspace paths and collapses relative segments", () => {
    expect(joinLocalPath("C:/repo", "src/foo.ts")).toBe("C:/repo/src/foo.ts")
    expect(joinLocalPath("/home/user/repo", "src/../src/foo.ts")).toBe("/home/user/repo/src/foo.ts")
    expect(joinLocalPath("C:\\repo", "src\\foo.ts")).toBe("C:/repo/src/foo.ts")
    expect(joinLocalPath("C:/repo", "D:/shared/foo.ts")).toBe("D:/shared/foo.ts")
  })

  test("prefers an exact match, then one suffix match, and keeps several ambiguous", () => {
    expect(selectLocalFile("C:/repo", "src/app.ts", ["src/app.ts", "test/app.ts"])).toEqual({
      kind: "file",
      path: "C:/repo/src/app.ts",
    })
    expect(selectLocalFile("C:/repo", "app.ts", ["src/app.ts", "test/other.ts"])).toEqual({
      kind: "file",
      path: "C:/repo/src/app.ts",
    })
    expect(selectLocalFile("C:/repo", "app.ts", ["src/app.ts", "test/app.ts"])).toEqual({ kind: "multiple" })
    expect(selectLocalFile("C:/repo", "app.ts", ["src/other.ts"])).toEqual({ kind: "missing" })
    expect(selectLocalFile("C:/repo", "src\\app.ts", ["src/app.ts"])).toEqual({
      kind: "file",
      path: "C:/repo/src/app.ts",
    })
  })

  test("offers file actions only on a local desktop", () => {
    expect(localFileActions({ desktop: true, local: true, path: "src/app.ts" })).toEqual([
      "open",
      "saveAs",
      "copy",
      "reveal",
    ])
    expect(localFileActions({ desktop: true, local: true, path: "src\\app.ts" })).toEqual([
      "open",
      "saveAs",
      "copy",
      "reveal",
    ])
    expect(localFileActions({ desktop: true, local: true, path: "C:/repo/app.ts" })).toEqual([
      "open",
      "saveAs",
      "copy",
      "reveal",
    ])
    expect(localFileActions({ desktop: true, local: true, path: "/home/user/app.ts" })).toEqual([
      "open",
      "saveAs",
      "copy",
      "reveal",
    ])
    expect(localFileActions({ desktop: false, local: true, path: "src/app.ts" })).toEqual(["copy"])
    expect(localFileActions({ desktop: true, local: false, path: "src/app.ts" })).toEqual(["copy"])
    expect(localFileActions({ desktop: true, local: true, path: "~/.config/app" })).toEqual(["copy"])
    expect(localFileActions({ desktop: true, local: true, path: "..\\..\\secret" })).toEqual(["copy"])
    expect(localFileActions({ desktop: true, local: true, path: ".//server" })).toEqual(["copy"])
    expect(localFileActions({ desktop: true, local: true, path: "file:/tmp/app" })).toEqual(["copy"])
    expect(localFileActions({ desktop: true, local: true, path: "/builtin/read" })).toEqual(["copy"])
  })
})
