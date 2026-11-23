import { Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"

export function CozySectionHeader(props: { id: string; label: string; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      id={props.id}
      type="button"
      aria-expanded={props.expanded}
      class="flex h-6 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-start text-[13px] leading-4 font-medium text-v2-text-text-muted hover:text-v2-text-text-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
      onClick={props.onToggle}
    >
      <span class="min-w-0 truncate">{props.label}</span>
      <Icon
        name="fill-triangle-down"
        class="shrink-0 text-v2-icon-icon-muted transition-transform motion-reduce:transition-none"
        classList={{ "-rotate-90 rtl:rotate-90": !props.expanded }}
      />
    </button>
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
