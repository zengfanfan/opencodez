import { describe, expect, test } from "bun:test"
import { formatMetaText } from "./message-meta"

describe("formatMetaText", () => {
  test("joins items with the separator and keeps the variant with its model", () => {
    expect(
      formatMetaText(
        [
          { label: "Plan" },
          { label: "Claude Sonnet 4" },
          { label: "Balanced", variant: true },
          { label: "4s" },
        ],
        "60.0 tok/s",
      ),
    ).toBe("Plan · Claude Sonnet 4 Balanced · 4s · 60.0 tok/s")
  })

  test("does not lead with a separator when the first item is a variant", () => {
    expect(formatMetaText([{ label: "Balanced", variant: true }, { label: "4s" }])).toBe("Balanced · 4s")
  })

  test("ignores speed when there is no meta", () => {
    expect(formatMetaText([], "60.0 tok/s")).toBe("")
  })
})
