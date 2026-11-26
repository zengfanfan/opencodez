import { describe, expect, test } from "bun:test"
import {
  BTW_GENERATE_TIMEOUT_MS,
  BTW_HISTORY_TURNS,
  BTW_INSTRUCTIONS,
  btwCanFollow,
  btwChatView,
  btwKeepsChat,
  btwPrompt,
  btwSubmitsOnEnter,
  btwTabView,
  btwThreadView,
  createBtwState,
  transitionBtw,
  type BtwEffect,
  type BtwEvent,
  type BtwSavedChat,
  type BtwState,
} from "./machine"

const model = { providerID: "anthropic", id: "claude" }

const asked: BtwEvent = {
  type: "chat.asked",
  sessionKey: "s1",
  id: "c1",
  question: "  Why?  ",
  created: 1_000,
  agent: "build",
  model,
}

// Replays events through the pure machine and collects every effect it asked for, in order.
function play(state: BtwState, ...events: BtwEvent[]) {
  return events.reduce<{ state: BtwState; effects: readonly BtwEffect[] }>(
    (result, event) => {
      const transition = transitionBtw(result.state, event)

      return { state: transition.state, effects: [...result.effects, ...transition.effects] }
    },
    { state, effects: [] },
  )
}

function succeeded(attempt: number, text: string, now = 1_450): BtwEvent {
  return { type: "generate.succeeded", sessionKey: "s1", id: "c1", attempt, text, now }
}

function retried(saved?: BtwSavedChat): BtwEvent {
  return { type: "chat.retried", sessionKey: "s1", id: "c1", now: 2_000, saved }
}

describe("bug replays", () => {
  test.each(["   \n\t  ", ""])(
    "a reply without visible text (%j) fails with Retry instead of a blank panel",
    (text) => {
      const empty = play(createBtwState(), asked, succeeded(1, text))

      expect(btwChatView(empty.state, [], "s1", "c1")).toEqual({
        phase: "failed",
        question: "Why?",
        created: 1_000,
        agent: "build",
        model,
        failure: { reason: "empty" },
      })
      expect(transitionBtw(play(createBtwState(), asked).state, succeeded(1, text)).effects).toEqual([
        { type: "abort", attempt: 1 },
      ])

      const recovered = play(empty.state, retried(), succeeded(2, "Because.", 2_300))

      expect(recovered.effects[0]).toEqual({
        type: "generate",
        id: "c1",
        attempt: 2,
        question: "Why?",
        timeout: BTW_GENERATE_TIMEOUT_MS,
      })
      expect(btwChatView(recovered.state, [], "s1", "c1")).toMatchObject({
        phase: "answered",
        answer: "Because.",
        duration: 300,
      })
    },
  )

  test("a blank answer stored by an older build is a retryable failure", () => {
    const stored = { id: "c1", question: "Why?", answer: "  " }

    expect(btwChatView(createBtwState(), [stored], "s1", "c1")).toEqual({
      phase: "failed",
      question: "Why?",
      created: undefined,
      agent: undefined,
      model: undefined,
      failure: { reason: "empty" },
    })
    expect(transitionBtw(createBtwState(), retried(stored)).effects).toEqual([
      { type: "generate", id: "c1", attempt: 1, question: "Why?", timeout: BTW_GENERATE_TIMEOUT_MS },
    ])
  })

  test("a question asked before the desktop store loads shows, fails and retries without it", () => {
    const running = play(createBtwState(), asked).state

    expect(btwTabView(running, undefined, "s1", "c1")).toEqual({ status: "ready", question: "Why?" })
    expect(btwChatView(running, undefined, "s1", "c1")).toMatchObject({ phase: "running", question: "Why?" })

    const failed = transitionBtw(running, {
      type: "generate.failed",
      sessionKey: "s1",
      id: "c1",
      attempt: 1,
      message: "Offline",
    }).state

    expect(btwChatView(failed, undefined, "s1", "c1")).toMatchObject({
      phase: "failed",
      question: "Why?",
      failure: { reason: "error", message: "Offline" },
    })
    expect(transitionBtw(failed, retried()).effects).toEqual([
      { type: "generate", id: "c1", attempt: 2, question: "Why?", timeout: BTW_GENERATE_TIMEOUT_MS },
    ])
  })

  test("a restored tab waits for the store, then shows what it holds", () => {
    const state = createBtwState()

    const saved = [
      { id: "answered", question: "Q1", answer: "A1", duration: 5 },
      { id: "interrupted", question: "Q2" },
    ]

    expect(btwTabView(state, undefined, "s1", "answered")).toEqual({ status: "loading" })
    expect(btwChatView(state, undefined, "s1", "answered")).toEqual({ phase: "loading" })
    expect(btwTabView(state, saved, "s1", "gone")).toEqual({ status: "missing" })
    expect(btwChatView(state, saved, "s1", "gone")).toEqual({ phase: "missing" })
    expect(btwTabView(state, saved, "s1", "answered")).toEqual({ status: "ready", question: "Q1" })
    expect(btwChatView(state, saved, "s1", "answered")).toMatchObject({ phase: "answered", answer: "A1", duration: 5 })
    expect(btwChatView(state, saved, "s1", "interrupted")).toMatchObject({
      phase: "failed",
      failure: { reason: "interrupted" },
    })
  })

  test("a stalled request times out with Retry and ignores its late reply", () => {
    const timedOut = transitionBtw(play(createBtwState(), asked).state, {
      type: "generate.timed-out",
      sessionKey: "s1",
      id: "c1",
      attempt: 1,
    })

    expect(timedOut.effects).toEqual([{ type: "abort", attempt: 1 }])
    expect(btwChatView(timedOut.state, [], "s1", "c1")).toMatchObject({
      phase: "failed",
      failure: { reason: "timeout" },
    })

    const late = transitionBtw(timedOut.state, succeeded(1, "Too late"))

    expect(late.state).toBe(timedOut.state)
    expect(late.effects).toEqual([])
  })
})

