import { For, Show, createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import {
  Accessibility,
  Feedback,
  PointerActivationConstraints,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import type { Draggable } from "@dnd-kit/abstract"
import { DragDropProvider, PointerSensor, useDroppable } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Loader } from "@opencode/ui/loader"
import { createProjectActions } from "@/home/projects/actions"
import { addProjects } from "@/home/projects/add"
import { useProjectBrowser } from "@/home/projects/browse"
import { arrayMove } from "@/runtime/array-move"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import { pathKey } from "@/workspaces/path-key"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import {
  bumpedRecent,
  cozyCleanPins,
  cozyDropAllowed,
  cozyMixPins,
  cozyPlacement,
  cozyProjectKey,
  cozyProjectOrder,
  pageSlice,
  rememberRecentRecency,
  reorderCozyPins,
  reorderProjectOrder,
  type CozyDragData,
  type CozyItem,
  type CozyPartition,
  type CozyProject,
  type CozySession,
} from "./cozy-model"
import { CozyPager, CozySectionHeader } from "./cozy-group"
import { CozyProjectRow } from "./cozy-project-row"
import { CozySessionRow } from "./cozy-session-row"
import { createCozyState } from "./cozy-state"
import { createSessionInbox, inboxArchived, type InboxEntry } from "./inbox-model"
import { useSessionPins } from "./session-pins"
import { normalizeCozyOrder, appendKey, unpinProjectAt } from "./session-pins-state"
import { splitRecentSessionKey } from "./recent-sessions-model"

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

type CozyTailData = { group: string; edge: "tail" }

type CozyDropData = CozyDragData | CozyTailData

function isTailData(value: CozyDropData | undefined): value is CozyTailData {
  return !!value && "edge" in value
}

function dragData(source: Draggable | null | undefined) {
  // SAFETY: every `CozySortable` writes this exact shape, and dnd-kit returns its own data unchanged.
  const data = source?.data as CozyDragData | undefined

  return data?.kind === "session" || data?.kind === "project" ? data : undefined
}

const groupName = (value: string | number | null | undefined) => (value == null ? undefined : String(value))

const initialGroup = (source: Draggable) => {
  // SAFETY: sortable sources add these fields; non-sortable sources have neither and are rejected by the caller.
  const sortable = source as Draggable & { initialGroup?: string | number; group?: string | number }

  return groupName(sortable.initialGroup) ?? groupName(sortable.group)
}

function CozySortable(props: {
  id: string
  index: number
  group: string
  type: "session" | "project"
  data: CozyDragData
  accept: (source: Draggable) => boolean
  children: JSX.Element
}) {
  const sortable = useSortable<CozyDragData>({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
    get group() {
      return props.group
    },
    get type() {
      return props.type
    },
    get data() {
      return props.data
    },
    get accept() {
      return props.accept
    },
  })

  return <div ref={sortable.ref}>{props.children}</div>
}

function CozyDropTail(props: {
  group: string
  accept: (source: Draggable) => boolean
  children?: JSX.Element
}) {
  const droppable = useDroppable<CozyTailData>({
    get id() {
      return `tail:${props.group}`
    },
    get data() {
      return { group: props.group, edge: "tail" } as const
    },
    get accept() {
      return props.accept
    },
  })

  return (
    <div
      ref={droppable.ref}
      data-slot="sidebar-cozy-drop-tail"
      data-group={props.group}
      data-edge="tail"
      class="mx-1 min-h-4 rounded-sm border border-dashed border-v2-border-border-base"
    >
      {props.children}
    </div>
  )
}

function pinKey(item: CozyItem) {
  return item.kind === "project" ? `p:${item.project.key}` : `s:${item.session.key}`
}

export function SidebarCozy() {
  const language = useLanguage()
  const dialog = useDialog()
  const servers = useServers()
  const global = useGlobal()
  const inbox = createSessionInbox({ index: "home", archived: true })
  const sessionPins = useSessionPins()
  const cozyState = createCozyState()
  const actions = createProjectActions()
  const browse = useProjectBrowser()
  const pickDirectory = useDirectoryPicker()

  // The Projects group starts collapsed so Recent leads; expanding it shows every registered project.
  const [viewState, setViewState] = createStore<{
    pinned: boolean
    projects: boolean
    recent: boolean
    projectsById: Record<string, boolean>
    limits: Record<string, number>
  }>({ pinned: true, projects: false, recent: true, projectsById: {}, limits: {} })

  const [drag, setDrag] = createStore<{ active: boolean; kind?: "session" | "project"; server?: string }>({
    active: false,
  })

  const connections = createMemo(() =>
    servers.visible.flatMap((conn) => {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      return ctx ? [{ conn, ctx }] : []
    }),
  )

  const projects = createMemo(() =>
    connections().flatMap(({ conn, ctx }) => {
      const server = ServerConnection.key(conn)
      const list = ctx.projects.unique().filter((project) => project.time.archived === undefined)

      return cozyProjectOrder(list, cozyState.order(server)).map((project) => ({
        key: cozyProjectKey(server, pathKey(project.worktree)),
        conn,
        server,
        project,
      }))
    }),
  )

  const resolveProject = (entry: InboxEntry) => {
    const server = entry.server

    const matching = entry.ctx.projects
      .list()
      .filter((project) => project.id === entry.session.projectID && project.time.archived === undefined)

    if (matching.length === 0) return undefined
    const directory = pathKey(entry.session.location.directory)

    const project =
      matching.length === 1
        ? matching[0]
        : (matching.find(
            (candidate) =>
              pathKey(candidate.worktree) === directory ||
              candidate.sandboxes.some((sandbox) => pathKey(sandbox) === directory),
          ) ?? undefined)

    return project ? cozyProjectKey(server, pathKey(project.worktree)) : undefined
  }

  const entries = createMemo(() => inbox.entries().filter((entry) => !inboxArchived(entry)))
  const recentProjectKeys = createMemo(() => new Set(entries().flatMap((entry) => resolveProject(entry) ?? [])))
  const sessionKey = (entry: InboxEntry) => sessionPins.identity(entry.server, entry.session.id)

  const pinIdentities = createMemo(() =>
    sessionPins.keys().flatMap((key) => {
      const index = key.indexOf("\u0000")

      return index === -1 ? [] : [sessionPins.identity(key.slice(0, index), key.slice(index + 1))]
    }),
  )

  // Pins outside the bounded index still show: load them one by one, and drop a pin whose session is gone.
  const pinnedLoads = new Map<string, unknown>()

  createEffect(() => {
    if (!sessionPins.ready()) return

    for (const key of sessionPins.keys()) {
      const pin = splitRecentSessionKey(key)

      if (!pin) continue
      const ctx = global.serverCtx(ServerConnection.Key.make(pin.server))

      if (!ctx || ctx.sdk.connection.status() !== "connected") continue

      if (ctx.data.session.missing(pin.sessionID)) {
        sessionPins.unpin(pin.server, pin.sessionID)
        continue
      }

      if (ctx.data.session.get(pin.sessionID) || pinnedLoads.get(key) === ctx) continue
      pinnedLoads.set(key, ctx)
      void ctx.data.session.sync(pin.sessionID).catch(() => {
        if (pinnedLoads.get(key) === ctx) pinnedLoads.delete(key)
      })
    }
  })

  const pinnedProjects = createMemo(
    () =>
      new Set(
        sessionPins
          .cozyOrder()
          .filter((key) => key.startsWith("p:"))
          .map((key) => key.slice(2)),
      ),
  )

  const pinnedBase = createMemo(() =>
    cozyMixPins({
      stored: normalizeCozyOrder(sessionPins.cozyOrder(), sessionPins.identity),
      pinnedProjects: pinnedProjects(),
      sessions: pinIdentities(),
    }),
  )

  const pinnedOrder = createMemo(() =>
    pinnedBase().map((key) =>
      key.startsWith("p:")
        ? ({ kind: "project", key: key.slice(2) } as const)
        : ({ kind: "session", key: key.slice(2) } as const),
    ),
  )

  const view = createMemo(() =>
    cozyPlacement({
      entries: entries(),
      projects: projects(),
      resolveProject,
      sessionKey,
      pinnedSessions: new Set(pinIdentities()),
      pinnedProjects: pinnedProjects(),
      pinnedOrder: pinnedOrder(),
      recentOrder: sessionPins.recentOrder(),
    }),
  )

  const recentEntries = createMemo(() => {
    const pinned = new Set(pinIdentities())
    const projectPins = pinnedProjects()

    return entries().flatMap((entry) => {
      const key = sessionKey(entry)

      if (pinned.has(key)) return []
      const project = resolveProject(entry)

      if (!project || projectPins.has(project)) return []

      return [{ key, recency: entry.session.time.recency }]
    })
  })

  // A new prompt moves that session to the front; every other row keeps the user's dragged order.
  const knownRecent = new Set<string>()
  const seenRecent = new Map<string, number>()
  let recentSeeded = false
  createEffect(() => {
    const list = recentEntries()

    if (!sessionPins.ready()) return

    if (!recentSeeded) {
      if (list.length === 0) return

      for (const item of list) knownRecent.add(item.key)
      rememberRecentRecency(seenRecent, list)

      recentSeeded = true

      return
    }

    const front = bumpedRecent(knownRecent, seenRecent, list)

    for (const item of list) knownRecent.add(item.key)
    rememberRecentRecency(seenRecent, list)

    if (front.length > 0) sessionPins.moveRecentToFront(front)
  })

  // The shared store is authoritative. Normalize aliases and drop session slots for pins that no longer exist, but
  // never before the store has hydrated.
  createEffect(() => {
    if (!sessionPins.ready()) return
    const normalized = normalizeCozyOrder(sessionPins.cozyOrder(), sessionPins.identity)
    const cleaned = cozyCleanPins({ ready: true, stored: normalized, sessions: pinIdentities() })

    if (cleaned && !same(cleaned, sessionPins.cozyOrder())) sessionPins.setCozyOrder(cleaned)
  })

  const limit = (key: string) => viewState.limits[key] ?? 10
  const page = <T,>(key: string, items: readonly T[]) => pageSlice(items, limit(key))
  const more = (key: string, total: number) => setViewState("limits", key, Math.min(total, limit(key) + 10))
  const less = (key: string) => setViewState("limits", key, Math.max(10, limit(key) - 10))

  // Rows are keyed by stable strings: a session update rebuilds the view objects, and keying the lists by
  // those objects would remount every row and reset the drag while the pointer is down.
  const pinnedKeys = createMemo(() => view().pinned.map(pinKey))
  const pinnedByKey = createMemo(() => new Map(view().pinned.map((item) => [pinKey(item), item] as const)))

  const recentKeys = createMemo(() => page("recent", view().recent).items.map((session) => session.key))
  const recentByKey = createMemo(() => new Map(view().recent.map((session) => [session.key, session] as const)))

  const accept = (group: string) => (source: Draggable) => {
    const data = dragData(source)

    if (!data) return false

    return cozyDropAllowed({
      source: data,
      from: initialGroup(source),
      to: group,
      pinnedProjects: pinnedProjects(),
      projectKeys: recentProjectKeys(),
    })
  }

  const canTail = (group: string | undefined) => {
    if (!group || !drag.active) return false

    if (group === "pinned") return drag.kind === "session" || drag.kind === "project"

    if (group === "recent") return drag.kind === "session"

    if (group.startsWith("projects:")) return drag.kind === "project"

    return false
  }

  // Projects is collapsed or this server has no visible group: offer one tail under the Projects header.
  const projectTail = createMemo(() => {
    if (!drag.active || drag.kind !== "project" || !drag.server) return

    if (viewState.projects && view().projects.some((partition) => partition.server === drag.server)) return

    return `projects:${drag.server}`
  })

  const expanded = (project: CozyProject) => !!viewState.projectsById[project.key]

  const toggleProject = (project: CozyProject) =>
    setViewState("projectsById", project.key, (value: boolean | undefined) => !value)

  const count = (project: CozyProject) => project.sessions.length

  const addProject = () => {
    const target = connections()[0]

    if (!target) return

    pickDirectory({
      server: target.conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => {
        const ctx = global.serverCtx(ServerConnection.key(target.conn))

        if (ctx) void addProjects(ctx, homeProjectDirectories(result))
      },
    })
  }

  const pinProject = (project: CozyProject) => sessionPins.appendCozy(`p:${project.key}`)
  const unpinProject = (project: CozyProject) => sessionPins.removeCozy(`p:${project.key}`)

  const pinSession = (session: CozySession) => sessionPins.pinWithCozy(session.entry.server, session.entry.session.id)

  const unpinSession = (session: CozySession) => sessionPins.unpin(session.entry.server, session.entry.session.id)

  const reorderPinned = (initialIndex: number, index: number) => {
    // Reorder inside the complete mixed order, never by replacing it with a possibly partial view.
    const visibleKeys = pinnedKeys()
    const nextKeys = arrayMove(visibleKeys, initialIndex, index)
    const cozy = reorderCozyPins(pinnedBase(), visibleKeys, nextKeys)

    const sessions = (keys: readonly string[]) => keys.flatMap((key) => (key.startsWith("s:") ? [key.slice(2)] : []))

    const visibleSessions = sessions(visibleKeys)
    const nextSessions = sessions(nextKeys)

    if (same(visibleSessions, nextSessions)) {
      sessionPins.setCozyOrder(cozy)

      return
    }

    sessionPins.reorderWithCozy(visibleSessions, nextSessions, cozy)
  }

  const reorderProjects = (partition: CozyPartition, initialIndex: number, index: number) => {
    const all = projects().filter((project) => project.server === partition.server)
    const visible = partition.items.map((project) => project.project.worktree)
    const next = arrayMove(visible, initialIndex, index)

    cozyState.setOrder(
      partition.server,
      reorderProjectOrder(
        all.map((project) => project.project.worktree),
        visible,
        next,
      ),
    )
  }

  const reorderRecent = (initialIndex: number, index: number) => {
    const visible = recentKeys()
    const next = arrayMove(visible, initialIndex, index)
    const base = view().recent.map((session) => session.key)

    sessionPins.setRecentOrder(reorderProjectOrder(base, visible, next))
  }

  const projectOrder = (server: string) =>
    projects().flatMap((project) => (project.server === server ? [project.project.worktree] : []))

  const projectPage = (server: string) => {
    const partition = view().projects.find((item) => item.server === server)

    return partition ? page(`project-group:${server}`, partition.items).items.map((item) => item.project.worktree) : []
  }

  const dropPinned = (data: CozyDragData, index?: number) => {
    const base = pinnedBase()
    const visible = pinnedKeys()
    const at = index ?? base.length

    if (data.kind === "session") {
      sessionPins.pinSessionAt({
        server: data.server,
        sessionID: data.sessionID,
        identity: data.key,
        index: at,
        base,
        visible,
      })

      return
    }

    sessionPins.pinProjectAt({
      projectKey: data.key,
      index: at,
      base,
      visible,
    })
  }

  const dropRecent = (data: Extract<CozyDragData, { kind: "session" }>, index?: number) => {
    const base = view().recent.map((session) => session.key)
    const visible = recentKeys()

    sessionPins.unpinSessionAt({
      server: data.server,
      sessionID: data.sessionID,
      identity: data.key,
      index: index ?? base.length,
      recentBase: base,
      recentVisible: visible,
    })

    knownRecent.add(data.key)
    rememberRecentRecency(seenRecent, [{ key: data.key, recency: data.recency }])
  }

  const dropProjects = (data: Extract<CozyDragData, { kind: "project" }>, index?: number) => {
    const order = projectOrder(data.server)

    const result = unpinProjectAt({
      state: { cozy: sessionPins.cozyOrder() },
      projectKey: data.key,
      server: data.server,
      worktree: data.worktree,
      index: index ?? order.length,
      projectOrder: order,
      visible: projectPage(data.server),
    })

    cozyState.setOrder(data.server, result.order)
    sessionPins.setCozyOrder(result.cozy)
  }

  const dropAt = (data: CozyDragData, from: string | undefined, to: string, index?: number) => {
    if (
      !cozyDropAllowed({
        source: data,
        from,
        to,
        pinnedProjects: pinnedProjects(),
        projectKeys: recentProjectKeys(),
      })
    )
      return

    if (data.kind === "session") {
      if (to === "pinned") {
        dropPinned(data, index)

        return
      }

      if (to === "recent") dropRecent(data, index)

      return
    }

    if (to === "pinned") {
      dropPinned(data, index)

      return
    }

    if (to.startsWith("projects:")) dropProjects(data, index)
  }

  const appendTail = (data: CozyDragData, to: string) => {
    if (data.kind === "session" && to === "recent") {
      sessionPins.setRecentOrder(appendKey(view().recent.map((session) => session.key), data.key))

      return
    }

    if (data.kind === "project" && to.startsWith("projects:")) {
      cozyState.setOrder(data.server, appendKey(projectOrder(data.server), data.worktree))

      return
    }

    if (to === "pinned") dropPinned(data)
  }

  const dropTail = (data: CozyDragData, from: string | undefined, to: string) => {
    if (from === to) {
      appendTail(data, to)

      return
    }

    dropAt(data, from, to)
  }

  const reorderGroup = (group: string, initialIndex: number, index: number) => {
    if (group === "pinned") {
      reorderPinned(initialIndex, index)

      return
    }

    if (group === "recent") {
      reorderRecent(initialIndex, index)

      return
    }

    if (!group.startsWith("projects:")) return
    const partition = view().projects.find((item) => item.server === group.slice("projects:".length))

    if (partition) reorderProjects(partition, initialIndex, index)
  }

  const onDragStart = (event: DragStartEvent) => {
    const data = dragData(event.operation.source)

    if (!data) {
      setDrag({ active: false, kind: undefined, server: undefined })

      return
    }

    setDrag({ active: true, kind: data.kind, server: data.server })
  }

  const onDragEnd = (event: DragEndEvent) => {
    try {
      const source = event.operation.source

      if (event.canceled || !isSortable(source)) return
      const data = dragData(source)

      if (!data) return
      const from = groupName(source.initialGroup)

      if (!from) return
      const target = event.operation.target
      // SAFETY: only the Cozy sortables and tails register here, and they write one of these shapes.
      const targetData = target?.data as CozyDropData | undefined

      if (target && isTailData(targetData)) {
        dropTail(data, from, targetData.group)

        return
      }

      if (!isSortable(target)) return
      const to = groupName(source.group)

      if (!to) return

      if (from === to) {
        if (source.initialIndex === source.index) return
        reorderGroup(to, source.initialIndex, source.index)

        return
      }

      dropAt(data, from, to, source.index)
    } finally {
      setDrag({ active: false, kind: undefined, server: undefined })
    }
  }

  const visibleSessions = createMemo(() => {
    const list: InboxEntry[] = []

    for (const item of view().pinned) {
      if (item.kind === "session") {
        list.push(item.session.entry)
        continue
      }

      if (expanded(item.project)) {
        for (const session of page(`pinned:${item.project.key}`, item.project.sessions).items) list.push(session.entry)
      }
    }

    if (viewState.projects) {
      for (const partition of view().projects) {
        for (const project of page(`project-group:${partition.server}`, partition.items).items) {
          if (!expanded(project)) continue

          for (const session of page(`project:${project.key}`, project.sessions).items) list.push(session.entry)
        }
      }
    }

    if (viewState.recent) {
      for (const session of page("recent", view().recent).items) list.push(session.entry)
    }

    return list
  })

  createEffect(() => inbox.loadBranches(visibleSessions()))

  const archived = createMemo(() => inbox.entries().some(inboxArchived))

  const projectRow = (project: CozyProject) => (
    <>
      <CozyProjectRow
        project={project}
        count={count(project)}
        expanded={expanded(project)}
        onToggle={() => toggleProject(project)}
        onPin={() => pinProject(project)}
        onUnpin={() => unpinProject(project)}
        actions={actions}
        onViewHistory={browse}
      />
      <Show when={expanded(project)}>
        <div data-cozy-project-body class="flex flex-col ps-3">
          <For each={page(`project:${project.key}`, project.sessions).items}>
            {(session) => (
              <CozySessionRow
                session={session}
                inbox={inbox}
                showAvatar={false}
                onPin={() => pinSession(session)}
                onUnpin={() => unpinSession(session)}
              />
            )}
          </For>
          <CozyPager
            less={page(`project:${project.key}`, project.sessions).less}
            more={page(`project:${project.key}`, project.sessions).more}
            onLess={() => less(`project:${project.key}`)}
            onMore={() => more(`project:${project.key}`, project.sessions.length)}
          />
        </div>
      </Show>
    </>
  )

  const sessionRow = (session: CozySession) => (
    <CozySessionRow
      session={session}
      inbox={inbox}
      onPin={() => pinSession(session)}
      onUnpin={() => unpinSession(session)}
    />
  )

  const pinnedRow = (item: CozyItem) =>
    item.kind === "project" ? projectRow(item.project) : sessionRow(item.session)

  const sessionDrag = (session: CozySession): CozyDragData => ({
    kind: "session",
    key: session.key,
    server: session.entry.server,
    sessionID: session.entry.session.id,
    projectKey: resolveProject(session.entry),
    recency: session.entry.session.time.recency,
  })

  const projectDrag = (project: CozyProject): CozyDragData => ({
    kind: "project",
    key: project.key,
    server: project.server,
    worktree: project.project.worktree,
  })

  return (
    <div data-slot="sidebar-cozy" class="flex min-h-0 flex-1 flex-col">
      <Show
        when={!inbox.loading()}
        fallback={
          <div class="flex justify-center p-2">
            <Loader role="img" aria-hidden="false" aria-label={language.t("common.loading")} />
          </div>
        }
      >
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })],
              preventActivation: (event) =>
                event.target instanceof Element &&
                !!event.target.closest("[data-cozy-pin], [data-project-action], [data-cozy-project-body]"),
            }),
          ]}
          modifiers={[RestrictToVerticalAxis]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <div
            data-slot="sidebar-cozy-scroll"
            data-scrollable
            class="relative flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto pb-1"
          >
            <Show when={view().pinned.length > 0}>
              <div
                role="group"
                aria-labelledby="sidebar-cozy-pinned"
                class="relative flex shrink-0 flex-col gap-px pb-0.5"
              >
                <CozySectionHeader
                  id="sidebar-cozy-pinned"
                  label={language.t("sidebar.recent.pinned")}
                  expanded={viewState.pinned}
                  onToggle={() => setViewState("pinned", (value: boolean) => !value)}
                />
                <Show
                  when={viewState.pinned}
                  fallback={
                    <Show when={canTail("pinned")}>
                      <div class="absolute inset-x-0 bottom-0 z-10">
                        <CozyDropTail group="pinned" accept={accept("pinned")} />
                      </div>
                    </Show>
                  }
                >
                  <For each={pinnedKeys()}>
                    {(key, index) => (
                      <Show keyed when={pinnedByKey().get(key)}>
                        {(item) => (
                          <CozySortable
                            id={`pinned:${key}`}
                            index={index()}
                            group="pinned"
                            type={item.kind}
                            data={item.kind === "project" ? projectDrag(item.project) : sessionDrag(item.session)}
                            accept={accept("pinned")}
                          >
                            {pinnedRow(item)}
                          </CozySortable>
                        )}
                      </Show>
                    )}
                  </For>
                  <Show when={canTail("pinned")}>
                    <div class="absolute inset-x-0 bottom-0 z-10">
                      <CozyDropTail group="pinned" accept={accept("pinned")} />
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>

            <Show when={view().pinned.length === 0 && canTail("pinned")}>
              <div class="absolute inset-x-0 top-0 z-20 flex flex-col gap-px rounded-md bg-v2-background-bg-base p-1 shadow-[var(--v2-elevation-floating)]">
                <div class="px-2 text-12-regular text-v2-text-text-muted">
                  {language.t("sidebar.recent.pinned")}
                </div>
                <CozyDropTail group="pinned" accept={accept("pinned")} />
              </div>
            </Show>

            <div role="group" aria-labelledby="sidebar-cozy-projects" class="flex shrink-0 flex-col gap-px pb-0.5">
              <CozySectionHeader
                id="sidebar-cozy-projects"
                label={language.t("sidebar.organize.projects")}
                expanded={viewState.projects}
                onToggle={() => setViewState("projects", (value: boolean) => !value)}
                onAdd={addProject}
                addLabel={language.t("home.project.add")}
              />
              <Show when={viewState.projects}>
                <For each={view().projects}>
                  {(partition) => {
                    const group = `projects:${partition.server}`

                    return (
                      <div class="flex min-w-0 flex-col">
                        <Show when={servers.visible.length > 1}>
                          <div class="flex h-6 items-center px-2 text-12-regular text-v2-text-text-muted">
                            {servers.label(servers.list.find((conn) => ServerConnection.key(conn) === partition.server)!)}
                          </div>
                        </Show>
                        <For each={page(`project-group:${partition.server}`, partition.items).items}>
                          {(project, index) => (
                            <CozySortable
                              id={`projects:${partition.server}:${project.key}`}
                              index={index()}
                              group={group}
                              type="project"
                              data={projectDrag(project)}
                              accept={accept(group)}
                            >
                              {projectRow(project)}
                            </CozySortable>
                          )}
                        </For>
                        <CozyPager
                          less={page(`project-group:${partition.server}`, partition.items).less}
                          more={page(`project-group:${partition.server}`, partition.items).more}
                          onLess={() => less(`project-group:${partition.server}`)}
                          onMore={() => more(`project-group:${partition.server}`, partition.items.length)}
                        />
                        <Show when={canTail(group)}>
                          <CozyDropTail group={group} accept={accept(group)} />
                        </Show>
                      </div>
                    )
                  }}
                </For>
              </Show>
              <Show when={projectTail()}>
                {(group) => <CozyDropTail group={group()} accept={accept(group())} />}
              </Show>
            </div>

            <Show when={view().recent.length > 0 || canTail("recent")}>
              <div role="group" aria-labelledby="sidebar-cozy-recent" class="flex shrink-0 flex-col gap-px pb-0.5">
                <CozySectionHeader
                  id="sidebar-cozy-recent"
                  label={language.t("sidebar.inbox.section.recent")}
                  expanded={viewState.recent}
                  onToggle={() => setViewState("recent", (value: boolean) => !value)}
                />
                <Show
                  when={viewState.recent}
                  fallback={
                    <Show when={canTail("recent")}>
                      <CozyDropTail group="recent" accept={accept("recent")} />
                    </Show>
                  }
                >
                  <For each={recentKeys()}>
                    {(key, index) => (
                      <Show when={recentByKey().get(key)}>
                        {(session) => (
                          <CozySortable
                            id={`recent:${key}`}
                            index={index()}
                            group="recent"
                            type="session"
                            data={sessionDrag(session())}
                            accept={accept("recent")}
                          >
                            {sessionRow(session())}
                          </CozySortable>
                        )}
                      </Show>
                    )}
                  </For>
                  <CozyPager
                    less={page("recent", view().recent).less}
                    more={page("recent", view().recent).more}
                    onLess={() => less("recent")}
                    onMore={() => more("recent", view().recent.length)}
                  />
                  <Show when={canTail("recent")}>
                    <CozyDropTail group="recent" accept={accept("recent")} />
                  </Show>
                </Show>
              </div>
            </Show>

            <Show
              when={
                !drag.active &&
                view().pinned.length === 0 &&
                view().projects.length === 0 &&
                view().recent.length === 0
              }
            >
              <div class="px-1.5 py-2 text-[13px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.inbox.empty")}
              </div>
            </Show>

            <Show when={archived()}>
              <div class="shrink-0 pt-3">
                <Button
                  variant="ghost-muted"
                  size="normal"
                  class="w-full justify-start px-2"
                  onClick={async () => {
                    const { DialogSessionSearch } = await import("@/shell/commands/session-search")

                    void dialog.show(() => <DialogSessionSearch archived />)
                  }}
                >
                  {language.t("sidebar.inbox.section.archived")}
                </Button>
              </div>
            </Show>
          </div>
        </DragDropProvider>
      </Show>
    </div>
  )
}
