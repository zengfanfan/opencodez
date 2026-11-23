import { Show } from "solid-js"
import { ActivityRing } from "@opencode/ui/activity-ring"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { displayName } from "@opencode/ui/project-avatar"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { useServers } from "@/runtime/server/registry"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import type { CozySession } from "./cozy-model"
import type { SessionInbox } from "./inbox-model"
import { SessionMenuItems } from "./session-menu-items"
import { sessionTabTitle } from "./tab-title"

export function CozySessionRow(props: {
  session: CozySession
  inbox: SessionInbox
  onPin: () => void
  onUnpin: () => void
}) {
  const language = useLanguage()
  const servers = useServers()

  const entry = () => props.session.entry
  const project = () => entry().ctx.projects.forSession(entry().session)
  const title = () => sessionTabTitle(entry().session.title, language.t("session.tab.session"))
  const branch = () => props.inbox.branch(entry())

  const statusLabel = () =>
    entry().status === "ready" ? undefined : language.t(`sidebar.inbox.status.${entry().status}`)

  const age = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - entry().session.time.updated) / 1000))

    if (seconds < 60) return language.plural("sidebar.inbox.elapsed.seconds", seconds)

    if (seconds < 3600) return language.plural("sidebar.inbox.elapsed.minutes", Math.floor(seconds / 60))

    if (seconds < 86_400) return language.plural("sidebar.inbox.elapsed.hours", Math.floor(seconds / 3600))

    return language.plural("sidebar.inbox.elapsed.days", Math.floor(seconds / 86_400))
  }

  const info = () => (
    <div class="flex max-w-[320px] flex-col gap-1">
      <span class="font-medium">{title()}</span>
      <span class="text-v2-text-text-muted">{displayName(project() ?? { worktree: entry().session.location.directory })}</span>
      <span dir="auto" class="font-mono text-12-regular text-v2-text-text-faint">
        {entry().session.location.directory}
      </span>
      <Show when={branch()}>{(value) => <span>{value()}</span>}</Show>
      <span class="text-v2-text-text-muted">
        {statusLabel() ? `${statusLabel()} · ` : ""}
        {age()}
      </span>
    </div>
  )

  return (
    <Menu.Context modal={false}>
      <div class="group flex h-7 min-w-0 items-center rounded-[6px] hover:bg-v2-overlay-simple-overlay-hover data-[state=active]:bg-v2-overlay-simple-overlay-pressed" data-slot="sidebar-cozy-row" data-kind="session" data-state={props.inbox.selected(entry()) ? "active" : undefined}>
        <Tooltip class="flex h-7 min-w-0 flex-1" value={info()} appearance="large">
          <Menu.Context.Trigger
            as="button"
            type="button"
            aria-current={props.inbox.selected(entry()) ? "page" : undefined}
            data-slot="sidebar-cozy-item"
            data-status={entry().status}
            class="flex h-full w-full min-w-0 items-center gap-2 rounded-[6px] bg-transparent px-2 text-start text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
            onClick={() => props.inbox.open(entry())}
          >
            <span class="flex size-4 shrink-0 items-center justify-center">
              <SessionTabAvatarView project={project()} directory={entry().session.location.directory} unread={false} />
            </span>
            <span dir="auto" class="min-w-0 flex-1 truncate font-medium tracking-[-0.04px]">
              {title()}
            </span>
            <Show when={servers.tag(entry().conn)}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="flex size-4 shrink-0">
                  <Icon name="server" aria-label={name()} class="text-v2-icon-icon-muted" />
                </Tooltip>
              )}
            </Show>
            <Show when={props.inbox.inWorktree(entry())}>
              <Tooltip placement="right" value={entry().session.location.directory} class="flex size-4 shrink-0">
                <Icon name="outline-worktree" class="text-v2-icon-icon-muted" />
              </Tooltip>
            </Show>
            <Show when={branch()}>
              {(name) => (
                <Tooltip placement="right" value={name()} class="flex size-4 shrink-0">
                  <Icon name="branch" class="text-v2-icon-icon-muted" />
                </Tooltip>
              )}
            </Show>
            <Show when={entry().status !== "ready"}>
              <Show
                when={entry().status === "working"}
                fallback={
                  <span
                    aria-hidden="true"
                    class="size-[7px] shrink-0 rounded-full"
                    classList={{
                      "bg-v2-state-fg-warning": entry().status === "approval" || entry().status === "input",
                      "bg-v2-state-fg-danger": entry().status === "failed",
                      "bg-v2-background-bg-accent": entry().status === "done",
                    }}
                  />
                }
              >
                <ActivityRing class="shrink-0 text-v2-icon-icon-muted" />
              </Show>
            </Show>
          </Menu.Context.Trigger>
        </Tooltip>
        <span data-cozy-pin class="flex w-6 shrink-0 justify-center">
          <IconButton
            icon={<Icon name="pin" />}
            variant="ghost-muted"
            size="small"
            aria-label={language.t(props.session.pinned ? "sidebar.recent.unpin" : "sidebar.recent.pin")}
            class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            onClick={(event) => {
              event.stopPropagation()

              if (props.session.pinned) props.onUnpin()
              else props.onPin()
            }}
          />
        </span>
      </div>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <SessionMenuItems
            inbox={props.inbox}
            entry={entry()}
            pinned={props.session.pinned}
            onPin={props.onPin}
            onUnpin={props.onUnpin}
          />
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
