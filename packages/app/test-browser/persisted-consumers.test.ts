import { expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createRoot } from "solid-js"
import { createDraftSelection, ModelSelectionSchema } from "@/providers/models/selection"
import type { Platform } from "@/runtime/platform/platform"
import { flushPersisted } from "@/runtime/persistence/persist"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"

const webPlatform: Platform = {
  platform: "web",
  openExternal: () => {},
  restart: async () => {},
  notify: async () => {},
}

function desktopPlatform(storage: AsyncStorage): Platform {
  return {
    platform: "desktop",
    storage: () => storage,
    openExternal: () => {},
    restart: async () => {},
    notify: async () => {},
  }
}

test("persisted model selection hydrates, updates and serializes the schema shape", () => {
  const key = `consumer-model-selection-${crypto.randomUUID()}`
  localStorage.setItem(
    key,
    JSON.stringify({ pick: { session1: { agent: "plan" }, __workspace__: { agent: "build" } } }),
  )
  createRoot((dispose) => {
    try {
      const [state, setState] = persisted(
        key,
        ModelSelectionSchema,
        { session: {} },
        {
          platform: "web",
          openExternal: () => {},
          restart: async () => {},
          notify: async () => {},
        },
      )

      expect(state.session.session1?.agent).toBe("plan")
      const choice = { providerID: "provider", modelID: "model", variant: { type: "default" as const } }
      setState("session", "session1", { agent: "build", choice })
      expect(state.session.session1?.agent).toBe("build")
      flushPersisted()
      expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual({
        session: { session1: { agent: "build", choice } },
      })
    } finally {
      dispose()
      localStorage.removeItem(key)
    }
  })
})

test("draft selection round-trips by draft and reset clears the whole selection", () => {
  const draftID = `consumer-draft-${crypto.randomUUID()}`
  const target = Persist.draft(draftID, "model-selection")
  const choice = { providerID: "provider", modelID: "model", variant: { type: "default" as const } }

  createRoot((dispose) => {
    try {
      const draft = createDraftSelection(draftID, webPlatform)
      draft.edit({ type: "agent", agent: "plan", previous: { agent: "build" } })
      draft.edit({ type: "model", agent: "plan", choice })
      expect(draft.selection()).toMatchObject({ agent: "plan", choice })
      flushPersisted()
    } finally {
      dispose()
    }
  })

  createRoot((dispose) => {
    try {
      const restored = createDraftSelection(draftID, webPlatform)
      expect(restored.ready()).toBe(true)
      expect(restored.selection()).toMatchObject({ agent: "plan", choice })

      restored.reset()
      expect(restored.selection()?.agent).toBeUndefined()
      expect(restored.selection()?.choice).toBeUndefined()
      expect(restored.selection()?.choices).toEqual({})
    } finally {
      dispose()
    }
  })

  createRoot((dispose) => {
    try {
      const cleared = createDraftSelection(draftID, webPlatform)
      expect(cleared.selection()?.agent).toBeUndefined()
      expect(cleared.selection()?.choice).toBeUndefined()
    } finally {
      dispose()
      removePersisted(target, webPlatform)
    }
  })
})

test("a draft selection reports readiness while its stored value loads", async () => {
  const load = Promise.withResolvers<string | null>()

  const storage: AsyncStorage = {
    getItem: () => load.promise,
    setItem: async () => {},
    removeItem: async () => {},
    clear: async () => {},
    key: async () => null,
    getLength: async () => 0,
    length: Promise.resolve(0),
  }

  const root = createRoot((dispose) => ({
    dispose,
    draft: createDraftSelection(`consumer-async-${crypto.randomUUID()}`, desktopPlatform(storage)),
  }))

  expect(root.draft.ready()).toBe(false)
  load.resolve(JSON.stringify({ agent: "plan" }))
  await root.draft.ready.promise
  expect(root.draft.ready()).toBe(true)
  expect(root.draft.selection()?.agent).toBe("plan")
  root.dispose()
})
