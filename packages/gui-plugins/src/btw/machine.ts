/** Longest one answer may take before it fails with Retry; a stalled connection never settles on its own. */
export const BTW_GENERATE_TIMEOUT_MS = 300_000

export type BtwChatModel = {
  readonly providerID: string
  readonly id: string
  readonly variant?: string
}

/** One chat as the session store keeps it. */
export type BtwSavedChat = {
  readonly id: string
  /** The tab this turn belongs to. Absent on the thread's first question, whose id is the tab id. */
  readonly thread?: string
  readonly question: string
  readonly answer?: string
  readonly agent?: string
  readonly model?: BtwChatModel
  readonly created?: number
  readonly duration?: number
}

type ChatInfo = {
  readonly thread?: string
  readonly question: string
  readonly created?: number
  readonly agent?: string
  readonly model?: BtwChatModel
}

/**
 * Why a chat has no answer. `interrupted` is a stored chat without an answer: a reload, closed session or disposed
 * plugin abandoned its request. `empty` is a reply without visible text (a tool call or reasoning only).
 */
export type BtwFailure =
  | { readonly reason: "interrupted" }
  | { readonly reason: "empty" }
  | { readonly reason: "timeout" }
  | { readonly reason: "error"; readonly message?: string }

/**
 * A chat this plugin instance asked or retried. Chats it never touched are read from the session store, so a chat
 * shows its question, failure and Retry before the store loads.
 */
export type BtwChat =
  | (ChatInfo & { readonly status: "running"; readonly attempt: number; readonly started: number })
  | (ChatInfo & { readonly status: "answered"; readonly answer: string; readonly duration: number })
  | (ChatInfo & { readonly status: "failed"; readonly failure: BtwFailure })

/** `issued` is the last attempt id handed out; chats are keyed by session key, then chat id. */
export type BtwState =
  | {
      readonly status: "active"
      readonly issued: number
      readonly sessions: ReadonlyMap<string, ReadonlyMap<string, BtwChat>>
    }
  | { readonly status: "disposed" }

type ActiveState = Extract<BtwState, { status: "active" }>

