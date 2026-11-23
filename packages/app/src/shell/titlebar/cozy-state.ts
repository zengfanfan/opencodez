import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { Persist, persisted } from "@/runtime/persistence/storage"

const CozyState = Persistence.struct({
  // Each server's project order, keyed by ServerConnection.Key.
  order: Persistence.record(Persistence.array(Schema.String)),
})

/** The Cozy-only project order. Pins and the mixed pin order live in the shared `sidebar.recent` store. */
export function createCozyState() {
  const [state, setState, , ready] = persisted(Persist.global("sidebar.cozy"), CozyState, { order: {} })

  return {
    ready,
    order: (server: string) => state.order[server] ?? [],
    setOrder: (server: string, next: readonly string[]) => setState("order", server, [...next]),
  }
}
