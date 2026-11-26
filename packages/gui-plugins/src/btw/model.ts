import { batch, createSignal, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { uuid } from "@opencode/util/uuid"
import type { MountedSession, SetupContext } from "@opencode/plugin/gui"
import type Btw from "./index"
import {
  btwCanFollow,
  btwKeepsChat,
  btwPrompt,
  btwTabView,
  btwThreadView,
  createBtwState,
  transitionBtw,
  type BtwEffect,
  type BtwEvent,
  type BtwThreadView,
} from "./machine"

/** Side questions per session: one thread per tab, stored until the tab closes. */
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const [state, setState] = createSignal(createBtwState())
  // Drafts outlive the panel's per-tab remount; closing a tab or session drops its entry.
  const [drafts, setDrafts] = createStore<Record<string, string | undefined>>({})
  // Side chats opened with no question yet. They live with the plugin instance: a reload forgets them.
  const [opened, setOpened] = createStore<Record<string, true | undefined>>({})
  // A tab selection asks its panel to focus the input. A fresh object per request makes a repeat request run again.
  const [focus, setFocus] = createSignal<{ key: string; attempt: number }>()
  let focusAttempt = 0
  // Driver handles only: the machine decides which attempt runs, these end its request and timeout.
  const inFlight = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const saved = (session: MountedSession) => {
    const store = ctx.stores.chats(session)

    return store.ready() ? (store.value?.chats ?? []) : undefined
  }

  const tabKey = (session: MountedSession, id: string) => `${session.key}\u0000${id}`
  const isOpen = (session: MountedSession, id: string) => !!opened[tabKey(session, id)]

  const thread = (session: MountedSession, id: string): BtwThreadView =>
    btwThreadView(state(), saved(session), session.key, id, isOpen(session, id))

  // Only answered turns ride along; a running or failed turn would add a question without an answer.
  const history = (session: MountedSession, id: string, current: string) => {
    const view = thread(session, id)

    if (view.phase !== "ready") return []

    return view.turns.flatMap((turn) => {
      if (turn.id === current || turn.view.phase !== "answered") return []

      return [{ question: turn.view.question, answer: turn.view.answer }]
    })
  }

  // Effects act on `session`, the session of the action or request that caused the event.
  const dispatch = (event: BtwEvent, session?: MountedSession) => {
    const previous = untrack(state)
    const result = transitionBtw(previous, event)

    batch(() => {
      if (result.state !== previous) setState(result.state)
      result.effects.forEach((effect) => run(effect, session))
    })
  }

  const run = (effect: BtwEffect, session: MountedSession | undefined) => {
    if (effect.type === "abort") {
      const handle = inFlight.get(effect.attempt)
      inFlight.delete(effect.attempt)

      if (!handle) return
      clearTimeout(handle.timer)
      handle.controller.abort()

      return
    }

    // SAFETY: only `disposed`, `sessions.pruned` and request results without an answer dispatch without a session,
    // and the machine answers those with `abort` alone.
    if (!session) return
    const store = ctx.stores.chats(session)

    if (effect.type === "persist-question") {
      // Desktop storage loads asynchronously; a write before load queues and lands once it loads, while the machine
      // already shows the turn. The session's store lives while its tab stays open.
      store.update((draft) => {
        draft.chats.push({
          id: effect.id,
          thread: effect.thread,
          question: effect.question,
          created: effect.created,
          agent: effect.agent,
          model: effect.model,
        })
      })

      return
    }

    if (effect.type === "open-tab") {
      ctx.layout.open(`${ctx.id}:${effect.id}`, session, { tab: "select" })

      return
    }

    if (effect.type === "persist-answer") {
      store.update((draft) => {
        const chat = draft.chats.find((item) => item.id === effect.id)

        if (!chat) return
        chat.answer = effect.answer
        chat.duration = effect.duration

        if (effect.agent) chat.agent = effect.agent

        if (effect.model) chat.model = effect.model
      })

      return
    }

    if (effect.type === "delete-chat") {
      store.update((draft) => {
        draft.chats = draft.chats.filter((item) => btwKeepsChat(item, effect.id))
      })

      return
    }

    generate(session, effect)
  }

  // In-flight questions keep running when the user leaves their session and answer into its store; only a reload,
  // closing the question's tab or session, or disposing the plugin abandons one, which leaves it retryable.
  const generate = (session: MountedSession, effect: Extract<BtwEffect, { type: "generate" }>) => {
    const key = session.key
    const result = { sessionKey: key, id: effect.id, attempt: effect.attempt }
    const controller = new AbortController()

    inFlight.set(effect.attempt, {
      controller,
      timer: setTimeout(() => dispatch({ type: "generate.timed-out", ...result }), effect.timeout),
    })

    session.server.client.session
      .generate(
        {
          sessionID: session.id,
          prompt: btwPrompt(history(session, effect.thread ?? effect.id, effect.id), effect.question),
        },
        { signal: AbortSignal.any([ctx.signal, controller.signal]) },
      )
      .then(
        (reply) => {
          if (ctx.signal.aborted) return
          dispatch({ type: "generate.succeeded", ...result, text: reply.text, now: Date.now() }, session)
        },
        (cause) => {
          if (ctx.signal.aborted) return
          const message = cause instanceof Error ? cause.message : String(cause)
          dispatch({ type: "generate.failed", ...result, message })
        },
      )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const selection = (session: MountedSession) => {
    const info = session.id ? session.server.data.session.get(session.id) : undefined
    const messages = session.id ? session.server.data.session.message.list(session.id) : []

    const lastAgent = messages.findLast(
      (item) => item.type === "assistant" || item.type === "agent-switched",
    )

    const lastModel = messages.findLast(
      (item) => item.type === "assistant" || item.type === "model-switched",
    )

    const agent = info?.agent ?? (lastAgent?.type === "assistant" || lastAgent?.type === "agent-switched" ? lastAgent.agent : undefined)
    const model = info?.model ?? (lastModel?.type === "assistant" || lastModel?.type === "model-switched" ? lastModel.model : undefined)

    return {
      agent,
      model: model ? { providerID: model.providerID, id: model.id, variant: model.variant } : undefined,
    }
  }

  const ask = (value?: string) => {
    const question = value?.trim()

    if (!question) {
      showToast({ title: ctx.t("question.required") })

      return
    }

    const session = ctx.sessions.current()

    if (!session?.id) return

    dispatch(
      { type: "chat.asked", sessionKey: session.key, id: uuid(), question, created: Date.now(), ...selection(session) },
      session,
    )
  }

  /** Adds one turn to an open thread. Returns false when the panel must keep its draft. */
  const follow = (session: MountedSession, id: string, value: string) => {
    const question = value.trim()

    if (!question || !session.id) return false

    const view = thread(session, id)

    if (!btwCanFollow(view)) return false
    // The first question of an empty side chat takes the tab's id, so the tab is that thread's first turn.
    const first = view.phase === "ready" && view.turns.length === 0

    const info = { sessionKey: session.key, question, created: Date.now(), ...selection(session) }

    const event: BtwEvent = first
      ? { type: "chat.asked", id, ...info }
      : { type: "chat.asked", id: uuid(), thread: id, ...info }

    dispatch(event, session)

    if (first) setOpened(tabKey(session, id), undefined)

    return true
  }

  /** Opens an empty side chat, focusing the session's empty one when it already has one. */
  const openChat = (session: MountedSession) => {
    if (!session.id) return
    const prefix = `${session.key}\u0000`
    const existing = Object.keys(opened).find((key) => key.startsWith(prefix))

    if (existing) {
      ctx.layout.open(`${ctx.id}:${existing.slice(prefix.length)}`, session, { tab: "select" })

      return
    }

    const id = uuid()

    setOpened(tabKey(session, id), true)
    ctx.layout.open(`${ctx.id}:${id}`, session, { tab: "select" })
  }

  return {
    ask,
    follow,
    openChat,
    thread,
    requestFocus: (session: MountedSession, id: string) => {
      focusAttempt += 1
      setFocus({ key: tabKey(session, id), attempt: focusAttempt })
    },
    focusRequest: (session: MountedSession, id: string) => {
      const request = focus()

      return request?.key === tabKey(session, id) ? request : undefined
    },
    draft: (session: MountedSession, id: string) => drafts[tabKey(session, id)] ?? "",
    setDraft: (session: MountedSession, id: string, text: string) => setDrafts(tabKey(session, id), text),
    tab: (session: MountedSession, id: string) =>
      btwTabView(state(), saved(session), session.key, id, isOpen(session, id)),
    retry: (session: MountedSession, id: string) => {
      dispatch(
        {
          type: "chat.retried",
          sessionKey: session.key,
          id,
          now: Date.now(),
          saved: saved(session)?.find((item) => item.id === id),
          ...selection(session),
        },
        session,
      )
    },
    /** Closing a tab forgets its thread and draft. */
    remove: (session: MountedSession, id: string) => {
      setDrafts(tabKey(session, id), undefined)
      setOpened(tabKey(session, id), undefined)
      dispatch({ type: "chat.removed", sessionKey: session.key, id }, session)
    },
    /** Ends the requests of sessions whose shell tab closed and forgets their chats, drafts and empty tabs. */
    prune: (keep: ReadonlySet<string>) => {
      for (const key of [...Object.keys(drafts), ...Object.keys(opened)]) {
        const sessionKey = key.split("\u0000")[0]

        if (sessionKey !== undefined && !keep.has(sessionKey)) {
          setDrafts(key, undefined)
          setOpened(key, undefined)
        }
      }

      dispatch({ type: "sessions.pruned", keep })
    },
  }
}

export type BtwModel = ReturnType<typeof createBtw>
