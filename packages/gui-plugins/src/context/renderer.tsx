import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { MenuItem, usePanel, type Plugin } from "@opencode/plugin/gui"
import { BuiltinPanel, BuiltinSlot, onIdle, type BuiltinPanelTab } from "@opencode/plugin/gui/builtin"
import type definition from "./index"
import { SessionContextUsage } from "./indicator"

const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const SessionContextTab = lazy(() => import("./tab"))
  // Compile the tab while the app idles, so the first open renders at once.
  onCleanup(onIdle(() => void SessionContextTab.preload()))

  // One tab object for every session, so neither strip updates nor a session switch remount its trigger; the label
  // reads the routed session from its state.
  const tab: BuiltinPanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    draggable: false,
    first: true,
    fallback: true,
    label: (state) => (
      <div class="flex items-center gap-2">
        <SessionContextUsage session={state.session} variant="indicator" />
        <div>{ctx.t("tab.title")}</div>
      </div>
    ),
  }

  ctx.add(
    MenuItem,
    (): MenuItem => {
      const session = ctx.sessions.current()

      return {
        menu: "session.panel",
        id: "main",
        title: ctx.t("tab.title"),
        icon: "status",
        opened: !!session && ctx.layout.state(`${ctx.id}:main`, session) !== "closed",
        order: 40,
        run: () => {
          const current = ctx.sessions.current()

          if (current) ctx.layout.open(`${ctx.id}:main`, current, { tab: "select" })
        },
      }
    },
  )

  ctx.add(BuiltinSlot, {
    at: "session.composer.controls",
    render: (input) => <SessionContextUsage session={input.session} placement="top" />,
  })

  ctx.add(
    BuiltinPanel,
    (): BuiltinPanel => ({
      id: "main",
      region: "side",
      // Stored before plugins as "context".
      legacy: { context: "main" },
      mobile: { title: ctx.t("mobile.title"), order: 40, kind: "menu", icon: "status" },
      list: (input) => (input.open.includes("main") ? [tab] : []),
      closed: () => ({ icon: "status" }),
      render: (props) => {
        const panel = usePanel()

        return (
          <Show
            when={panel.placement() !== "mobile"}
            fallback={
              <Suspense>
                <SessionContextTab session={props.session} />
              </Suspense>
            }
          >
            <div class="relative pt-2 flex-1 min-h-0 overflow-hidden">
              <Suspense>
                <SessionContextTab session={props.session} />
              </Suspense>
            </div>
          </Show>
        )
      },
    }),
  )
}

export default setup
