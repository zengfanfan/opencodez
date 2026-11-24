import { tokensPerSecondDecimals } from "@opencode/util/session-turn"

export type MetaItem = { label: string; variant?: boolean }

// Only values below 10 whose first decimal survives rounding get a decimal; everything else reads as a whole number.
export function formatTokensPerSecond(value: number, locale: string) {
  const fractionDigits = tokensPerSecondDecimals(value)

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

// The variant follows the model without a separator, so it reads as part of the model name.
export function formatMetaText(items: readonly MetaItem[], speed?: string) {
  if (items.length === 0) return ""

  const parts = items.flatMap((item, index) => [
    ...(index > 0 && !item.variant ? ["\u00B7"] : []),
    item.label,
  ])

  return [...parts, ...(speed ? ["\u00B7", speed] : [])].join(" ")
}
