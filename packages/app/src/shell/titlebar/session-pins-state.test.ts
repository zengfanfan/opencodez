import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Persistence } from "@/runtime/persistence/schema"
import {
  applyUnpin,
  normalizeCozyOrder,
  PinsState,
  removeCozySessionSlot,
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
