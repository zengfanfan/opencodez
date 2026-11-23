import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { displayName } from "@opencode/ui/project-avatar"
import { Tooltip } from "@opencode/ui/tooltip"
import type { createProjectActions } from "@/home/projects/actions"
import { ProjectMenuItems } from "@/home/projects/menu"
import type { ProjectBrowserTarget } from "@/home/projects/browse"
import { useLanguage } from "@/runtime/i18n/language"
import type { CozyProject } from "./cozy-model"

export function CozyProjectRow(props: {
  project: CozyProject
  count: number
  expanded: boolean
  expandable?: boolean
  onToggle: () => void
  onPin: () => void
  onUnpin: () => void
  actions: ReturnType<typeof createProjectActions>
  onViewHistory?: (target: ProjectBrowserTarget) => void
}) {
  const language = useLanguage()
  const expandable = () => props.expandable ?? true

  const info = () => (
    <div class="flex max-w-[320px] flex-col gap-1">
      <span class="font-medium">{displayName(props.project.project)}</span>
      <span dir="auto" class="font-mono text-12-regular text-v2-text-text-faint">
        {props.project.project.worktree}
      </span>
      <span class="text-v2-text-text-muted">
        {language.plural("sidebar.cozy.sessions", props.count)}
      </span>
    </div>
  )

  const body = () => (
    <>
      <Show when={expandable()}>
        <Icon
          name="fill-triangle-down"
          class="shrink-0 text-v2-icon-icon-muted transition-transform motion-reduce:transition-none"
          classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
        />
      </Show>
      <Icon name="folder" class="shrink-0 text-v2-icon-icon-muted" />
      <span dir="auto" class="min-w-0 flex-1 truncate">
        {displayName(props.project.project)}
      </span>
    </>
  )

  return (
    <div class="group flex h-7 min-w-0 items-center rounded-[6px] pe-1 hover:bg-v2-overlay-simple-overlay-hover has-[:focus-visible]:bg-v2-overlay-simple-overlay-hover" data-slot="sidebar-cozy-row" data-kind="project">
      <Tooltip class="flex h-7 min-w-0 flex-1" value={info()} appearance="large">
        <Show
          when={expandable()}
          fallback={
            <div class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-start text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted">
              {body()}
            </div>
          }
        >
          <button
            type="button"
            aria-expanded={props.expanded}
            data-slot="sidebar-cozy-project"
            class="flex h-full w-full min-w-0 items-center gap-2 rounded-[6px] bg-transparent px-2 text-start text-[13px] leading-[var(--line-height-compact)] text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:text-v2-text-text-base focus-visible:outline-none"
            onClick={props.onToggle}
          >
            {body()}
          </button>
        </Show>
      </Tooltip>
      <span data-cozy-pin class="flex shrink-0 items-center">
        <IconButton
          icon={<Icon name="pin" />}
          variant="ghost-muted"
          size="small"
          aria-label={language.t(props.project.pinned ? "sidebar.recent.unpin" : "sidebar.recent.pin")}
          class="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          onClick={(event) => {
            event.stopPropagation()
            if (props.project.pinned) props.onUnpin()
            else props.onPin()
          }}
        />
      </span>
      <Menu gutter={6} modal={false} placement="bottom-end">
        <Menu.Trigger
          as={IconButton}
          variant="ghost-muted"
          size="small"
          icon={<Icon name="outline-dots" />}
          aria-label={language.t("common.moreOptions")}
        />
        <Menu.Portal>
          <Menu.Content>
            <Menu.Item onSelect={props.project.pinned ? props.onUnpin : props.onPin}>
              {language.t(props.project.pinned ? "sidebar.recent.unpin" : "sidebar.recent.pin")}
            </Menu.Item>
            <ProjectMenuItems
              server={props.project.conn}
              project={props.project.project}
              unread={props.actions.hasUnread(props.project.conn, props.project.project)}
              canImportSession={props.actions.canImportSession}
              importingSession={props.actions.importingSession()}
              canRevealProject={props.actions.canReveal}
              onOpenProjectNewSession={props.actions.openNewSession}
              onViewHistory={props.onViewHistory}
              onImportSession={props.actions.importSession}
              onEditProject={props.actions.edit}
              onRevealProject={props.actions.reveal}
              onClearNotifications={props.actions.clearNotifications}
            />
          </Menu.Content>
        </Menu.Portal>
      </Menu>
    </div>
  )
}
