import { beforeEach, describe, expect, test } from "bun:test"
import type { Prompt } from "@/composer/state"
import type { Platform } from "@/runtime/platform/platform"
import { ServerScope } from "@/runtime/server/scope"
import { createComposerHistoryRegistry } from "./registry"
import type { ComposerHistoryScope } from "./target"

// A web platform reads web storage synchronously, so an add is visible without waiting for hydration.
const platform: Platform = {
  platform: "web",
  openExternal() {},
  restart: async () => {},
  notify: async () => {},
}

function session(id: string): ComposerHistoryScope {
  return { kind: "session", server: ServerScope.local, directory: "C:/repo", session: id }
}

function prompt(text: string): Prompt {
  return [{ type: "text", content: text, start: 0, end: text.length }]
}

beforeEach(() => localStorage.clear())

describe("composer history registry", () => {
  test("shares one history for the same session", () => {
    const registry = createComposerHistoryRegistry()
    const first = registry.get(session("s1"), platform)

    first.add(prompt("first prompt"), "normal", [])

    const second = registry.get(session("s1"), platform)
    expect(second).toBe(first)
    expect(second.entries("normal")[0]?.prompt).toMatchObject([{ type: "text", content: "first prompt" }])
  })

  test("keeps sessions and drafts apart", () => {
    const registry = createComposerHistoryRegistry()
    const first = registry.get(session("s1"), platform)

    first.add(prompt("first prompt"), "normal", [])

    expect(registry.get(session("s2"), platform).entries("normal")).toEqual([])
    expect(registry.get({ kind: "draft", draftID: "draft-1" }, platform).entries("normal")).toEqual([])
  })

  test("keeps shell history next to normal history", () => {
    const registry = createComposerHistoryRegistry()
    const store = registry.get(session("s1"), platform)

    store.add(prompt("git status"), "shell", [])

    expect(store.entries("shell")[0]?.prompt).toMatchObject([{ type: "text", content: "git status" }])
    expect(store.entries("normal")).toEqual([])
  })
})
