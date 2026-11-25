import { useQueryClient, useQueries } from "@tanstack/solid-query"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { parseHomeSessionIndex } from "@/home/sessions/index"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { mergeRootSessionIndex } from "@/runtime/server/session-index"
import {
  badgeLabel,
  claimTaskbarBadgeWithRetry,
  patchTaskbarIndex,
  sendTaskbarBadge,
  TASKBAR_SESSION_INDEX_LIMIT,
  taskbarBadgeEnabled,
  taskbarBadgeNeedsSync,
  taskbarBadgeQueryPlan,
  taskbarBadgeSummary,
  type TaskbarBadgeIndex,
  type TaskbarBadgeIndexEvent,
} from "@/shell/notifications/taskbar-badge-model"

/**
 * Shows the unread root-session count on the Windows taskbar icon. Mounted once under the app's global
 * providers; web and other desktop systems do no work because the platform methods are absent there.
 */
export function TaskbarBadge() {
  const platform = usePlatform()
  const global = useGlobal()
  const language = useLanguage()
  const queryClient = useQueryClient()
  const controller = new AbortController()
  const [mount, setMount] = createSignal<number>()

  onCleanup(() => controller.abort())

  const claim = platform.claimTaskbarBadgeMount

  if (taskbarBadgeEnabled(platform) && claim) {
    void claimTaskbarBadgeWithRetry((signal) => claim(signal), controller.signal).then((id) => {
      if (id !== undefined && !controller.signal.aborted) setMount(id)
    })
  }

  const connections = createMemo(() =>
    global.servers.list().flatMap((conn) => {
      const ctx = global.serverCtx(ServerConnection.key(conn))

      return ctx ? [{ conn, ctx }] : []
    }),
  )

  const queryConnections = createMemo(() => taskbarBadgeQueryPlan(platform, connections()))

  const queries = useQueries(() => ({
    queries: queryConnections().map((item) => ({
      queryKey: ["taskbar-unread", item.conn] as const,
      enabled: mount() !== undefined && item.ctx.sdk.connection.status() === "connected",
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        item.ctx.sdk.api.session
          .list({ limit: TASKBAR_SESSION_INDEX_LIMIT, order: "desc", parentID: null }, { signal })
          .then((response) => ({
            sessions: parseHomeSessionIndex(response.data),
            fetched: response.data.length,
          })),
      retry: 2,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
      select: (index: TaskbarBadgeIndex) => () => index,
    })),
  }))

  const summary = createMemo(() =>
    taskbarBadgeSummary(
      queryConnections().map((item, index) => {
        const data = queries[index]?.data?.()
        const sessions = data?.sessions ?? []
        const merged = mergeRootSessionIndex(sessions, item.ctx.data.session.known())

        return {
          count: item.ctx.notification.session.unreadCount(merged),
          capped: (data?.fetched ?? 0) >= TASKBAR_SESSION_INDEX_LIMIT,
        }
      }),
    ),
  )

  // Keep the cached index current without loading every session; unarchive restores an index-only row by syncing it.
  createEffect(() => {
    queryConnections().forEach((item) => {
      const key = ["taskbar-unread", item.conn] as const

      const patch = (event: TaskbarBadgeIndexEvent) =>
        queryClient.setQueryData<TaskbarBadgeIndex>(key, (current) =>
          current ? { ...current, sessions: patchTaskbarIndex(current.sessions, event) ?? [] } : current,
        )

      onCleanup(item.ctx.data.on("session.deleted", patch))
      onCleanup(item.ctx.data.on("session.archived", patch))
      onCleanup(
        item.ctx.data.on("session.unarchived", (event) => {
          const cached = queryClient.getQueryData<TaskbarBadgeIndex>(key)?.sessions
          patch(event)

          if (taskbarBadgeNeedsSync(cached, !!item.ctx.data.session.get(event.data.sessionID), event.data.sessionID)) {
            void item.ctx.data.session.sync(event.data.sessionID).catch(() => undefined)
          }
        }),
      )
      onCleanup(item.ctx.data.on("session.viewed", patch))
    })
  })

  let attempt = 0

  createEffect(() => {
    if (!taskbarBadgeEnabled(platform)) return

    const id = mount()

    if (id === undefined) return

    const { count, atLeast } = summary()

    const description =
      count > 0 ? language.plural(atLeast ? "taskbar.unreadAtLeast" : "taskbar.unread", count) : ""

    const sequence = ++attempt

    void sendTaskbarBadge(
      platform,
      { mount: id, sequence },
      count,
      description,
      (value) => drawBadge(value),
      () => sequence === attempt,
      () => ({ mount: id, sequence: ++attempt }),
    )
  })

  return null
}

// Electron's TaskbarHost::SetOverlayIcon always rasterizes the overlay to 16x16: it takes the 1x
// bitmap and downsamples anything larger, and Windows then scales that 16x16 icon up on displays
// above 100% (20x20 at 125%). Larger or multi-resolution bitmaps therefore cannot look sharper,
// so draw the single 16x16 bitmap directly and skip Electron's extra rescale.
const BADGE_SIZE = 16

function drawBadge(count: number) {
  const label = badgeLabel(count)
  const styles = getComputedStyle(document.documentElement)
  const background = styles.getPropertyValue("--v2-red-900").trim() || "#97252b"
  const family = styles.getPropertyValue("--font-family-sans").trim() || "sans-serif"
  const weight = styles.getPropertyValue("--font-weight-bold").trim() || "670"
  const canvas = document.createElement("canvas")
  canvas.width = BADGE_SIZE
  canvas.height = BADGE_SIZE
  const context = canvas.getContext("2d")

  if (!context) return ""

  context.fillStyle = background
  context.beginPath()
  context.arc(BADGE_SIZE / 2, BADGE_SIZE / 2, BADGE_SIZE / 2, 0, Math.PI * 2)
  context.fill()

  context.fillStyle = "#ffffff"
  context.font = `${weight} ${Math.round(BADGE_SIZE * (label.length > 1 ? 0.5 : 0.6))}px ${family}`
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(label, BADGE_SIZE / 2, BADGE_SIZE / 2 + 1)

  return canvas.toDataURL("image/png")
}
