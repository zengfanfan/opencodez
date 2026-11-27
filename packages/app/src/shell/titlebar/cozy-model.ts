import type { Project } from "@/runtime/server/types"
import type { ServerConnection } from "@/runtime/server/registry"
import { sessionRecency } from "@/session/time"
import type { InboxEntry } from "./inbox-model"

export type CozyProjectKey = string

export type CozyProjectInfo = {
  key: CozyProjectKey
  conn: ServerConnection.Any
  server: ServerConnection.Key
  project: Project
}

export type CozySession = {
  key: string
  entry: InboxEntry
  pinned: boolean
}

export type CozyProject = CozyProjectInfo & {
  pinned: boolean
  sessions: CozySession[]
}

export type CozyPinnedRef = { kind: "project"; key: CozyProjectKey } | { kind: "session"; key: string }

export type CozyDragData =
  | {
      kind: "session"
      key: string
      server: string
      sessionID: string
      projectKey: string | undefined
      recency: number | undefined
    }
  | {
      kind: "project"
      key: string
      server: string
      worktree: string
    }

/** Whether a Cozy row can be dropped into a group without leaving a row in an invisible place. */
export function cozyDropAllowed(input: {
  source: CozyDragData
  from: string | undefined
  to: string
  pinnedProjects: ReadonlySet<string>
  projectKeys: ReadonlySet<string>
}) {
  if (input.source.kind === "session") {
    if (input.to === "pinned") return true

    if (input.to !== "recent") return false

    if (input.from === "recent") return true

    if (input.from !== "pinned" || !input.source.projectKey) return false

    return input.projectKeys.has(input.source.projectKey) && !input.pinnedProjects.has(input.source.projectKey)
  }

  if (input.to === "pinned") return true

  if (input.to === "recent") return false

  if (!input.to.startsWith("projects:")) return false

  const server = input.to.slice("projects:".length)

  return input.source.server === server && (input.from === "pinned" || input.from === input.to)
}


export type CozyItem =
  | { kind: "project"; project: CozyProject; count: number }
  | { kind: "session"; session: CozySession }

export type CozyPartition = {
  server: ServerConnection.Key
  label?: string
  items: CozyProject[]
}

export type CozyView = {
  pinned: CozyItem[]
  projects: CozyPartition[]
  recent: CozySession[]
  projectsByKey: Map<CozyProjectKey, CozyProject>
}

export function cozyProjectKey(server: ServerConnection.Key, worktree: string) {
  return `${server}\u0000${worktree}`
}

/** New projects go on top; saved projects keep their relative order. */
export function cozyProjectOrder(projects: readonly Project[], saved: readonly string[]) {
  const fresh = projects
    .filter((project) => !saved.includes(project.worktree))
    .toSorted((a, b) => b.time.created - a.time.created || a.worktree.localeCompare(b.worktree))

  const fixed = saved.flatMap((worktree) => projects.find((project) => project.worktree === worktree) ?? [])

  return [...fresh, ...fixed]
}

function compareSessions(a: CozySession, b: CozySession) {
  const recency = sessionRecency(b.entry.session) - sessionRecency(a.entry.session)

  if (recency !== 0) return recency

  return a.entry.session.id.localeCompare(b.entry.session.id)
}

/**
 * Stored Recent order first. A session missing from it is either new or was loaded late: only a recency strictly
 * newer than every stored row earns the top; older rows append after the stored order.
 */
export function orderRecent(items: readonly CozySession[], order: readonly string[]) {
  // Dedupe by key first, keeping the first occurrence. Endpoint aliases can produce the same key twice.
  const unique: CozySession[] = []
  const itemKeys = new Set<string>()

  for (const item of items) {
    if (itemKeys.has(item.key)) continue
    itemKeys.add(item.key)
    unique.push(item)
  }

  const itemByKey = new Map(unique.map((item) => [item.key, item] as const))
  const kept: CozySession[] = []
  const keptKeys = new Set<string>()

  for (const key of order) {
    const item = itemByKey.get(key)

    if (!item || keptKeys.has(key)) continue
    keptKeys.add(key)
    kept.push(item)
  }

  const fresh = unique.filter((item) => !keptKeys.has(item.key)).sort(compareSessions)

  const newestKept = kept.reduce(
    (newest, item) => Math.max(newest, sessionRecency(item.entry.session)),
    Number.NEGATIVE_INFINITY,
  )

  const top = fresh.filter((item) => sessionRecency(item.entry.session) > newestKept)
  const tail = fresh.filter((item) => sessionRecency(item.entry.session) <= newestKept)

  return [...top, ...kept, ...tail]
}

/**
 * Sessions that should move to the front: known ones whose last user prompt advanced. New or late-loaded rows are
 * placed by `orderRecent`, never persisted to the front.
 */
export function bumpedRecent(
  known: ReadonlySet<string>,
  seen: ReadonlyMap<string, number>,
  list: readonly { key: string; recency: number | undefined }[],
) {
  return list
    .filter((item) => {
      if (!known.has(item.key) || item.recency === undefined) return false
      const previous = seen.get(item.key)

      return previous !== undefined && item.recency > previous
    })
    .sort((a, b) => (b.recency ?? 0) - (a.recency ?? 0))
    .map((item) => item.key)
}

/** Remembers the highest recency each row has shown, so a temporary dip cannot look like a new prompt. */
export function rememberRecentRecency(
  seen: Map<string, number>,
  list: readonly { key: string; recency: number | undefined }[],
) {
  for (const item of list) {
    if (item.recency === undefined) continue
    seen.set(item.key, Math.max(seen.get(item.key) ?? item.recency, item.recency))
  }
}

