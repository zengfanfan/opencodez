import { createEffect, createMemo } from "solid-js"
import { createSimpleContext } from "@opencode/ui/context"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { useServers } from "@/runtime/server/registry"
import {
  addPin,
  dedupePins,
  recentSessionEndpoints,
  recentSessionKey,
  removePin,
  reorderPins,
  splitRecentSessionKey,
} from "./recent-sessions-model"
import {
  applyUnpin,
  normalizeCozyOrder,
  PinsState,
  withCozyPin,
  withoutCozyPin,
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
    { pins: [], cozy: [] },
  )

  const endpoints = createMemo(() => recentSessionEndpoints(servers.list, servers.ownUrl()))

  const identity = (server: string, sessionID: string) => recentSessionKey(endpoints().get(server) ?? server, sessionID)

  const identities = createMemo(
    () =>
      new Set(
        state.pins.flatMap((key) => {
          const pin = splitRecentSessionKey(key)

          return pin ? [identity(pin.server, pin.sessionID)] : []
        }),
      ),
  )

  // Older documents and hand edits may hold duplicates or endpoint aliases. Normalize once the store is ready; the
  // effect is idempotent, and the same write also gives an old `{ pins }` document its empty `cozy` field.
  createEffect(() => {
    if (!ready()) return

    const pins = dedupePins(state.pins)
    const cozy = normalizeCozyOrder(state.cozy ?? [], identity)

    const pinsChanged = pins.length !== state.pins.length || pins.some((key, index) => key !== state.pins[index])
    const cozyChanged = cozy.length !== (state.cozy?.length ?? 0) || cozy.some((key, index) => key !== state.cozy?.[index])

    if (pinsChanged || cozyChanged) setState({ pins, cozy })
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
    keys: () => state.pins,
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
      setState("pins", reorderPins(state.pins, visible, next)),
    reorderWithCozy: (visible: readonly string[], next: readonly string[], cozy: readonly string[]) =>
      setState({
        pins: reorderPins(state.pins, visible, next),
        cozy: [...cozy],
      }),
    cozyOrder: () => state.cozy ?? [],
    setCozyOrder: (next: readonly string[]) => setState("cozy", [...next]),
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
