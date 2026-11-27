import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useServers, ServerConnection } from "@/runtime/server/registry"
import {
  addPin,
  dedupePins,
  recentSessionEndpoints,
  recentSessionKey,
  removePin,
  splitRecentSessionKey,
} from "./recent-sessions-model"
import {
  applyUnpin,
  dedupePinKeys,
  moveRecentToFront,
  normalizeCozyOrder,
  normalizeRecentOrder,
  PinsState,
  pinProjectAt,
  pinSessionAt,
  reorderPinGroups,
  unpinSessionAt,
  withCozyPin,
  withoutCozyPin,
  type PinProjectAtInput,
  type PinSessionAtInput,
  type UnpinSessionAtInput,
} from "./session-pins-state"

export type SessionPins = ReturnType<typeof createSessionPins>

/**
 * The ordered pinned sessions, local to this desktop. Two routes to the same endpoint pin one session. The Cozy
 * sidebar stores its mixed project/session order in the same document so every sidebar sees one copy.
 */
export function createSessionPins() {
  const servers = useServers()

  const [state, setState, , ready] = persisted(
    { ...Persist.global("sidebar.recent"), sync: true },
    PinsState,
    { pins: [], cozy: [], recent: [] },
  )

  const endpoints = createMemo(() => recentSessionEndpoints(servers.list, servers.ownUrl()))

  const identity = (server: string, sessionID: string) => recentSessionKey(endpoints().get(server) ?? server, sessionID)

  const connections = createMemo(
    () => new Map(servers.list.map((conn) => [String(ServerConnection.key(conn)), conn] as const)),
  )

  const visibleServers = createMemo(() => new Set(servers.visible.map((conn) => String(ServerConnection.key(conn)))))

  const connectionCandidates = (server: string) => {
    const keys = connections()
    const result: string[] = []

    if (keys.has(server)) result.push(server)
    const endpoint = endpoints().get(server)

    if (endpoint && keys.has(endpoint)) result.push(endpoint)

    for (const [key, value] of endpoints()) {
      if (value === server && keys.has(key)) result.push(key)
    }

    return result.length > 0 ? result : [server]
  }

  // Only visibility and connection type are available here: SessionPins sits outside GlobalProvider, so it cannot
  // inspect serverCtx. A hidden endpoint alias must not shadow the connection key a sidebar can actually load.
  const connectionRank = (key: string) => {
    const conn = connections().get(key)

    if (!conn) return 5

    if (!visibleServers().has(key)) return 4

    if (ServerConnection.builtin(conn)) return 0

    if (conn.type === "plugin") return 1

    if (conn.type === "http") return 2

    return 3
  }

  const pinKeys = createMemo(() =>
    dedupePinKeys(state.pins, identity, connectionCandidates, connectionRank),
  )

  const identities = createMemo(
    () =>
      new Set(
        pinKeys().flatMap((key) => {
          const pin = splitRecentSessionKey(key)

          return pin ? [identity(pin.server, pin.sessionID)] : []
        }),
      ),
  )

  // Older documents and hand edits may hold exact duplicates. Normalize once the store is ready; the effect is
  // idempotent, and the same write also gives an old `{ pins }` document its empty `cozy` field. Endpoint aliases stay
  // raw here; the `pinKeys` view chooses a loadable connection key without rewriting storage.
  createEffect(() => {
    if (!ready()) return

    const pins = dedupePins(state.pins)
    const cozy = normalizeCozyOrder(state.cozy ?? [], identity)
    const recent = normalizeRecentOrder(state.recent ?? [], identity)

    const pinsChanged = pins.length !== state.pins.length || pins.some((key, index) => key !== state.pins[index])
    const cozyChanged = cozy.length !== (state.cozy?.length ?? 0) || cozy.some((key, index) => key !== state.cozy?.[index])

    const recentChanged =
      recent.length !== (state.recent?.length ?? 0) || recent.some((key, index) => key !== state.recent?.[index])

    if (pinsChanged || cozyChanged || recentChanged) setState({ pins, cozy, recent })
  })

  const unpin = (server: string, sessionID: string) => {
    const next = removePin(state.pins, recentSessionKey(server, sessionID), endpoints())

    if (next.length === state.pins.length) return
    setState(applyUnpin(state, next, server, sessionID, identity))
  }

  const unpinKey = (key: string) => {
    const next = removePin(state.pins, key, endpoints())

    if (next.length === state.pins.length) return
    const parsed = splitRecentSessionKey(key)

    if (!parsed) return
    setState(applyUnpin(state, next, parsed.server, parsed.sessionID, identity))
  }

  const pinKey = (key: string) => setState("pins", (pins) => addPin(pins, key))

  return {
    ready,
    keys: () => pinKeys(),
    identity,
    pinned: (server: string, sessionID: string) => identities().has(identity(server, sessionID)),
    unpin,
    unpinKey,
    pinKey,
    toggle: (server: string, sessionID: string) => {
      if (!identities().has(identity(server, sessionID))) {
        setState("pins", (pins) => addPin(pins, recentSessionKey(server, sessionID)))

        return
      }

      unpin(server, sessionID)
    },
    reorder: (visible: readonly string[], next: readonly string[]) =>
      setState("pins", reorderPinGroups(state.pins, visible, next, identity)),
    reorderWithCozy: (visible: readonly string[], next: readonly string[], cozy: readonly string[]) =>
      setState({
        pins: reorderPinGroups(state.pins, visible, next, identity),
        cozy: [...cozy],
      }),
    pinSessionAt: (input: Omit<PinSessionAtInput, "state" | "identityOf">) =>
      setState(
        pinSessionAt({
          ...input,
          state: { pins: state.pins, cozy: state.cozy },
          identityOf: identity,
        }),
      ),
    unpinSessionAt: (input: Omit<UnpinSessionAtInput, "state" | "identityOf">) =>
      setState(
        unpinSessionAt({
          ...input,
          state: { pins: state.pins, cozy: state.cozy, recent: state.recent },
          identityOf: identity,
        }),
      ),
    pinProjectAt: (input: Omit<PinProjectAtInput, "state">) =>
      setState("cozy", pinProjectAt({ ...input, state: { cozy: state.cozy } }).cozy),
    cozyOrder: () => state.cozy ?? [],
    setCozyOrder: (next: readonly string[]) => setState("cozy", [...next]),
    recentOrder: () => state.recent ?? [],
    setRecentOrder: (next: readonly string[]) => setState("recent", [...next]),
    moveRecentToFront: (keys: readonly string[]) =>
      setState("recent", (current) => moveRecentToFront(current ?? [], keys)),
    appendCozy: (key: string) => setState("cozy", (current) => withCozyPin(current, key)),
    removeCozy: (key: string) => setState("cozy", (current) => withoutCozyPin(current, key)),
    /** Pins a session with its Cozy slot in one write; unpinning goes through `unpin`. */
    pinWithCozy: (server: string, sessionID: string) =>
      setState({
        pins: addPin(state.pins, recentSessionKey(server, sessionID)),
        cozy: withCozyPin(state.cozy, `s:${identity(server, sessionID)}`),
      }),
  }
}

export const { use: useSessionPins, provider: SessionPinsProvider } = createSimpleContext({
  name: "SessionPins",
  gate: false,
  init: createSessionPins,
})