describe("requests", () => {
  test("an answer is trimmed, timed from the question and stored", () => {
    const result = transitionBtw(play(createBtwState(), asked).state, succeeded(1, "  Direct answer  "))

    expect(btwChatView(result.state, undefined, "s1", "c1")).toMatchObject({
      phase: "answered",
      answer: "Direct answer",
      duration: 450,
    })
    expect(result.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "persist-answer", id: "c1", answer: "Direct answer", duration: 450, agent: "build", model },
    ])
    expect(
      btwChatView(transitionBtw(play(createBtwState(), asked).state, succeeded(1, "x", 10)).state, [], "s1", "c1"),
    ).toMatchObject({ duration: 0 })
  })

  test("asking stores the question, opens its tab and starts one attempt", () => {
    expect(transitionBtw(createBtwState(), asked).effects).toEqual([
      { type: "persist-question", id: "c1", question: "Why?", created: 1_000, agent: "build", model },
      { type: "open-tab", id: "c1" },
      { type: "generate", id: "c1", attempt: 1, question: "Why?", timeout: BTW_GENERATE_TIMEOUT_MS },
    ])

    const running = play(createBtwState(), asked).state

    expect(transitionBtw(running, asked).state).toBe(running)
    expect(transitionBtw(createBtwState(), { ...asked, question: "  " }).effects).toEqual([])
  })

  test("retry starts only from a failure", () => {
    const running = play(createBtwState(), asked).state
    const answered = transitionBtw(running, succeeded(1, "A")).state

    expect(transitionBtw(running, retried()).state).toBe(running)
    expect(transitionBtw(answered, retried()).state).toBe(answered)
    expect(transitionBtw(createBtwState(), retried()).effects).toEqual([])
    expect(transitionBtw(createBtwState(), retried({ id: "c1", question: "Why?", answer: "A" })).effects).toEqual([])
  })

  test("results of an earlier attempt never settle a retry", () => {
    const retrying = play(
      createBtwState(),
      asked,
      { type: "generate.timed-out", sessionKey: "s1", id: "c1", attempt: 1 },
      retried(),
    ).state

    const stale: BtwEvent[] = [
      succeeded(1, "Old"),
      { type: "generate.failed", sessionKey: "s1", id: "c1", attempt: 1, message: "Old" },
      { type: "generate.timed-out", sessionKey: "s1", id: "c1", attempt: 1 },
    ]

    stale.forEach((event) => expect(transitionBtw(retrying, event).state).toBe(retrying))
  })

  test("a server error keeps its message until the retry, and a blank message reads as none", () => {
    const failed = play(createBtwState(), asked, {
      type: "generate.failed",
      sessionKey: "s1",
      id: "c1",
      attempt: 1,
      message: " 429 Too Many Requests ",
    }).state

    expect(btwChatView(failed, [], "s1", "c1")).toMatchObject({
      failure: { reason: "error", message: "429 Too Many Requests" },
    })
    expect(btwChatView(transitionBtw(failed, retried()).state, [], "s1", "c1").phase).toBe("running")

    const blank = play(createBtwState(), asked, {
      type: "generate.failed",
      sessionKey: "s1",
      id: "c1",
      attempt: 1,
      message: "  ",
    }).state

    expect(btwChatView(blank, [], "s1", "c1")).toMatchObject({ failure: { reason: "error", message: undefined } })
  })
})