export type BtwEvent =
  | {
      readonly type: "chat.asked"
      readonly sessionKey: string
      readonly id: string
      /** Set on a follow-up: the tab that holds the thread. */
      readonly thread?: string
      readonly question: string
      readonly created: number
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | {
      readonly type: "chat.retried"
      readonly sessionKey: string
      readonly id: string
      readonly now: number
      /** The stored chat, once the session store has loaded. */
      readonly saved?: BtwSavedChat
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | {
      readonly type: "generate.succeeded"
      readonly sessionKey: string
      readonly id: string
      readonly attempt: number
      readonly text: string
      readonly now: number
    }
  | {
      readonly type: "generate.failed"
      readonly sessionKey: string
      readonly id: string
      readonly attempt: number
      readonly message?: string
    }
  | { readonly type: "generate.timed-out"; readonly sessionKey: string; readonly id: string; readonly attempt: number }
  | { readonly type: "chat.removed"; readonly sessionKey: string; readonly id: string }
  | { readonly type: "sessions.pruned"; readonly keep: ReadonlySet<string> }
  | { readonly type: "disposed" }

/** Effects act on the session of the event that caused them. */
export type BtwEffect =
  | {
      readonly type: "persist-question"
      readonly id: string
      /** Set on a follow-up: the tab that holds the thread. */
      readonly thread?: string
      readonly question: string
      readonly created: number
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | { readonly type: "open-tab"; readonly id: string }
  | {
      readonly type: "generate"
      readonly id: string
      readonly attempt: number
      readonly question: string
      /** The side thread whose earlier turns are replayed with this question. */
      readonly thread?: string
      readonly timeout: number
    }
  | {
      readonly type: "persist-answer"
      readonly id: string
      readonly answer: string
      readonly duration: number
      readonly agent?: string
      readonly model?: BtwChatModel
    }
  | { readonly type: "delete-chat"; readonly id: string }
  /** Ends the attempt's request, if it still runs, and clears its timeout. */
  | { readonly type: "abort"; readonly attempt: number }

export type BtwTransition = {
  readonly state: BtwState
  readonly effects: readonly BtwEffect[]
}

export function createBtwState(): BtwState {
  return { status: "active", issued: 0, sessions: new Map() }
}

export function transitionBtw(state: BtwState, event: BtwEvent): BtwTransition {
  if (state.status === "disposed") return next(state)

  if (event.type === "disposed") {
    return next({ status: "disposed" }, [...state.sessions.values()].flatMap(aborts))
  }

  if (event.type === "chat.asked") return asked(state, event)

  if (event.type === "chat.retried") return retried(state, event)

  if (event.type === "chat.removed") return removed(state, event.sessionKey, event.id)

  if (event.type === "sessions.pruned") return pruned(state, event.keep)

  const chat = state.sessions.get(event.sessionKey)?.get(event.id)

  if (chat?.status !== "running" || chat.attempt !== event.attempt) return next(state)

  const info = {
    thread: chat.thread,
    question: chat.question,
    created: chat.created,
    agent: chat.agent,
    model: chat.model,
  }

  const abort: BtwEffect = { type: "abort", attempt: chat.attempt }

  if (event.type === "generate.timed-out") {
    return next(put(state, event.sessionKey, event.id, { ...info, status: "failed", failure: { reason: "timeout" } }), [
      abort,
    ])
  }

  if (event.type === "generate.failed") {
    const failure: BtwFailure = { reason: "error", message: event.message?.trim() || undefined }

    return next(put(state, event.sessionKey, event.id, { ...info, status: "failed", failure }), [abort])
  }

  const answer = event.text.trim()

  // A reply without visible text is a failure the user can retry, not an empty answer.
  if (!answer) {
    return next(put(state, event.sessionKey, event.id, { ...info, status: "failed", failure: { reason: "empty" } }), [
      abort,
    ])
  }

  const duration = Math.max(0, event.now - chat.started)

  return next(put(state, event.sessionKey, event.id, { ...info, status: "answered", answer, duration }), [
    abort,
    { type: "persist-answer", id: event.id, answer, duration, agent: chat.agent, model: chat.model },
  ])
}

export type BtwTabView =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly question: string }

export type BtwChatView =
  | { readonly phase: "loading" }
  | { readonly phase: "missing" }
  | (ChatInfo & { readonly phase: "running" })
  | (ChatInfo & { readonly phase: "failed"; readonly failure: BtwFailure })
  | (ChatInfo & { readonly phase: "answered"; readonly answer: string; readonly duration?: number })

/** What a chat's tab shows. `saved` is the session store's chats, undefined until it loads. */
export function btwTabView(
  state: BtwState,
  saved: readonly BtwSavedChat[] | undefined,
  sessionKey: string,
  id: string,
  opened = false,
): BtwTabView {
  const thread = btwThreadView(state, saved, sessionKey, id, opened)

  if (thread.phase !== "ready") return { status: thread.phase }
  const first = thread.turns[0]?.view

  if (!first || first.phase === "loading" || first.phase === "missing") {
    // An opened thread with no turns yet still lists; its tab shows the plugin's title.
    return thread.turns.length === 0 ? { status: "ready", question: "" } : { status: "missing" }
  }

  return { status: "ready", question: first.question }
}

/** One rendered turn of a side thread. */
export type BtwTurn = { readonly id: string; readonly view: BtwChatView }

/** A side thread as one tab shows it. */
export type BtwThreadView =
  | { readonly phase: "loading" }
  | { readonly phase: "missing" }
  | { readonly phase: "ready"; readonly busy: boolean; readonly turns: readonly BtwTurn[] }

/** Whether a turn belongs to the tab: its first question, or one of its follow-ups. */
export function btwKeepsChat(chat: { readonly id: string; readonly thread?: string }, tabId: string) {
  return chat.id !== tabId && chat.thread !== tabId
}

/** What a tab's thread shows. `saved` is the session store's chats, undefined until it loads. */
export function btwThreadView(
  state: BtwState,
  saved: readonly BtwSavedChat[] | undefined,
  sessionKey: string,
  tabId: string,
  opened = false,
): BtwThreadView {
  const live = state.status === "active" ? [...(state.sessions.get(sessionKey) ?? [])] : []
  const running = live.filter(([chatId, chat]) => !btwKeepsChat({ id: chatId, thread: chat.thread }, tabId))
  const stored = saved?.filter((chat) => !btwKeepsChat(chat, tabId))

  // A restored tab mounts before desktop storage loads; showing a composer then would accept a
  // follow-up without the thread's earlier turns. An opened chat starts empty by design.
  if (saved === undefined && running.length === 0 && !opened) return { phase: "loading" }
  const ids = [...new Set([...(stored ?? []).map((chat) => chat.id), ...running.map(([chatId]) => chatId)])]

  if (ids.length === 0) {
    return opened ? { phase: "ready", busy: false, turns: [] } : { phase: "missing" }
  }

  return {
    phase: "ready",
    busy: running.some(([, chat]) => chat.status === "running"),
    turns: ids.map((id) => ({ id, view: btwChatView(state, saved, sessionKey, id) })),
  }
}

/** Whether a follow-up may start now: the thread is known and no turn of it runs. */
export function btwCanFollow(view: BtwThreadView) {
  return view.phase === "ready" && !view.busy
}

/** Each side turn replays the whole session context, so only the newest pairs ride along. */
// shortcut: 8 replayed side turns; add a summary of older turns if side threads grow long.
export const BTW_HISTORY_TURNS = 8

/** The model answers from the session context it is given; a single generate cannot act on it. */
export const BTW_INSTRUCTIONS = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

/** The prompt of one side turn: the instructions, the thread's recent pairs, then the question. */
export function btwPrompt(history: readonly { question: string; answer: string }[], question: string) {
  const turns = history.slice(-BTW_HISTORY_TURNS)

  if (turns.length === 0) return [BTW_INSTRUCTIONS, question].join("\n\n")

  return [
    BTW_INSTRUCTIONS,
    "Side conversation so far:",
    turns.map((turn) => `Q: ${turn.question} A: ${turn.answer}`).join("\n\n"),
    `Q: ${question}`,
  ].join("\n\n")
}

/** Enter sends; Shift+Enter and an IME's Enter (composing or legacy keyCode 229) do not. */
export function btwSubmitsOnEnter(event: {
  readonly key: string
  readonly shiftKey: boolean
  readonly isComposing: boolean
  readonly keyCode: number
}) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}

/** What a chat's panel shows. `saved` is the session store's chats, undefined until it loads. */
export function btwChatView(
  state: BtwState,
  saved: readonly BtwSavedChat[] | undefined,
  sessionKey: string,
  id: string,
): BtwChatView {
  const live = liveChat(state, sessionKey, id)

  if (live) {
    const info = { question: live.question, created: live.created, agent: live.agent, model: live.model }

    if (live.status === "running") return { ...info, phase: "running" }

    if (live.status === "failed") return { ...info, phase: "failed", failure: live.failure }

    return { ...info, phase: "answered", answer: live.answer, duration: live.duration }
  }

  if (!saved) return { phase: "loading" }
  const stored = saved.find((item) => item.id === id)

  if (!stored) return { phase: "missing" }
  const info = { question: stored.question, created: stored.created, agent: stored.agent, model: stored.model }
  const answer = stored.answer?.trim()

  if (answer) return { ...info, phase: "answered", answer, duration: stored.duration }

  // Builds before this machine stored a blank reply as the answer.
  return { ...info, phase: "failed", failure: { reason: stored.answer === undefined ? "interrupted" : "empty" } }
}

function asked(state: ActiveState, event: Extract<BtwEvent, { type: "chat.asked" }>) {
  const question = event.question.trim()

  if (!question || state.sessions.get(event.sessionKey)?.has(event.id)) return next(state)
  const attempt = state.issued + 1
  const info = { question, created: event.created, agent: event.agent, model: event.model }
  // The store keeps the thread id on every turn; the persisted effect omits an absent one so older
  // records keep their exact shape.
  const persisted = event.thread === undefined ? info : { ...info, thread: event.thread }

  return next(
    put({ ...state, issued: attempt }, event.sessionKey, event.id, {
      ...info,
      thread: event.thread,
      status: "running",
      attempt,
      started: event.created,
    }),
    [
      { type: "persist-question", id: event.id, ...persisted },
      // A follow-up's tab is already open; only a first question opens one.
      ...(event.thread === undefined ? [{ type: "open-tab" as const, id: event.id }] : []),
      generateEffect(event.id, attempt, question, event.thread),
    ],
  )
}

// A stored chat this instance never asked (one restored after a reload) is retryable once the store has loaded.
function retried(state: ActiveState, event: Extract<BtwEvent, { type: "chat.retried" }>) {
  const live = state.sessions.get(event.sessionKey)?.get(event.id)
  const chat = live ?? (event.saved?.answer?.trim() ? undefined : event.saved)

  if (!chat || (live && live.status !== "failed")) return next(state)
  const attempt = state.issued + 1

  return next(
    put({ ...state, issued: attempt }, event.sessionKey, event.id, {
      status: "running",
      attempt,
      started: event.now,
      thread: chat.thread,
      question: chat.question,
      created: chat.created,
      agent: event.agent ?? chat.agent,
      model: event.model ?? chat.model,
    }),
    [generateEffect(event.id, attempt, chat.question, chat.thread)],
  )
}

function removed(state: ActiveState, sessionKey: string, id: string) {
  const chats = state.sessions.get(sessionKey)
  const remove: BtwEffect = { type: "delete-chat", id }

  if (!chats) return next(state, [remove])
  const gone = [...chats].filter(([chatId, chat]) => !btwKeepsChat({ id: chatId, thread: chat.thread }, id))

  if (gone.length === 0) return next(state, [remove])
  const kept = [...chats].filter(([chatId, chat]) => btwKeepsChat({ id: chatId, thread: chat.thread }, id))
  const sessions = new Map(state.sessions)

  if (kept.length === 0) sessions.delete(sessionKey)

  if (kept.length > 0) sessions.set(sessionKey, new Map(kept))

  return next(
    { ...state, sessions },
    [
      ...gone.flatMap(([, chat]): BtwEffect[] =>
        chat.status === "running" ? [{ type: "abort", attempt: chat.attempt }] : [],
      ),
      remove,
    ],
  )
}

// A closed session's requests end; its stored chats without an answer read as interrupted when it opens again.
function pruned(state: ActiveState, keep: ReadonlySet<string>) {
  const gone = [...state.sessions.keys()].filter((key) => !keep.has(key))

  if (gone.length === 0) return next(state)

  return next(
    { ...state, sessions: new Map([...state.sessions].filter(([key]) => keep.has(key))) },
    gone.flatMap((key) => aborts(state.sessions.get(key) ?? new Map())),
  )
}

function aborts(chats: ReadonlyMap<string, BtwChat>): BtwEffect[] {
  return [...chats.values()].flatMap((chat): BtwEffect[] =>
    chat.status === "running" ? [{ type: "abort", attempt: chat.attempt }] : [],
  )
}

function generateEffect(id: string, attempt: number, question: string, thread?: string): BtwEffect {
  const effect = { type: "generate" as const, id, attempt, question, timeout: BTW_GENERATE_TIMEOUT_MS }

  return thread === undefined ? effect : { ...effect, thread }
}

function liveChat(state: BtwState, sessionKey: string, id: string) {
  return state.status === "active" ? state.sessions.get(sessionKey)?.get(id) : undefined
}

function put(state: ActiveState, sessionKey: string, id: string, chat: BtwChat): ActiveState {
  const sessions = new Map(state.sessions)
  sessions.set(sessionKey, new Map(state.sessions.get(sessionKey)).set(id, chat))

  return { ...state, sessions }
}

function next(state: BtwState, effects: readonly BtwEffect[] = []): BtwTransition {
  return { state, effects }
}
