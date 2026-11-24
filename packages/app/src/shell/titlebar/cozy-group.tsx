import { Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { useLanguage } from "@/runtime/i18n/language"

export function CozySectionHeader(props: {
  id: string
  label: string
  expanded: boolean
  onToggle: () => void
  onAdd?: () => void
  addLabel?: string
}) {
  return (
    <div class="group/header flex h-7 min-w-0 shrink-0 items-center rounded-[6px] pe-1 hover:bg-v2-overlay-simple-overlay-hover has-[:focus-visible]:bg-v2-overlay-simple-overlay-hover">
      <button
        id={props.id}
        type="button"
        aria-expanded={props.expanded}
        class="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-1.5 text-start text-[13px] leading-[var(--line-height-compact)] font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:text-v2-text-text-base focus-visible:outline-none"
        onClick={props.onToggle}
      >
        <span class="min-w-0 truncate">{props.label}</span>
        <Icon name={props.expanded ? "chevron-down" : "chevron-right"} class="shrink-0 text-v2-icon-icon-muted" />
      </button>
      <Show when={props.onAdd}>
        {(onAdd) => (
          <span class="hover-reveal pointer-events-none flex shrink-0 items-center opacity-0 group-hover/header:pointer-events-auto group-hover/header:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            <IconButton
              icon={<Icon name="folder-add-left" />}
              variant="ghost-muted"
              size="small"
              aria-label={props.addLabel}
              onClick={() => onAdd()()}
            />
          </span>
        )}
      </Show>
    </div>
  )
}

export function CozyPager(props: { less: boolean; more: boolean; onLess: () => void; onMore: () => void }) {
  const language = useLanguage()

  return (
    <Show when={props.less || props.more}>
      <div class="flex shrink-0 items-center justify-between gap-2">
        <Show when={props.less} fallback={<span />}>
          <Button variant="ghost-muted" size="normal" class="justify-start px-2" onClick={props.onLess}>
            {language.t("sidebar.inbox.showLess")}
          </Button>
        </Show>
        <Show when={props.more}>
          <Button variant="ghost-muted" size="normal" class="ms-auto justify-end px-2" onClick={props.onMore}>
            {language.t("sidebar.inbox.showMore")}
          </Button>
        </Show>
      </div>
    </Show>
  )
}
