import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import {
  appendKey,
  applyUnpin,
  dedupePinKeys,
  insertPinGroupAt,
  insertVisible,
  moveRecentToFront,
  normalizeCozyOrder,
  normalizeRecentOrder,
  PinsState,
  pinGroups,
  pinProjectAt,
  pinSessionAt,
  removeCozySessionSlot,
  reorderPinGroups,
  unpinProjectAt,
  unpinSessionAt,
  withCozyPin,
  withoutCozyPin,
} from "./session-pins-state"

const identity = (server: string, sessionID: string) => `${server === "http://127.0.0.1:4096" ? "sidecar" : server}\0${sessionID}`

describe("PinsState", () => {
  test("keeps existing pins when the stored document has no cozy field", () => {
    const decoded = Schema.decodeUnknownSync(Persistence.withInitial(PinsState, { pins: [], cozy: [] }))({
      pins: ["sidecar\u0000ses_one"],
    })

    expect(decoded.pins).toEqual(["sidecar\u0000ses_one"])
    expect(decoded.cozy).toEqual([])
  })

  test("drops invalid stored values without discarding the pins array", () => {
    const decoded = Schema.decodeUnknownSync(Persistence.withInitial(PinsState, { pins: [], cozy: [] }))({
      pins: ["sidecar\u0000ses_one", 42, "sidecar\u0000ses_two"],
      cozy: ["s:sidecar\u0000ses_one", "nonsense"],
    })

    expect(decoded.pins).toEqual(["sidecar\u0000ses_one", "sidecar\u0000ses_two"])
    // The schema keeps strings; `normalizeCozyOrder` drops malformed parse entries.
    expect(decoded.cozy).toEqual(["s:sidecar\u0000ses_one", "nonsense"])
  })
})

describe("normalizeCozyOrder", () => {
  test("rewrites endpoint aliases to the current identity and removes duplicates", () => {
    expect(
      normalizeCozyOrder(
        [
          "p:sidecar\u0000C:/work",
          "s:http://127.0.0.1:4096\u0000ses_one",
          "s:sidecar\u0000ses_one",
          "s:other\u0000ses_two",
          "bad",
        ],
        identity,
      ),
    ).toEqual(["p:sidecar\u0000C:/work", "s:sidecar\u0000ses_one", "s:other\u0000ses_two"])
  })
})

describe("normalizeRecentOrder", () => {
  test("rewrites endpoint aliases and drops malformed or duplicate identities", () => {
    expect(
      normalizeRecentOrder(
        [
          "http://127.0.0.1:4096\u0000ses_one",
          "sidecar\u0000ses_one",
          "other\u0000ses_two",
          "bad",
        ],
        identity,
      ),
    ).toEqual(["sidecar\u0000ses_one", "other\u0000ses_two"])
  })
})

describe("moveRecentToFront", () => {
  test("moves the speaking sessions to the front and keeps the rest", () => {
    expect(
      moveRecentToFront(["sidecar\u0000a", "sidecar\u0000b", "sidecar\u0000c"], ["sidecar\u0000c", "sidecar\u0000a"]),
    ).toEqual(["sidecar\u0000c", "sidecar\u0000a", "sidecar\u0000b"])
  })
})

describe("removeCozySessionSlot", () => {
  test("removes only the matching session and keeps projects", () => {
    expect(
      removeCozySessionSlot(
        ["s:sidecar\u0000ses_one", "p:sidecar\u0000C:/work", "s:sidecar\u0000ses_two"],
        "sidecar\u0000ses_one",
        identity,
      ),
    ).toEqual(["p:sidecar\u0000C:/work", "s:sidecar\u0000ses_two"])
  })
})

describe("applyUnpin", () => {
  test("updates pins and cozy in one state object", () => {
    expect(
      applyUnpin(
        {
          pins: ["sidecar\u0000ses_one", "sidecar\u0000ses_two"],
          cozy: ["s:sidecar\u0000ses_one", "p:sidecar\u0000C:/work"],
        },
        ["sidecar\u0000ses_two"],
        "sidecar",
        "ses_one",
        identity,
      ),
    ).toEqual({
      pins: ["sidecar\u0000ses_two"],
      cozy: ["p:sidecar\u0000C:/work"],
    })
  })

  test("works while cozy is undefined", () => {
    expect(applyUnpin({ pins: ["sidecar\u0000ses_one"] }, [], "sidecar", "ses_one", identity)).toEqual({
      pins: [],
      cozy: [],
    })
  })
})

describe("mixed order helpers", () => {
  test("appends a missing pin and does not duplicate an existing one", () => {
    expect(withCozyPin(undefined, "p:sidecar\u0000C:/work")).toEqual(["p:sidecar\u0000C:/work"])
    expect(withCozyPin(["p:sidecar\u0000C:/work"], "p:sidecar\u0000C:/work")).toEqual(["p:sidecar\u0000C:/work"])
    expect(withoutCozyPin(["p:sidecar\u0000C:/work", "s:sidecar\u0000ses"], "p:sidecar\u0000C:/work")).toEqual([
      "s:sidecar\u0000ses",
    ])
  })
})

