import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"
import type { Platform, TaskbarBadgeIcon, TaskbarBadgeUpdate } from "@/runtime/platform/platform"

/** The newest root sessions one taskbar index fetch discovers per server. */
export const TASKBAR_SESSION_INDEX_LIMIT = 50

const CLAIM_TIMEOUT_MS = 3_000

const CLAIM_RETRY_DELAY_MS = 250

const CLAIM_ATTEMPTS = 2

export type TaskbarBadgeId = Pick<TaskbarBadgeUpdate, "mount" | "sequence">

/** The index snapshot and the raw page size, so a full page can report "at least". */
export type TaskbarBadgeIndex = {
  readonly sessions: SessionInfo[]
  readonly fetched: number
}

export type TaskbarBadgeIndexEvent = Extract<
  OpenCodeEvent,
  { type: "session.deleted" | "session.archived" | "session.unarchived" | "session.viewed" }
>

/** The visible badge: the number up to 9, then 9+. */
export function badgeLabel(count: number) {
  return count >= 10 ? "9+" : String(count)
}

/** The taskbar badge exists only on Windows desktop, where both platform methods are available. */
export function taskbarBadgeEnabled(platform: Platform) {
  return (
    platform.platform === "desktop" &&
    platform.os === "windows" &&
    platform.setTaskbarBadge !== undefined &&
    platform.claimTaskbarBadgeMount !== undefined
  )
}

/** No connections to fetch or subscribe to when the platform cannot show a badge. */
export function taskbarBadgeQueryPlan<T>(platform: Platform, connections: readonly T[]) {
  return taskbarBadgeEnabled(platform) ? connections : []
}

/** The total count and whether any fetched index was full, so its count may be a lower bound. */
export function taskbarBadgeSummary(servers: readonly { readonly count: number; readonly capped: boolean }[]) {
  return {
    count: servers.reduce((total, server) => total + server.count, 0),
    atLeast: servers.some((server) => server.capped),
  }
}

/**
 * Claims a window mount id, retrying the local IPC twice. The component aborts the signal on cleanup, so a
 * disposed mount never stores a late id. Returns undefined when every attempt failed or the caller went away.
 */
export async function claimTaskbarBadgeWithRetry(
  claim: (signal: AbortSignal) => Promise<number>,
  signal: AbortSignal,
): Promise<number | undefined> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
    if (signal.aborted) return undefined

    const combined = AbortSignal.any([signal, AbortSignal.timeout(CLAIM_TIMEOUT_MS)])

    try {
      const mount = await claim(combined)

      return signal.aborted ? undefined : mount
    } catch {
      if (signal.aborted) return undefined

      if (attempt + 1 < CLAIM_ATTEMPTS) await delay(CLAIM_RETRY_DELAY_MS, signal)
    }
  }

  return undefined
}

/**
 * Sends one badge update. A current failure clears the overlay with a fresh sequence; a stale attempt neither
 * clears nor reallocates. Sends are independent, so a hung request cannot block a later update.
 */
export async function sendTaskbarBadge(
  platform: Platform,
  id: TaskbarBadgeId,
  count: number,
  description: string,
  draw: (count: number) => readonly TaskbarBadgeIcon[],
  isCurrent: () => boolean = () => true,
  allocate: () => TaskbarBadgeId = () => id,
): Promise<void> {
  const set = platform.setTaskbarBadge

  if (!taskbarBadgeEnabled(platform) || !isCurrent() || !set) return

  const send = (next: TaskbarBadgeId, payload: Pick<TaskbarBadgeUpdate, "count" | "icons" | "description">) =>
    new Promise<void>((resolve) => resolve(set({ ...next, ...payload })))

  const clear = { count: 0, icons: [], description: "" }

  if (count <= 0) {
    await send(id, clear).catch(() => undefined)

    return
  }

  try {
    await send(id, { count, icons: draw(count), description })
  } catch {
    if (!isCurrent()) return
    await send(allocate(), clear).catch(() => undefined)
  }
}

/** Whether an unarchived row is absent from the fetched index and must be loaded before it can count. */
export function taskbarBadgeNeedsSync(
  cached: readonly SessionInfo[] | undefined,
  loaded: boolean,
  sessionID: string,
) {
  return !loaded && !cached?.some((session) => session.id === sessionID)
}

/** Applies a session event to the taskbar index cache; undefined stays undefined. */
export function patchTaskbarIndex(
  sessions: readonly SessionInfo[] | undefined,
  event: TaskbarBadgeIndexEvent,
): SessionInfo[] | undefined {
  if (!sessions) return undefined

  if (event.type === "session.deleted") {
    return sessions.filter((session) => session.id !== event.data.sessionID)
  }

  if (event.type === "session.archived") {
    return sessions.map((session) =>
      session.id === event.data.sessionID
        ? { ...session, time: { ...session.time, archived: event.created } }
        : session,
    )
  }

  if (event.type === "session.unarchived") {
    return sessions.map((session) =>
      session.id === event.data.sessionID ? { ...session, time: { ...session.time, archived: undefined } } : session,
    )
  }

  const idle = event.data.idle

  return sessions.map((session) => {
    if (session.id !== event.data.sessionID) return session

    const viewed = session.time.viewed

    // The first view has no watermark; Math.max(undefined, idle) would write NaN and hide every later run.
    return {
      ...session,
      time: { ...session.time, viewed: viewed === undefined ? idle : Math.max(viewed, idle) },
    }
  })
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()

    const timer = setTimeout(resolve, ms)

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
