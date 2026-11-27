import { expect, test } from "bun:test"
import type { CommandPaletteEntry } from "./palette"
import { rankCommandPaletteEntries } from "./search"

const session = (id: string, updated: number): CommandPaletteEntry => ({
  id: `session:${id}`,
  type: "session",
  title: id,
  category: "Session",
  sessionID: id,
  updated,
})

test("a session entry without recency does not fall back to updated", () => {
  const entries = [session("slow", 100), session("busy", 900)]

  expect(rankCommandPaletteEntries(entries, () => false).map((entry) => entry.id)).toEqual([
    "session:slow",
    "session:busy",
  ])
})

test("sessions order by the last user prompt, not activity", () => {
  const olderPrompt = { ...session("older", 900), recency: 100 }
  const newerPrompt = { ...session("newer", 100), recency: 300 }

  expect(rankCommandPaletteEntries([olderPrompt, newerPrompt], () => false).map((entry) => entry.id)).toEqual([
    "session:newer",
    "session:older",
  ])
})
