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

const SCALE_FACTORS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const

// A 3x5 pixel font: blocky at 16px, but every edge lands on a whole pixel, so the number stays sharp.
const GLYPHS = new Map<string, readonly string[]>([
  ["0", ["111", "101", "101", "101", "111"]],
  ["1", ["010", "110", "010", "010", "111"]],
  ["2", ["111", "001", "111", "100", "111"]],
  ["3", ["111", "001", "111", "001", "111"]],
  ["4", ["101", "101", "111", "001", "001"]],
  ["5", ["111", "100", "111", "001", "111"]],
  ["6", ["111", "100", "111", "101", "111"]],
  ["7", ["111", "001", "010", "010", "010"]],
  ["8", ["111", "101", "111", "101", "111"]],
  ["9", ["111", "101", "111", "001", "111"]],
  ["+", ["000", "010", "111", "010", "000"]],
])

function drawBadge(count: number) {
  const label = badgeLabel(count)
  const styles = getComputedStyle(document.documentElement)
  const background = styles.getPropertyValue("--v2-red-900").trim() || "#97252b"

  return SCALE_FACTORS.map((scaleFactor) => {
    const size = Math.round(16 * scaleFactor)
    const canvas = document.createElement("canvas")
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext("2d")

    if (!context) return { scaleFactor, dataUrl: "" }

    context.fillStyle = background
    context.beginPath()
    context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
    context.fill()

    drawLabel(context, label, size)

    return { scaleFactor, dataUrl: canvas.toDataURL("image/png") }
  })
}

function drawLabel(context: CanvasRenderingContext2D, label: string, size: number) {
  const glyphs = [...label].flatMap((character) => {
    const glyph = GLYPHS.get(character)

    return glyph ? [glyph] : []
  })

  if (glyphs.length === 0) return

  const widthUnits = glyphs.reduce((total, glyph) => total + (glyph[0]?.length ?? 0) + 1, -1)
  const scale = Math.max(1, Math.min(Math.floor((size - 2) / widthUnits), Math.floor((size - 2) / 5)))
  const width = widthUnits * scale
  const height = 5 * scale
  const left = Math.round((size - width) / 2)
  const top = Math.round((size - height) / 2)
  let offset = 0

  context.fillStyle = "#ffffff"

  for (const glyph of glyphs) {
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== "1") continue

        context.fillRect(left + (offset + x) * scale, top + y * scale, scale, scale)
      }
    })

    offset += (glyph[0]?.length ?? 0) + 1
  }
}
