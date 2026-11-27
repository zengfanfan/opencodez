import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import { recentSessionKey, splitRecentSessionKey } from "./recent-sessions-model"

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

export type PinGroup = { id: string; keys: string[] }

/** Groups stored pins by the endpoint identity, keeping the first group order and every raw alias. */
export function pinGroups(pins: readonly string[], identity: PinIdentity): PinGroup[] {
  const groups: PinGroup[] = []
  const byID = new Map<string, PinGroup>()

  for (const key of pins) {
    const parsed = splitRecentSessionKey(key)

    if (!parsed?.sessionID) continue
    const id = identity(parsed.server, parsed.sessionID)
    const group = byID.get(id)

    if (group) {
      group.keys.push(key)
      continue
    }

    const next = { id, keys: [key] }
    byID.set(id, next)
    groups.push(next)
  }

  return groups
}

/** One readable key per pinned session, preferring a connection key over an endpoint alias. */
export function dedupePinKeys(
  pins: readonly string[],
  identity: PinIdentity,
  connectionCandidates: (server: string) => readonly string[],
  connectionRank: (key: string) => number,
) {
  return pinGroups(pins, identity).flatMap((group) => {
    const candidates = group.keys.flatMap((key) => {
      const parsed = splitRecentSessionKey(key)

      if (!parsed?.sessionID) return []

      return connectionCandidates(parsed.server).map((server) => ({
        key: recentSessionKey(server, parsed.sessionID),
        rank: connectionRank(server),
      }))
    })

    const best = candidates.reduce<(typeof candidates)[number] | undefined>(
      (current, candidate) => (!current || candidate.rank < current.rank ? candidate : current),
      undefined,
    )

    return best ? [best.key] : [group.keys[0]!]
  })
}

/** Moves one identity group to an ordinal in the canonicalized pin order, preserving other aliases. */
export function insertPinGroupAt(
  pins: readonly string[],
  rawKey: string,
  identity: PinIdentity,
  ordinal: number,
) {
  const parsed = splitRecentSessionKey(rawKey)

  if (!parsed?.sessionID) return [...pins]
  const id = identity(parsed.server, parsed.sessionID)
  const groups = pinGroups(pins, identity).filter((group) => group.id !== id)
  const index = Number.isFinite(ordinal) ? Math.trunc(ordinal) : groups.length
  groups.splice(Math.max(0, Math.min(index, groups.length)), 0, { id, keys: [rawKey] })

  return groups.flatMap((group) => group.keys)
}

/** Reorders visible identity groups in place, leaving hidden groups and aliases untouched. */
export function reorderPinGroups(
  pins: readonly string[],
  visibleIds: readonly string[],
  nextIds: readonly string[],
  identity: PinIdentity,
) {
  const groups = pinGroups(pins, identity)
  const visible = new Set(visibleIds)
  const byID = new Map(groups.map((group) => [group.id, group] as const))

  if (
    visibleIds.length === 0 ||
    visible.size !== visibleIds.length ||
    nextIds.length !== visibleIds.length ||
    new Set(nextIds).size !== nextIds.length ||
    nextIds.some((id) => !visible.has(id) || !byID.has(id))
  )
    return [...pins]

  const ordered = nextIds.map((id) => byID.get(id)!)
  let index = 0

  return groups.flatMap((group) => (visible.has(group.id) ? ordered[index++]! : group).keys)
}

/** Removes every stored alias of one session. Malformed keys are left for the store cleanup. */
export function removePinByIdentity(
  pins: readonly string[],
  server: string,
  sessionID: string,
  identity: PinIdentity,
) {
  const target = identity(server, sessionID)

  return pins.filter((key) => {
    const parsed = splitRecentSessionKey(key)

    if (!parsed?.sessionID) return true

    return identity(parsed.server, parsed.sessionID) !== target
  })
}

/** Inserts before the visible anchor; a missing anchor or an empty page appends deterministically. */
export function insertVisible(
  order: readonly string[],
  visible: readonly string[],
  key: string,
  index: number,
) {
  const next = order.filter((item) => item !== key)

  if (visible.length === 0) return [...next, key]

  const target = Math.max(0, index)
  const before = target < visible.length
  const anchor = before ? visible[target]! : visible[visible.length - 1]!
  const at = next.indexOf(anchor)

  if (at === -1) return [...next, key]

  return [...next.slice(0, before ? at : at + 1), key, ...next.slice(before ? at : at + 1)]
}

/** Removes a key from a complete order and appends it. */
export function appendKey(order: readonly string[], key: string) {
  return [...order.filter((item) => item !== key), key]
}

export type PinSessionAtInput = {
  state: Pick<PinsState, "pins" | "cozy">
  server: string
  sessionID: string
  identity: string
  index: number
  base: readonly string[]
  visible: readonly string[]
  identityOf: PinIdentity
}

/** Pins a session at a visible row or the complete pinned tail. */
export function pinSessionAt(input: PinSessionAtInput) {
  const key = `s:${input.identity}`
  const cozy = input.index >= input.base.length ? appendKey(input.base, key) : insertVisible(input.base, input.visible, key, input.index)
  const inserted = cozy.indexOf(key)
  const ordinal = cozy.slice(0, inserted === -1 ? cozy.length : inserted).filter((item) => item.startsWith("s:")).length

  return {
    pins: insertPinGroupAt(input.state.pins, recentSessionKey(input.server, input.sessionID), input.identityOf, ordinal),
    cozy,
  }
}

export type UnpinSessionAtInput = {
  state: Pick<PinsState, "pins" | "cozy" | "recent">
  server: string
  sessionID: string
  identity: string
  index: number
  recentBase: readonly string[]
  recentVisible: readonly string[]
  identityOf: PinIdentity
}

/** Unpins a session and puts it at a visible Recent row or the complete recent tail. */
export function unpinSessionAt(input: UnpinSessionAtInput) {
  const pins = removePinByIdentity(input.state.pins, input.server, input.sessionID, input.identityOf)
  const cozy = removeCozySessionSlot(input.state.cozy, input.identity, input.identityOf)

  const recent =
    input.index >= input.recentBase.length
      ? appendKey(input.recentBase, input.identity)
      : insertVisible(input.recentBase, input.recentVisible, input.identity, input.index)

  return { pins, cozy, recent }
}

export type PinProjectAtInput = {
  state: Pick<PinsState, "cozy">
  projectKey: string
  index: number
  base: readonly string[]
  visible: readonly string[]
}

/** Pins a project at a visible row or the complete pinned tail. */
export function pinProjectAt(input: PinProjectAtInput) {
  const key = `p:${input.projectKey}`

  return {
    cozy: input.index >= input.base.length ? appendKey(input.base, key) : insertVisible(input.base, input.visible, key, input.index),
  }
}

export type UnpinProjectAtInput = {
  state: Pick<PinsState, "cozy">
  projectKey: string
  server: string
  worktree: string
  index: number
  projectOrder: readonly string[]
  visible: readonly string[]
}

/** Unpins a project and places its worktree in the complete project order. */
export function unpinProjectAt(input: UnpinProjectAtInput) {
  const order =
    input.index >= input.projectOrder.length
      ? appendKey(input.projectOrder, input.worktree)
      : insertVisible(input.projectOrder, input.visible, input.worktree, input.index)

  return {
    order,
    cozy: withoutCozyPin(input.state.cozy, `p:${input.projectKey}`),
  }
}
