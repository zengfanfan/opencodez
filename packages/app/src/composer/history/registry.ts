import { createRoot } from "solid-js"
import type { Platform } from "@/runtime/platform/platform"
import { createComposerHistory, type ComposerHistoryStore } from "./store"
import { composerHistoryScopeKey, type ComposerHistoryScope } from "./target"

/**
 * One history store per persistence target. Prompt history is not tied to the composer view:
 * a new Session records its first prompt while the draft composer is going away, and the
 * promoted Session's composer reads the same store when it mounts.
 */
export function createComposerHistoryRegistry() {
  const stores = new Map<string, ComposerHistoryStore>()

  return {
    get(scope: ComposerHistoryScope | undefined, platform: Platform) {
      const key = composerHistoryScopeKey(scope)
      const existing = stores.get(key)

      if (existing) return existing

      // The store lives as long as the app, so its persistence effects must not belong to the
      // composer that happened to ask for it first.
      const created = createRoot(() => createComposerHistory(scope, platform))
      stores.set(key, created)

      return created
    },
  }
}

const registries = new WeakMap<Platform, ReturnType<typeof createComposerHistoryRegistry>>()

export function composerHistory(scope: ComposerHistoryScope | undefined, platform: Platform) {
  let registry = registries.get(platform)

  if (!registry) {
    registry = createComposerHistoryRegistry()
    registries.set(platform, registry)
  }

  return registry.get(scope, platform)
}
