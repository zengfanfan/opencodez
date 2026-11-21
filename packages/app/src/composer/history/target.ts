import { Persist } from "@/runtime/persistence/storage"
import type { ServerScope } from "@/runtime/server/scope"

/**
 * History follows the composer that owns it. Active sessions are scoped by
 * server, directory and session; a new-session composer uses its draft.
 */
export type ComposerHistoryScope =
  | { kind: "session"; server: ServerScope; directory: string; session: string }
  | { kind: "draft"; draftID: string }

export function historyTarget(scope: ComposerHistoryScope | undefined, key: string) {
  if (!scope) return Persist.global(key)

  if (scope.kind === "draft") return Persist.draft(scope.draftID, key)

  return Persist.serverSession(scope.server, scope.directory, scope.session, key)
}

/**
 * Identifies the storage a scope reads and writes. Two composers that resolve to the same key
 * share one history store, which is how a starting Session and its promoted composer see the
 * first prompt recorded before either of them mounted.
 */
export function composerHistoryScopeKey(scope: ComposerHistoryScope | undefined) {
  const target = historyTarget(scope, "prompt-history")

  return `${target.storage ?? "default"}\u0000${target.key}`
}
