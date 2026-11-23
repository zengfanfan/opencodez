import { describe, expect, test } from "bun:test"
import { selectScrollRestore, type ScrollRecord } from "./scroll-record"

const record: ScrollRecord = { following: false, offset: 732, presentationKey: "detail:a" }

describe("selectScrollRestore", () => {
  test("returns to the end without a record", () => {
    expect(selectScrollRestore(undefined, "detail:a")).toEqual({ type: "end" })
  })

  test("returns to the end when the reader was following", () => {
    expect(selectScrollRestore({ ...record, following: true }, "detail:a")).toEqual({ type: "end" })
  })

  test("restores a detached offset", () => {
    expect(selectScrollRestore(record, "detail:a")).toEqual({ type: "offset", offset: 732 })
  })

  test("does not restore across a different presentation", () => {
    expect(selectScrollRestore(record, "detail:b")).toEqual({ type: "end" })
  })
})
