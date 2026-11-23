import type { Project } from "@/runtime/server/types"
import type { ServerConnection } from "@/runtime/server/registry"
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

export type CozyPinnedRef =
  | { kind: "project"; key: CozyProjectKey }
  | { kind: "session"; key: string }

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

/** The earliest registered project without version control on each server. */
export function cozyDefaultProject(projects: readonly Project[]) {
  return projects
    .filter((project) => project.vcs === undefined && project.id !== "global")
    .toSorted((a, b) => a.time.created - b.time.created || a.worktree.localeCompare(b.worktree))[0]
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
  const updated = b.entry.session.time.updated - a.entry.session.time.updated

  if (updated !== 0) return updated

  return a.entry.session.id.localeCompare(b.entry.session.id)
}

/** Groups sessions into pinned, per-project, and default-project recent lists. */
export function cozyPlacement(input: {
  entries: readonly InboxEntry[]
  projects: readonly CozyProjectInfo[]
  defaultProjects: ReadonlyMap<ServerConnection.Key, string>
  resolveProject: (entry: InboxEntry) => string | undefined
  sessionKey: (entry: InboxEntry) => string
  pinnedSessions: ReadonlySet<string>
  pinnedProjects: ReadonlySet<string>
  pinnedOrder: readonly CozyPinnedRef[]
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

    if (input.pinnedProjects.has(projectKey)) {
      project.sessions.push({ key, entry, pinned: false })
      continue
    }

    if (input.defaultProjects.get(entry.server) === projectKey) {
      recent.push({ key, entry, pinned: false })
      continue
    }

    project.sessions.push({ key, entry, pinned: false })
  }

  for (const project of projectsByKey.values()) {
    project.sessions.sort(compareSessions)
    project.pinned = input.pinnedProjects.has(project.key)
  }

  recent.sort(compareSessions)

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

  const orderedSessions = new Set(
    ordered.flatMap((item) => (item.kind === "session" ? [item.session.key] : [])),
  )

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
    recent,
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
  const kept = input.stored.filter((key) => (key.startsWith("p:") ? projects.has(key.slice(2)) : sessions.has(key.slice(2))))
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
export function cozyCleanPins(input: {
  ready: boolean
  stored: readonly string[]
  sessions: readonly string[]
}) {
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

export function reorderProjectOrder(order: readonly string[], visible: readonly string[], nextVisible: readonly string[]) {
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