/** Groups sessions into pinned, per-project, and recent lists. */
export function cozyPlacement(input: {
  entries: readonly InboxEntry[]
  projects: readonly CozyProjectInfo[]
  resolveProject: (entry: InboxEntry) => string | undefined
  sessionKey: (entry: InboxEntry) => string
  pinnedSessions: ReadonlySet<string>
  pinnedProjects: ReadonlySet<string>
  pinnedOrder: readonly CozyPinnedRef[]
  recentOrder?: readonly string[]
}): CozyView {
  const projectsByKey = new Map<CozyProjectKey, CozyProject>(
    input.projects.map((project) => [project.key, { ...project, pinned: false, sessions: [] }]),
  )

  const entriesByKey = new Map(input.entries.map((entry) => [input.sessionKey(entry), entry]))
  const recent: CozySession[] = []

  for (const entry of input.entries) {
    const key = input.sessionKey(entry)

    if (input.pinnedSessions.has(key)) {
      continue
    }

    const projectKey = input.resolveProject(entry)

    if (!projectKey) continue
    const project = projectsByKey.get(projectKey)

    if (!project) continue

    // A pinned project owns its sessions. Every other session shows in both Recent and its project.
    project.sessions.push({ key, entry, pinned: false })

    if (!input.pinnedProjects.has(projectKey)) recent.push({ key, entry, pinned: false })
  }

  for (const project of projectsByKey.values()) {
    project.sessions.sort(compareSessions)
    project.pinned = input.pinnedProjects.has(project.key)
  }

  // The stored mixed order decides where projects and sessions sit. Anything missing is appended.
  const ordered: CozyItem[] = []
  const usedProjects = new Set<string>()

  for (const ref of input.pinnedOrder) {
    if (ref.kind === "project") {
      const project = projectsByKey.get(ref.key)

      if (!project || !project.pinned || usedProjects.has(ref.key)) continue
      usedProjects.add(ref.key)
      ordered.push({ kind: "project", project, count: project.sessions.length })
      continue
    }

    if (!input.pinnedSessions.has(ref.key)) continue
    const entry = entriesByKey.get(ref.key)

    if (entry) ordered.push({ kind: "session", session: { key: ref.key, entry, pinned: true } })
  }

  const orderedSessions = new Set(ordered.flatMap((item) => (item.kind === "session" ? [item.session.key] : [])))

  for (const entry of input.entries) {
    if (!input.pinnedSessions.has(input.sessionKey(entry))) continue
    const key = input.sessionKey(entry)

    if (orderedSessions.has(key)) continue
    ordered.push({ kind: "session", session: { key, entry, pinned: true } })
  }

  for (const project of projectsByKey.values()) {
    if (!project.pinned || usedProjects.has(project.key)) continue
    ordered.push({ kind: "project", project, count: project.sessions.length })
  }

  const partitions = new Map<ServerConnection.Key, CozyPartition>()

  for (const project of projectsByKey.values()) {
    if (project.pinned) continue
    const partition = partitions.get(project.server) ?? { server: project.server, items: [] }

    partition.items.push(project)
    partitions.set(project.server, partition)
  }

  return {
    pinned: ordered,
    projects: [...partitions.values()],
    recent: orderRecent(recent, input.recentOrder ?? []),
    projectsByKey,
  }
}

/** The stored pin order merged with the current pins: stale session slots are removed, missing pins appended. */
export function cozyMixPins(input: {
  stored: readonly string[]
  pinnedProjects: ReadonlySet<string>
  sessions: readonly string[]
}) {
  const projects = new Set(input.pinnedProjects)
  const sessions = new Set(input.sessions)

  const kept = input.stored.filter((key) =>
    key.startsWith("p:") ? projects.has(key.slice(2)) : sessions.has(key.slice(2)),
  )

  const result: string[] = []
  const usedSessions = new Set<string>()

  for (const key of kept) {
    if (key.startsWith("p:")) {
      if (!result.includes(key)) result.push(key)
      continue
    }

    const next = input.sessions.find((session) => !usedSessions.has(session))

    if (!next) continue
    usedSessions.add(next)
    result.push(`s:${next}`)
  }

  for (const session of input.sessions) {
    if (!usedSessions.has(session)) result.push(`s:${session}`)
  }

  for (const project of input.pinnedProjects) {
    const key = `p:${project}`

    if (!result.includes(key)) result.push(key)
  }

  return result
}

/** Drops session slots that no longer have a pin. Project slots always stay. */
export function cozyCleanPins(input: { ready: boolean; stored: readonly string[]; sessions: readonly string[] }) {
  if (!input.ready) return undefined
  const sessions = new Set(input.sessions)

  return input.stored.filter((key) => !key.startsWith("s:") || sessions.has(key.slice(2)))
}

export function reorderCozyPins(order: readonly string[], visible: readonly string[], nextVisible: readonly string[]) {
  if (nextVisible.length !== visible.length || new Set(nextVisible).size !== nextVisible.length) return [...order]
  const shown = new Set(visible)

  if (nextVisible.some((key) => !shown.has(key))) return [...order]
  let index = 0

  return order.map((key) => (shown.has(key) ? nextVisible[index++] : key))
}

export function reorderProjectOrder(
  order: readonly string[],
  visible: readonly string[],
  nextVisible: readonly string[],
) {
  if (nextVisible.length !== visible.length || new Set(nextVisible).size !== nextVisible.length) return [...order]
  const shown = new Set(visible)

  if (nextVisible.some((key) => !shown.has(key))) return [...order]
  let index = 0

  return order.map((key) => (shown.has(key) ? nextVisible[index++] : key))
}

export function pageSlice<T>(items: readonly T[], limit: number) {
  const rendered = Math.min(limit, items.length)

  return {
    items: items.slice(0, rendered),
    less: rendered > 10,
    more: items.length > rendered,
  }
}
