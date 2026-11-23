import { describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Exit, FileSystem } from "effect"
import { copyFileForSaveAs, saveFileAsStep } from "./save-as"

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystem.layer)))

const identity = (dev: bigint, ino: bigint) => ({ dev, ino })

describe("Save As decisions", () => {
  test("treats the same path as the same file without copying", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: identity(1n, 2n),
        target: "/repo/./source.txt",
        targetState: { kind: "file", identity: identity(1n, 2n) },
      }),
    ).toBe("sameFile")
  })

  test("copies only when the target is missing", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: identity(1n, 2n),
        target: "/repo/copy.txt",
        targetState: { kind: "missing" },
      }),
    ).toBe("copy")
  })

  test("leaves an unverifiable destination alone", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: identity(1n, 2n),
        target: "/repo/copy.txt",
        targetState: { kind: "unverified" },
      }),
    ).toBe("unverified")
  })

  test("detects a hard link through dev and inode", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: identity(1n, 2n),
        target: "/repo/hard-link.txt",
        targetState: { kind: "file", identity: identity(1n, 2n) },
      }),
    ).toBe("sameFile")
  })

  test("copies when the identities differ", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: identity(1n, 2n),
        target: "/repo/copy.txt",
        targetState: { kind: "file", identity: identity(1n, 3n) },
      }),
    ).toBe("copy")
  })

  test("treats a zero inode as unverifiable", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: identity(1n, 2n),
        target: "/repo/copy.txt",
        targetState: { kind: "file", identity: identity(1n, 0n) },
      }),
    ).toBe("unverified")
  })

  test("requires an identity on both files", () => {
    expect(
      saveFileAsStep({
        source: "/repo/source.txt",
        sourceIdentity: undefined,
        target: "/repo/copy.txt",
        targetState: { kind: "file", identity: identity(1n, 2n) },
      }),
    ).toBe("unverified")
  })
})

describe("copyFileForSaveAs", () => {
  test("does not copy a file onto itself", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-save-as-"))
    const source = join(directory, "source.txt")

    try {
      await writeFile(source, "original")
      expect(await run(copyFileForSaveAs(source, source))).toBe("sameFile")
      expect(await readFile(source, "utf8")).toBe("original")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("copies to a missing destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-save-as-"))
    const source = join(directory, "source.txt")
    const target = join(directory, "copy.txt")

    try {
      await writeFile(source, "original")
      expect(await run(copyFileForSaveAs(source, target))).toBe("saved")
      expect(await readFile(target, "utf8")).toBe("original")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("overwrites a different destination", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-save-as-"))
    const source = join(directory, "source.txt")
    const target = join(directory, "copy.txt")

    try {
      await writeFile(source, "original")
      await writeFile(target, "before")
      expect(await run(copyFileForSaveAs(source, target))).toBe("saved")
      expect(await readFile(target, "utf8")).toBe("original")
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("does not touch the destination when the source is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-save-as-"))
    const source = join(directory, "missing.txt")
    const target = join(directory, "copy.txt")

    try {
      const exit = await Effect.runPromise(
        Effect.exit(copyFileForSaveAs(source, target).pipe(Effect.provide(NodeFileSystem.layer))),
      )

      expect(Exit.isFailure(exit)).toBe(true)

      await expect(access(target)).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
