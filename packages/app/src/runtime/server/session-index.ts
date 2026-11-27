import type { SessionInfo } from "@opencode/client/promise"
import { newerTime } from "@/session/time"
import { rawTime } from "./data"

/**
 * Merge live metadata into indexed roots. A newer recency on either side wins; only a completed run replaces the
 * rest of an indexed row.
 */
export function mergeRootSessionIndex(indexed: readonly SessionInfo[], known: readonly SessionInfo[]) {
  const rows = new Map(indexed.map((info) => [info.id, info]))

  for (const info of known) {
    const row = rows.get(info.id)

    if (!row) {
      rows.set(info.id, info)
      continue
    }

    // A projected send bump must not reach `apply` as a server time, so copy the raw one.
    const updated = rawTime(row)
    const passive = (info.time.idle ?? 0) <= (row.time.idle ?? 0) && info.time.updated !== updated
    const recency = newerTime(row.time.recency, info.time.recency)

    // Keep the live object identity when nothing else changes.
    if (!passive && recency === info.time.recency) {
      rows.set(info.id, info)
      continue
    }

    const time = passive ? { ...info.time, updated } : { ...info.time }

    if (recency !== undefined) time.recency = recency
    rows.set(info.id, { ...info, time })
  }

  return [...rows.values()].filter((info) => !info.parentID)
}