describe("exits", () => {
  test("closing a running chat's tab ends its request and forgets it", () => {
    const removed = transitionBtw(play(createBtwState(), asked).state, {
      type: "chat.removed",
      sessionKey: "s1",
      id: "c1",
    })

    expect(removed.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "delete-chat", id: "c1" },
    ])
    expect(removed.state).toEqual({ status: "active", issued: 1, sessions: new Map() })
    expect(transitionBtw(removed.state, succeeded(1, "Late")).state).toBe(removed.state)

    const restored = createBtwState()
    const forgotten = transitionBtw(restored, { type: "chat.removed", sessionKey: "s1", id: "c1" })

    expect(forgotten.state).toBe(restored)
    expect(forgotten.effects).toEqual([{ type: "delete-chat", id: "c1" }])
  })

  test("closing a session ends only its requests", () => {
    const both = play(createBtwState(), asked, { ...asked, sessionKey: "s2", id: "c2" }).state
    const pruned = transitionBtw(both, { type: "sessions.pruned", keep: new Set(["s2"]) })

    expect(pruned.effects).toEqual([{ type: "abort", attempt: 1 }])
    expect(btwChatView(pruned.state, undefined, "s1", "c1")).toEqual({ phase: "loading" })
    expect(btwChatView(pruned.state, undefined, "s2", "c2").phase).toBe("running")
    expect(transitionBtw(pruned.state, { type: "sessions.pruned", keep: new Set(["s2"]) }).state).toBe(pruned.state)
  })

  test("disposing ends every request and ignores everything after", () => {
    const disposed = transitionBtw(play(createBtwState(), asked, { ...asked, sessionKey: "s2", id: "c2" }).state, {
      type: "disposed",
    })

    expect(disposed.state).toEqual({ status: "disposed" })
    expect(disposed.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "abort", attempt: 2 },
    ])
    const later: BtwEvent[] = [asked, retried(), succeeded(1, "Late"), { type: "disposed" }]

    later.forEach((event) => expect(transitionBtw(disposed.state, event).state).toBe(disposed.state))
  })
})

