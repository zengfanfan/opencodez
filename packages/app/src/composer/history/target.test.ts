import { describe, expect, test } from "bun:test"
import { ServerScope } from "@/runtime/server/scope"
import { composerHistoryScopeKey, historyTarget } from "./target"

function session(directory: string, id: string) {
  return {
    kind: "session" as const,
    server: ServerScope.local,
    directory,
    session: id,
  }
}

describe("Composer history target", () => {
  test("separates sessions in the same directory", () => {
    const first = historyTarget(session("/work", "s1"), "prompt-history")
    const second = historyTarget(session("/work", "s2"), "prompt-history")

    expect(first.key).toBe("session:s1:prompt-history")
    expect(second.key).toBe("session:s2:prompt-history")
    expect(first.storage).toBe(second.storage)
  })

  test("separates the same session in different directories", () => {
    const first = historyTarget(session("/one", "s1"), "prompt-history")
    const second = historyTarget(session("/two", "s1"), "prompt-history")

    expect(first.storage).not.toBe(second.storage)
  })

  test("gives every new-session draft its own storage", () => {
    const first = historyTarget({ kind: "draft", draftID: "draft-1" }, "prompt-history")
    const second = historyTarget({ kind: "draft", draftID: "draft-2" }, "prompt-history")

    expect(first.storage).not.toBe(second.storage)
    expect(first.key).toBe("draft:prompt-history")
  })

  test("keeps the global fallback for scope-less composers", () => {
    expect(historyTarget(undefined, "prompt-history")).toEqual({
      storage: "opencode.global.dat",
      key: "prompt-history",
    })
  })

  test("gives the same scope one shared history key", () => {
    const scope = session("/work", "s1")

    expect(composerHistoryScopeKey(scope)).toBe(composerHistoryScopeKey({ ...scope }))
    expect(composerHistoryScopeKey(scope)).not.toBe(composerHistoryScopeKey(session("/work", "s2")))
    expect(composerHistoryScopeKey(scope)).not.toBe(composerHistoryScopeKey({ kind: "draft", draftID: "s1" }))
  })
})
