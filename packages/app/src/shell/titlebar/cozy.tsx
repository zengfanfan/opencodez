import { For, Show, createEffect, createMemo, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Accessibility, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
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
  cozyCleanPins,
  cozyMixPins,
  cozyPlacement,
  cozyProjectKey,
  cozyProjectOrder,
  pageSlice,
  reorderProjectOrder,
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
import { normalizeCozyOrder } from "./session-pins-state"
import { splitRecentSessionKey } from "./recent-sessions-model"

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

function CozySortable(props: { id: string; index: number; children: JSX.Element }) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get index() {
      return props.index
    },
  })

  return <div ref={sortable.ref}>{props.children}</div>
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

  const pinnedOrder = createMemo(() => {
    const mixed = cozyMixPins({
      stored: normalizeCozyOrder(sessionPins.cozyOrder(), sessionPins.identity),
      pinnedProjects: pinnedProjects(),
      sessions: pinIdentities(),
    })

    return mixed.map((key) =>
      key.startsWith("p:")
        ? ({ kind: "project", key: key.slice(2) } as const)
        : ({ kind: "session", key: key.slice(2) } as const),
    )
  })

  const view = createMemo(() =>
    cozyPlacement({
      entries: entries(),
      projects: projects(),
      resolveProject,
      sessionKey,
      pinnedSessions: new Set(pinIdentities()),
      pinnedProjects: pinnedProjects(),
      pinnedOrder: pinnedOrder(),
    }),
  )

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

  const rawByIdentity = createMemo(() => {
    const result = new Map<string, string>()

    for (const key of sessionPins.keys()) {
      const index = key.indexOf("\u0000")

      if (index === -1) continue
      result.set(sessionPins.identity(key.slice(0, index), key.slice(index + 1)), key)
    }

    return result
  })

  const reorderPinned = (initialIndex: number, index: number) => {
    const visible = view().pinned.map(pinKey)
    const next = arrayMove(visible, initialIndex, index)

    const sessions = (keys: readonly string[]) => keys.flatMap((key) => (key.startsWith("s:") ? [key.slice(2)] : []))

    const currentSessions = sessions(visible)
    const nextSessions = sessions(next)
    const rawCurrent = currentSessions.flatMap((key) => rawByIdentity().get(key) ?? [])
    const rawNext = nextSessions.flatMap((key) => rawByIdentity().get(key) ?? [])

    if (rawCurrent.length === rawNext.length && !same(rawCurrent, rawNext))
      sessionPins.reorderWithCozy(rawCurrent, rawNext, next)
    else sessionPins.setCozyOrder(next)
  }

  const reorderProjects = (partition: CozyPartition, initialIndex: number, index: number) => {
    const all = projects().flatMap((project) =>
      project.server === partition.server && !pinnedProjects().has(project.key) ? [project.project] : [],
    )

    const visible = partition.items.map((project) => project.project.worktree)
    const next = arrayMove(visible, initialIndex, index)

    cozyState.setOrder(
      partition.server,
      reorderProjectOrder(
        all.map((project) => project.worktree),
        visible,
        next,
      ),
    )
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
        <div
          data-slot="sidebar-cozy-scroll"
          data-scrollable
          class="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto pb-1"
        >
          <Show when={view().pinned.length > 0}>
            <div role="group" aria-labelledby="sidebar-cozy-pinned" class="flex shrink-0 flex-col gap-0.5 pb-0.5">
              <CozySectionHeader
                id="sidebar-cozy-pinned"
                label={language.t("sidebar.recent.pinned")}
                expanded={viewState.pinned}
                onToggle={() => setViewState("pinned", (value: boolean) => !value)}
              />
              <Show when={viewState.pinned}>
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
                  onDragEnd={(event) => {
                    const source = event.operation.source

                    if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                    reorderPinned(source.initialIndex, source.index)
                  }}
                >
                  <For each={view().pinned}>
                    {(item, index) => (
                      <CozySortable id={pinKey(item)} index={index()}>
                        {item.kind === "project" ? projectRow(item.project) : sessionRow(item.session)}
                      </CozySortable>
                    )}
                  </For>
                </DragDropProvider>
              </Show>
            </div>
          </Show>

          <div role="group" aria-labelledby="sidebar-cozy-projects" class="flex shrink-0 flex-col gap-0.5 pb-0.5">
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
                {(partition) => (
                  <div class="flex min-w-0 flex-col">
                    <Show when={servers.visible.length > 1}>
                      <div class="flex h-6 items-center px-2 text-12-regular text-v2-text-text-muted">
                        {servers.label(servers.list.find((conn) => ServerConnection.key(conn) === partition.server)!)}
                      </div>
                    </Show>
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
                      onDragEnd={(event) => {
                        const source = event.operation.source

                        if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return
                        reorderProjects(partition, source.initialIndex, source.index)
                      }}
                    >
                      <For each={page(`project-group:${partition.server}`, partition.items).items}>
                        {(project, index) => (
                          <CozySortable id={project.key} index={index()}>
                            {projectRow(project)}
                          </CozySortable>
                        )}
                      </For>
                    </DragDropProvider>
                    <CozyPager
                      less={page(`project-group:${partition.server}`, partition.items).less}
                      more={page(`project-group:${partition.server}`, partition.items).more}
                      onLess={() => less(`project-group:${partition.server}`)}
                      onMore={() => more(`project-group:${partition.server}`, partition.items.length)}
                    />
                  </div>
                )}
              </For>
            </Show>
          </div>

          <Show when={view().recent.length > 0}>
            <div role="group" aria-labelledby="sidebar-cozy-recent" class="flex shrink-0 flex-col gap-0.5 pb-0.5">
              <CozySectionHeader
                id="sidebar-cozy-recent"
                label={language.t("sidebar.inbox.section.recent")}
                expanded={viewState.recent}
                onToggle={() => setViewState("recent", (value: boolean) => !value)}
              />
              <Show when={viewState.recent}>
                <For each={page("recent", view().recent).items}>{(session) => sessionRow(session)}</For>
                <CozyPager
                  less={page("recent", view().recent).less}
                  more={page("recent", view().recent).more}
                  onLess={() => less("recent")}
                  onMore={() => more("recent", view().recent.length)}
                />
              </Show>
            </div>
          </Show>

          <Show when={view().pinned.length === 0 && view().projects.length === 0 && view().recent.length === 0}>
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
      </Show>
    </div>
  )
}
