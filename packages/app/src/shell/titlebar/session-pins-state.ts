import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { splitRecentSessionKey } from "./recent-sessions-model"

/** The Recent sidebar's pin state, shared by every sidebar that shows pinned sessions. */
export const PinsState = Persistence.struct({
  pins: Persistence.array(Schema.String),
  // Cozy's mixed pin order: `p:` is a pinned project, `s:` is a session slot.
  // Optional so an older `{ pins }` document keeps its sessions.
  cozy: Persistence.optional(Persistence.array(Schema.String)),
  // Cozy's Recent order, as endpoint-qualified session identities. Optional so older documents start at recency.
  recent: Persistence.optional(Persistence.array(Schema.String)),
})

export type PinsState = typeof PinsState.Type

export type PinIdentity = (server: string, sessionID: string) => string

/** Normalizes stored Cozy session slots to the current endpoint identity and drops malformed entries. */
export function normalizeCozyOrder(stored: readonly string[], identity: PinIdentity) {
  const seen = new Set<string>()

  return stored.flatMap((key) => {
    if (key.startsWith("p:")) {
      if (seen.has(key)) return []
      seen.add(key)

      return [key]
    }

    if (!key.startsWith("s:")) return []
    const parsed = splitRecentSessionKey(key.slice(2))

    if (!parsed?.sessionID) return []

    const next = `s:${identity(parsed.server, parsed.sessionID)}`

    if (seen.has(next)) return []
    seen.add(next)

    return [next]
  })
}

/** Normalizes stored Recent identities to the current endpoints and drops malformed or duplicate entries. */
export function normalizeRecentOrder(stored: readonly string[], identity: PinIdentity) {
  const seen = new Set<string>()

  return stored.flatMap((key) => {
    const parsed = splitRecentSessionKey(key)

    if (!parsed?.sessionID) return []
    const next = identity(parsed.server, parsed.sessionID)

    if (seen.has(next)) return []
    seen.add(next)

    return [next]
  })
}

/** Moves the given identities to the front, keeping their order and the rest untouched. */
export function moveRecentToFront(order: readonly string[], keys: readonly string[]) {
  const front = new Set(keys)

  return [...keys, ...order.filter((key) => !front.has(key))]
}

/** Removes one session's slot from the mixed order. Project slots are never touched. */
export function removeCozySessionSlot(cozy: readonly string[] | undefined, target: string, identity: PinIdentity) {
  return (cozy ?? []).filter((key) => {
    if (!key.startsWith("s:")) return true
    const parsed = splitRecentSessionKey(key.slice(2))

    if (!parsed?.sessionID) return true

    return identity(parsed.server, parsed.sessionID) !== target
  })
}

/** The single state change used when a session leaves the pin list: both fields change together. */
export function applyUnpin(
  state: Pick<PinsState, "pins" | "cozy">,
  nextPins: string[],
  server: string,
  sessionID: string,
  identity: PinIdentity,
) {
  return {
    pins: nextPins,
    cozy: removeCozySessionSlot(state.cozy, identity(server, sessionID), identity),
  }
}

/** Appends a pin to the mixed order unless it is already there. */
export function withCozyPin(cozy: readonly string[] | undefined, key: string) {
  const current = cozy ?? []

  return current.includes(key) ? [...current] : [...current, key]
}

/** Removes one exact pin from the mixed order. */
export function withoutCozyPin(cozy: readonly string[] | undefined, key: string) {
  return (cozy ?? []).filter((item) => item !== key)
}