describe("pin key groups", () => {
  const alias = "http://127.0.0.1:4096\u0000A"
  const sidecarA = "sidecar\u0000A"
  const sidecarB = "sidecar\u0000B"

  const localCandidates = (server: string) => {
    if (server === "http://127.0.0.1:4096") return [server, "sidecar"]

    if (server === "sidecar") return ["sidecar", "http://127.0.0.1:4096"]

    return [server]
  }

  const localRank = (key: string) => {
    if (key === "sidecar") return 0

    if (key === "http://127.0.0.1:4096") return 2

    return 5
  }

  test("groups aliases while keeping every raw key", () => {
    expect(pinGroups([alias, sidecarA, sidecarB], identity)).toEqual([
      { id: "sidecar\u0000A", keys: [alias, sidecarA] },
      { id: "sidecar\u0000B", keys: [sidecarB] },
    ])
  })

  test("prefers a visible sidecar over a local HTTP alias in either order", () => {
    expect(dedupePinKeys([alias, sidecarA], identity, localCandidates, localRank)).toEqual([sidecarA])
    expect(dedupePinKeys([sidecarA, alias], identity, localCandidates, localRank)).toEqual([sidecarA])
    expect(
      dedupePinKeys([alias, sidecarA], identity, localCandidates, (key) =>
        key === "http://127.0.0.1:4096" ? 4 : 0,
      ),
    ).toEqual([sidecarA])
    expect(
      dedupePinKeys([alias, sidecarA], identity, localCandidates, (key) =>
        key === "sidecar" ? 4 : 2,
      ),
    ).toEqual([alias])
  })

  test("prefers a plugin connection key over its tunnel URL in either order", () => {
    const tunnel = "http://tunnel\u0000A"
    const ssh = "ssh:foo\u0000A"

    const pluginIdentity = (server: string, sessionID: string) =>
      `${server === "http://tunnel" ? "ssh:foo" : server}\u0000${sessionID}`

    const candidates = (server: string) => {
      if (server === "http://tunnel") return [server, "ssh:foo"]

      if (server === "ssh:foo") return ["ssh:foo", "http://tunnel"]

      return [server]
    }

    const rank = (key: string) => {
      if (key === "ssh:foo") return 1

      if (key === "http://tunnel") return 2

      return 5
    }

    expect(dedupePinKeys([tunnel, ssh], pluginIdentity, candidates, rank)).toEqual([ssh])
    expect(dedupePinKeys([ssh, tunnel], pluginIdentity, candidates, rank)).toEqual([ssh])
    expect(dedupePinKeys([tunnel], pluginIdentity, candidates, rank)).toEqual([ssh])
  })

  test("keeps the first group order and drops malformed keys", () => {
    expect(dedupePinKeys([sidecarB, "bad", sidecarA, alias], identity, localCandidates, localRank)).toEqual([
      sidecarB,
      sidecarA,
    ])
  })

  test("inserts a group at an ordinal without losing other aliases", () => {
    expect(insertPinGroupAt([alias, sidecarB], "sidecar\u0000C", identity, 1)).toEqual([
      alias,
      "sidecar\u0000C",
      sidecarB,
    ])
    expect(insertPinGroupAt([alias, sidecarB], "sidecar\u0000C", identity, -1)).toEqual([
      "sidecar\u0000C",
      alias,
      sidecarB,
    ])
    expect(insertPinGroupAt([alias, sidecarB], "sidecar\u0000C", identity, 99)).toEqual([
      alias,
      sidecarB,
      "sidecar\u0000C",
    ])
  })

  test("reorders visible groups while hiding aliases with their group", () => {
    const result = reorderPinGroups(
      [alias, sidecarA, sidecarB, "sidecar\u0000C"],
      ["sidecar\u0000A", "sidecar\u0000B"],
      ["sidecar\u0000B", "sidecar\u0000A"],
      identity,
    )

    expect(pinGroups(result, identity)).toEqual([
      { id: "sidecar\u0000B", keys: ["sidecar\u0000B"] },
      { id: "sidecar\u0000A", keys: [alias, sidecarA] },
      { id: "sidecar\u0000C", keys: ["sidecar\u0000C"] },
    ])
    expect(reorderPinGroups([sidecarA], ["sidecar\u0000A"], ["sidecar\u0000A", "sidecar\u0000A"], identity)).toEqual([
      sidecarA,
    ])
  })
})

describe("visible insertion", () => {
  test("inserts before a visible row and appends past the page", () => {
    expect(insertVisible(["a", "b", "c"], ["a", "b"], "x", 1)).toEqual(["a", "x", "b", "c"])
    expect(insertVisible(["a", "b", "c"], ["a"], "x", 1)).toEqual(["a", "x", "b", "c"])
    expect(insertVisible([], [], "x", 0)).toEqual(["x"])
    expect(appendKey(["a", "b"], "a")).toEqual(["b", "a"])
  })
})