describe("threads", () => {
  const follow: BtwEvent = {
    type: "chat.asked",
    sessionKey: "s1",
    id: "c2",
    thread: "c1",
    question: "  And then?  ",
    created: 1_100,
    agent: "build",
    model,
  }

  test("a follow-up stores its turn without opening another tab", () => {
    const transitioned = transitionBtw(play(createBtwState(), asked).state, follow)

    expect(transitioned.effects).toEqual([
      {
        type: "persist-question",
        id: "c2",
        thread: "c1",
        question: "And then?",
        created: 1_100,
        agent: "build",
        model,
      },
      { type: "generate", id: "c2", attempt: 2, thread: "c1", question: "And then?", timeout: BTW_GENERATE_TIMEOUT_MS },
    ])
  })

  test("a thread reads its stored turns in order and keeps its first question as the title", () => {
    const stored: BtwSavedChat[] = [
      { id: "t1", question: "First?", answer: "One." },
      { id: "t2", thread: "t1", question: "Then?", answer: "Two." },
      { id: "other", question: "Another tab" },
    ]

    const view = btwThreadView(createBtwState(), stored, "s1", "t1")

    expect(view.phase).toBe("ready")

    if (view.phase !== "ready") return

    expect(view.busy).toBe(false)
    expect(view.turns.map((turn) => turn.id)).toEqual(["t1", "t2"])
    expect(view.turns[1]?.view).toMatchObject({ phase: "answered", answer: "Two." })
    expect(btwTabView(createBtwState(), stored, "s1", "t1")).toEqual({ status: "ready", question: "First?" })
  })

  test("a live thread before the store loads is ready, and busy while it runs", () => {
    const running = play(createBtwState(), asked).state
    const started = btwThreadView(running, undefined, "s1", "c1")

    expect(started).toMatchObject({ phase: "ready", busy: true })
    expect(btwCanFollow(started)).toBe(false)
    expect(btwTabView(running, undefined, "s1", "c1")).toEqual({ status: "ready", question: "Why?" })

    const answered = transitionBtw(running, succeeded(1, "Because.")).state
    const finished = btwThreadView(answered, undefined, "s1", "c1")

    expect(finished).toMatchObject({ phase: "ready", busy: false })
    expect(btwCanFollow(finished)).toBe(true)
  })

  test("a restored tab waits for its store before it can follow up", () => {
    const loading = btwThreadView(createBtwState(), undefined, "s1", "c1")
    const missing = btwThreadView(createBtwState(), [], "s1", "c1")

    expect(loading).toEqual({ phase: "loading" })
    expect(missing).toEqual({ phase: "missing" })
    expect(btwCanFollow(loading)).toBe(false)
    expect(btwCanFollow(missing)).toBe(false)
  })

  test("an opened side chat is ready before its first question", () => {
    const empty = btwThreadView(createBtwState(), undefined, "s1", "c1", true)

    expect(empty).toEqual({ phase: "ready", busy: false, turns: [] })
    expect(btwCanFollow(empty)).toBe(true)
    expect(btwTabView(createBtwState(), undefined, "s1", "c1", true)).toEqual({ status: "ready", question: "" })
  })

  test("a turn belongs to its first question or its thread", () => {
    expect(btwKeepsChat({ id: "other" }, "c1")).toBe(true)
    expect(btwKeepsChat({ id: "c1" }, "c1")).toBe(false)
    expect(btwKeepsChat({ id: "c2", thread: "c1" }, "c1")).toBe(false)
  })

  test("closing a tab ends every running turn of its thread and forgets them", () => {
    const state = play(createBtwState(), asked, follow).state
    const removed = transitionBtw(state, { type: "chat.removed", sessionKey: "s1", id: "c1" })

    expect(removed.effects).toEqual([
      { type: "abort", attempt: 1 },
      { type: "abort", attempt: 2 },
      { type: "delete-chat", id: "c1" },
    ])
    expect(btwChatView(removed.state, undefined, "s1", "c2")).toEqual({ phase: "loading" })
  })

  test("retrying a follow-up keeps its thread", () => {
    const failed = play(createBtwState(), asked, follow, {
      type: "generate.failed",
      sessionKey: "s1",
      id: "c2",
      attempt: 2,
      message: "Offline",
    }).state

    expect(transitionBtw(failed, { type: "chat.retried", sessionKey: "s1", id: "c2", now: 2_000 }).effects).toEqual([
      { type: "generate", id: "c2", attempt: 3, thread: "c1", question: "And then?", timeout: BTW_GENERATE_TIMEOUT_MS },
    ])
  })
})

describe("prompt", () => {
  test("a first turn sends only the instructions and the question", () => {
    expect(btwPrompt([], "Why?")).toBe(`${BTW_INSTRUCTIONS}\n\nWhy?`)
  })

  test("a follow-up replays only the newest answered pairs", () => {
    const history = Array.from({ length: BTW_HISTORY_TURNS + 2 }, (_, index) => ({
      question: `old ${index + 1}`,
      answer: `answer ${index + 1}`,
    }))

    const prompt = btwPrompt(history, "new question")

    expect(prompt).toContain("Side conversation so far:")
    expect(prompt).not.toContain("old 1 ")
    expect(prompt).not.toContain("old 2 ")
    expect(prompt).toContain("old 3 ")
    expect(prompt).toContain(`old ${BTW_HISTORY_TURNS + 2} `)
    expect(prompt).toContain("Q: new question")
    expect(prompt.indexOf("old 3 ")).toBeLessThan(prompt.indexOf(`old ${BTW_HISTORY_TURNS + 2} `))
  })

  test("Enter sends unless Shift or an IME is involved", () => {
    const enter = { key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 }

    expect(btwSubmitsOnEnter(enter)).toBe(true)
    expect(btwSubmitsOnEnter({ ...enter, shiftKey: true })).toBe(false)
    expect(btwSubmitsOnEnter({ ...enter, isComposing: true })).toBe(false)
    expect(btwSubmitsOnEnter({ ...enter, keyCode: 229 })).toBe(false)
    expect(btwSubmitsOnEnter({ ...enter, key: "a" })).toBe(false)
  })
})
