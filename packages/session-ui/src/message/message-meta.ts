export type MetaItem = { label: string; variant?: boolean }

// The variant follows the model without a separator, so it reads as part of the model name.
export function formatMetaText(items: readonly MetaItem[], speed?: string) {
  if (items.length === 0) return ""

  const parts = items.flatMap((item, index) => [
    ...(index > 0 && !item.variant ? ["\u00B7"] : []),
    item.label,
  ])

  return [...parts, ...(speed ? ["\u00B7", speed] : [])].join(" ")
}