describe("cross-group pin state", () => {
  const alias = "http://127.0.0.1:4096\u0000A"
  const pins = ["sidecar\u0000A", "sidecar\u0000B"]
  const cozy = ["s:sidecar\u0000A", "s:sidecar\u0000B"]

  test("pinSessionAt appends after aliases and keeps the mixed order", () => {
    const result = pinSessionAt({
      state: { pins: [alias, "sidecar\u0000B"], cozy },
      server: "sidecar",
      sessionID: "C",
      identity: "sidecar\u0000C",
      index: 2,
      base: ["s:sidecar\u0000A", "s:sidecar\u0000B"],
      visible: ["s:sidecar\u0000A", "s:sidecar\u0000B"],
      identityOf: identity,
    })

    expect(pinGroups(result.pins, identity).map((group) => group.id)).toEqual([
      "sidecar\u0000A",
      "sidecar\u0000B",
      "sidecar\u0000C",
    ])
    expect(result.cozy).toEqual(["s:sidecar\u0000A", "s:sidecar\u0000B", "s:sidecar\u0000C"])
  })

  test("pinSessionAt inserts between sessions after an alias", () => {
    const result = pinSessionAt({
      state: {
        pins: ["sidecar\u0000A", alias, "sidecar\u0000B", "sidecar\u0000C"],
        cozy: ["s:sidecar\u0000A", "s:sidecar\u0000B", "s:sidecar\u0000C"],
      },
      server: "sidecar",
      sessionID: "D",
      identity: "sidecar\u0000D",
      index: 2,
      base: ["s:sidecar\u0000A", "s:sidecar\u0000B", "s:sidecar\u0000C"],
      visible: ["s:sidecar\u0000A", "s:sidecar\u0000B", "s:sidecar\u0000C"],
      identityOf: identity,
    })

    expect(result.cozy).toEqual(["s:sidecar\u0000A", "s:sidecar\u0000B", "s:sidecar\u0000D", "s:sidecar\u0000C"])
    expect(pinGroups(result.pins, identity).map((group) => group.id)).toEqual([
      "sidecar\u0000A",
      "sidecar\u0000B",
      "sidecar\u0000D",
      "sidecar\u0000C",
    ])
  })

  test("pinSessionAt inserts a session between project and session rows", () => {
    const result = pinSessionAt({
      state: { pins, cozy: ["p:sidecar\u0000C:/p", "s:sidecar\u0000A", "s:sidecar\u0000B"] },
      server: "sidecar",
      sessionID: "C",
      identity: "sidecar\u0000C",
      index: 2,
      base: ["p:sidecar\u0000C:/p", "s:sidecar\u0000A", "s:sidecar\u0000B"],
      visible: ["p:sidecar\u0000C:/p", "s:sidecar\u0000A", "s:sidecar\u0000B"],
      identityOf: identity,
    })

    expect(result.cozy).toEqual(["p:sidecar\u0000C:/p", "s:sidecar\u0000A", "s:sidecar\u0000C", "s:sidecar\u0000B"])
    expect(pinGroups(result.pins, identity).map((group) => group.id)).toEqual([
      "sidecar\u0000A",
      "sidecar\u0000C",
      "sidecar\u0000B",
    ])
  })

  test("unpinSessionAt removes aliases and appends to the complete recent order", () => {
    const result = unpinSessionAt({
      state: {
        pins: [alias, "sidecar\u0000B"],
        cozy: ["s:sidecar\u0000A", "p:sidecar\u0000C:/p"],
        recent: ["sidecar\u0000C"],
      },
      server: "sidecar",
      sessionID: "A",
      identity: "sidecar\u0000A",
      index: 2,
      recentBase: ["sidecar\u0000C", "sidecar\u0000B"],
      recentVisible: ["sidecar\u0000C"],
      identityOf: identity,
    })

    expect(result.pins).toEqual(["sidecar\u0000B"])
    expect(result.cozy).toEqual(["p:sidecar\u0000C:/p"])
    expect(result.recent).toEqual(["sidecar\u0000C", "sidecar\u0000B", "sidecar\u0000A"])
  })

  test("project pin insertion and removal preserve the complete project order", () => {
    const pinned = pinProjectAt({
      state: { cozy: ["p:sidecar\u0000C:/p", "s:sidecar\u0000A"] },
      projectKey: "sidecar\u0000C:/q",
      index: 1,
      base: ["p:sidecar\u0000C:/p", "s:sidecar\u0000A"],
      visible: ["p:sidecar\u0000C:/p", "s:sidecar\u0000A"],
    })

    expect(pinned.cozy).toEqual(["p:sidecar\u0000C:/p", "p:sidecar\u0000C:/q", "s:sidecar\u0000A"])

    const unpinned = unpinProjectAt({
      state: { cozy: ["p:sidecar\u0000C:/p", "p:sidecar\u0000C:/q"] },
      projectKey: "sidecar\u0000C:/p",
      server: "sidecar",
      worktree: "C:/p",
      index: 1,
      projectOrder: ["C:/p", "C:/q", "C:/r"],
      visible: ["C:/q", "C:/r"],
    })

    expect(unpinned.order).toEqual(["C:/q", "C:/p", "C:/r"])
    expect(unpinned.cozy).toEqual(["p:sidecar\u0000C:/q"])
  })
})
