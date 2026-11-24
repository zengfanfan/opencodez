import { describe, expect, test } from "bun:test"
import { formatMetaText, formatTokensPerSecond } from "./message-meta"

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

describe("formatTokensPerSecond", () => {
  test("keeps one decimal only below ten when the first decimal survives rounding", () => {
    expect(formatTokensPerSecond(9.44, "en-US")).toBe("9.4")
    expect(formatTokensPerSecond(9.04, "en-US")).toBe("9")
    expect(formatTokensPerSecond(9.96, "en-US")).toBe("10")
    expect(formatTokensPerSecond(10.4, "en-US")).toBe("10")
    expect(formatTokensPerSecond(0.06, "en-US")).toBe("0.1")
    expect(formatTokensPerSecond(0.04, "en-US")).toBe("0")
    expect(formatTokensPerSecond(60, "en-US")).toBe("60")
  })
})
