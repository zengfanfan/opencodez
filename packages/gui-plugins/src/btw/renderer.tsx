import { createMemo, lazy, onCleanup, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { Command, createKeyed, MenuItem, Style, type PanelTab, type Plugin } from "@opencode/plugin/gui"
import { BuiltinPanel, BuiltinSlot, onIdle } from "@opencode/plugin/gui/builtin"
import type Btw from "./index"
import type { BtwTabView } from "./machine"
import { createBtw } from "./model"
import panelStyles from "./panel.css?inline"

const setup: Plugin.Setup<typeof Btw> = (ctx) => {
  const SessionBtwPanel = lazy(() => import("./panel"))
  onCleanup(onIdle(() => void SessionBtwPanel.preload()))
  ctx.add(Style, panelStyles)
  const layout = ctx.layout
  const sessions = ctx.sessions
  const btw = createBtw(ctx)
  // Changes when a session mounts or unmounts, not on every switch between sessions.
  const mounted = createMemo(() => !!sessions.current())

  // Tab objects per session, reused so strip updates and session switches do not rebuild a trigger.
  const tabs = new Map<string, Map<string, PanelTab>>()

  const title = (view: BtwTabView) =>
    view.status === "ready" && view.question ? view.question : ctx.t("tab.title")

  // Drops the tab objects and chats of sessions whose shell tab closed.
  createKeyed(
    () => [...sessions.list().map((session) => session.key), sessions.current()?.key].join("\u0000"),
    () => {
      const keep = new Set(
        [...sessions.list().map((session) => session.key), sessions.current()?.key].filter(
          (key): key is string => key !== undefined,
        ),
      )

      tabs.forEach((_cache, key) => {
        if (!keep.has(key)) tabs.delete(key)
      })
      btw.prune(keep)
    },
  )

  ctx.add(
    Command,
    (): Command => ({
      id: "ask",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      slash: { name: "btw", arguments: true },
      hidden: true,
      // Offered only while a session is open in a desktop-width window.
      enabled: !layout.narrow() && mounted(),
      run: (input) => btw.ask(input),
    }),
  )

  // The side region's + menu offers a fresh side chat.
  ctx.add(
    MenuItem,
    (): MenuItem => ({
      menu: "session.panel",
      id: "chat",
      title: ctx.t("menu.new"),
      icon: "comment",
      order: 20,
      run: () => {
        const session = sessions.current()

        if (session) btw.openChat(session)
      },
    }),
  )

  // Beside the composer's send button: a smaller icon button opens a side chat.
  ctx.add(BuiltinSlot, {
    at: "session.composer.submit",
    render: (input) => (
      <Tooltip value={ctx.t("actions.open")} placement="top">
        <IconButton
          size="small"
          variant="ghost-muted"
          class="me-1"
          icon={<Icon name="arrow-right" />}
          aria-label={ctx.t("actions.open")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => btw.openChat(input.session)}
        />
      </Tooltip>
    ),
  })

  ctx.add(BuiltinPanel, {
    id: "main",
    region: "side",
    transient: true,
    // Layouts saved before plugins store the tab as "btw"; as a panel key it leaves like any unlisted transient tab.
    legacy: { btw: "main" },
    // One tab per side thread. A restored tab stays listed but hidden until the session's store loads so restore
    // keeps it; afterwards a tab without a stored question leaves the strip. A question asked here shows at once.
    list: (input) => {
      if (input.open.length === 0) return []

      const session = input.session
      // A tab stores its whole thread: the first question and any follow-ups.
      const cache = tabs.get(session.key) ?? new Map<string, PanelTab>()
      tabs.set(session.key, cache)

      return input.open.flatMap((id) => {
        if (btw.tab(session, id).status === "missing") return []

        const existing = cache.get(id)

        if (existing) return [existing]

        const tab: PanelTab = {
          id,
          get title() {
            return title(btw.tab(session, id))
          },
          get hidden() {
            return btw.tab(session, id).status === "loading"
          },
          label: (state) => (
            <div class="flex min-w-0 items-center gap-1.5">
              <Icon name="comment" class="shrink-0" />
              <span class="truncate">{title(btw.tab(state.session, id))}</span>
            </div>
          ),
        }

        cache.set(id, tab)

        return [tab]
      })
    },
    render: (props) => (
      <Suspense>
        <SessionBtwPanel btw={btw} session={props.session} id={props.tab.id} />
      </Suspense>
    ),
    close: (input) => {
      btw.remove(input.session, input.tab.id)
      tabs.get(input.session.key)?.delete(input.tab.id)
    },
    // A selected side chat takes the keyboard, except the selection a reload mounts with.
    focus: (input) => {
      if (!input.restored) btw.requestFocus(input.session, input.tab.id)
    },
    enter: (input) => btw.requestFocus(input.session, input.tab.id),
  })
}

export default setup
