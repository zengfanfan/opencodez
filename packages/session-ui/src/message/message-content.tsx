import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
  type ComponentProps,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useData } from "../context"
import { useDialog } from "@opencode/ui/context/dialog"
import { useI18n } from "@opencode/ui/context/i18n"
import { Markdown } from "../components/markdown"
import { linkSegments } from "../components/link-segments"
import { LinkedText } from "../components/linked-text"
import {
  sessionReferenceClipboardText,
  sessionReferenceText,
  setupSessionLinks,
} from "../components/markdown-session-links"
import { useMarkdown } from "../context/markdown"
import { useSources } from "../context/sources"
import { SourcesChip } from "../sources/sources-chip"
import type { TurnSources } from "../sources/sources"
import { ImagePreview } from "@opencode/ui/image-preview"
import { getFilename } from "@opencode/util/path"
import { AttachmentCard } from "./attachment-card"
import { CommentCard, commentCardTarget, quoteTooltip } from "./comment-card"
import { TimelineSeparator } from "../components/timeline-separator"
import { Tooltip } from "@opencode/ui/tooltip"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Button } from "@opencode/ui/button"
import { TextReveal } from "@opencode/ui/text-reveal"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { BasicTool } from "../components/basic-tool"
import { createDisclosure } from "../components/disclosure"
import { reasoningHeading } from "../timeline/projection"
import { Card } from "@opencode/ui/card"
import { springStyle } from "@opencode/ui/motion/solid"
import { userRunSpring, type UserRun } from "../timeline/user-runs"
import type {
  PromptAgentAttachment,
  PromptAttachment,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageCompaction,
  SessionMessageUser,
} from "@opencode/client/promise"
import type { SessionUserActions, SessionUserAttachmentReference, SessionUserComment } from "../actions"
import { agentIcon } from "./agent-icon"
import { agentLabel } from "./agent-label"
import { formatMetaText, type MetaItem } from "./message-meta"
import { messageTime, messageTimeDetail } from "./message-time"
import { isInterruptedError } from "../timeline/turn-phase-machine"
import { attached, typeLabel } from "../components/message-file"
import {
  DISPOSED_ATTACHMENT_MEDIA_EVENT,
  INITIAL_ATTACHMENT_MEDIA_STATE,
  resolveAttachmentMediaTarget,
  transitionAttachmentMedia,
  viewAttachmentMedia,
  type AttachmentMediaEvent,
} from "./attachment-media-machine"
import {
  createCompactionEntranceState,
  DISPOSED_COMPACTION_ENTRANCE_EVENT,
  GRACE_ELAPSED_EVENT,
  selectCompactionEnter,
  transitionCompactionEntrance,
  type CompactionEntranceEffect,
  type CompactionEntranceEvent,
} from "./compaction-entrance-machine"
import {
  createMessageActionState,
  transitionMessageAction,
  viewMessageActions,
  type MessageAction,
  type MessageActionCapabilities,
  type MessageActionEvent,
} from "./action-machine"
import {
  createPacedTextState,
  DISPOSED_PACED_TEXT_EVENT,
  TEXT_RENDER_PACE_MS,
  transitionPacedText,
  type PacedTextEvent,
} from "./paced-text-machine"
import { createCopyFeedback } from "../components/copy"

// The variant follows the model name without a separator, so the model leads.
function modelItems(data: ReturnType<typeof useData>, model: SessionMessageAssistant["model"]): MetaItem[] {
  const name = data.store.provider?.all?.get(model.providerID)?.models?.[model.id]?.name ?? model.id

  // A prompt held for its Location's catalog names no model yet.
  if (!name) return []

  if (!model.variant || model.variant === "default") return [{ label: name }]

  return [{ label: name }, { label: model.variant[0]?.toUpperCase() + model.variant.slice(1), variant: true }]
}

function MessageActionButton(
  props: Pick<ComponentProps<"button">, "disabled" | "onMouseDown" | "onClick" | "aria-label"> & {
    copied: boolean
    label: JSX.Element
    size?: "small" | "normal"
  },
) {
  return (
    <Tooltip appearance="compact" value={props.label} placement="top" gutter={4} forceOpen={props.copied || undefined}>
      <IconButton
        icon={<Icon name={props.copied ? "check" : "copy"} />}
        size={props.size ?? "normal"}
        variant="ghost-muted"
        disabled={props.disabled}
        onMouseDown={props.onMouseDown}
        onClick={props.onClick}
        aria-label={props["aria-label"]}
      />
    </Tooltip>
  )
}

// The reply and user footers share one time control so their format, tooltip and touch behavior cannot drift.
function MessageTime(props: {
  at: number
  label: string
  detail: string
  slot: "text-part-completed-at" | "user-message-time"
}) {
  const hoverNone = createMediaQuery("(hover: none)")
  const [focus, setFocus] = createSignal(false)
  const [lastPointer, setLastPointer] = createSignal<"touch" | "mouse" | "other">("other")

  return (
    <Tooltip
      value={props.detail}
      appearance="standard"
      placement="top"
      inactive={hoverNone()}
      forceOpen={focus() ? true : undefined}
      openDelay={focus() ? 0 : 600}
    >
      <time
        data-slot={props.slot}
        dateTime={new Date(props.at).toISOString()}
        dir="auto"
        tabIndex={hoverNone() ? undefined : 0}
        aria-label={props.detail}
        onPointerDown={(event) => setLastPointer(event.pointerType === "touch" ? "touch" : "mouse")}
        onFocus={(event) => {
          if (lastPointer() === "touch") {
            setLastPointer("other")

            return
          }

          if (event.currentTarget.matches(":focus-visible")) setFocus(true)
        }}
        onBlur={() => setFocus(false)}
      >
        {props.label}
      </time>
    </Tooltip>
  )
}

// Both footers use the same agent icon. A pointerdown outside this icon's own root closes its open tooltip, so opening
// another message's icon never leaves two tooltips up.
function MessageAgentIcon(props: {
  agent: string | undefined
  details: string
  slot: "text-part-agent" | "user-message-agent"
}) {
  const hoverNone = createMediaQuery("(hover: none)")
  const [focus, setFocus] = createSignal(false)
  const [tipOpen, setTipOpen] = createSignal(false)
  const [lastPointer, setLastPointer] = createSignal<"touch" | "mouse" | "other">("other")

  let root: HTMLSpanElement | undefined

  createEffect(() => {
    if (!tipOpen()) return

    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && root?.contains(event.target)) return

      setTipOpen(false)
    }

    document.addEventListener("pointerdown", close, true)
    onCleanup(() => document.removeEventListener("pointerdown", close, true))
  })

  return (
    <Tooltip
      value={props.details}
      appearance="compact"
      placement="top"
      forceOpen={tipOpen() || focus() ? true : undefined}
      openDelay={tipOpen() || focus() ? 0 : 600}
    >
      <span
        ref={root}
        data-slot={props.slot}
        tabIndex={hoverNone() ? undefined : 0}
        onPointerDown={(event) => setLastPointer(event.pointerType === "touch" ? "touch" : "mouse")}
        onPointerUp={(event) => {
          if (event.pointerType !== "touch") return

          setTipOpen((open) => !open)
        }}
        onFocus={(event) => {
          if (lastPointer() === "touch") {
            setLastPointer("other")

            return
          }

          if (event.currentTarget.matches(":focus-visible")) setFocus(true)
        }}
        onBlur={() => setFocus(false)}
      >
        <span class="sr-only">{props.details}</span>
        <Icon name={agentIcon(props.agent)} size="small" />
      </span>
    </Tooltip>
  )
}

// Footer actions stay icon-only and compact, matching the reply footer's controls.
function MessageIconButton(props: {
  icon: ComponentProps<typeof Icon>["name"]
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip appearance="compact" value={props.label} placement="top" gutter={4}>
      <IconButton
        icon={<Icon name={props.icon} />}
        size="small"
        variant="ghost-muted"
        disabled={props.disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={props.onClick}
        aria-label={props.label}
      />
    </Tooltip>
  )
}

// Token streaming dispatches here on every delta: the driver reuses one sync and one tick event, and the machine
// returns the same state when a delta changes nothing.
function createPacedValue(getValue: () => string, live?: () => boolean) {
  let state = createPacedTextState(untrack(getValue))
  const [value, setValue] = createSignal(untrack(getValue))
  let timer: ReturnType<typeof setTimeout> | undefined
  const syncEvent = { type: "sync" as const, text: "", live: false }
  const tickEvent = { type: "tick" as const, attempt: 0 }

  const tick = () => {
    timer = undefined
    dispatch(tickEvent)
  }

  const dispatch = (event: PacedTextEvent) => {
    const previous = state
    state = transitionPacedText(previous, event)

    if (state === previous) return

    if (state.status !== "pacing") {
      clearTimeout(timer)
      timer = undefined
    }

    if (state.status === "disposed" || previous.status === "disposed") return

    if (state.shown !== previous.shown) setValue(state.shown)

    if (state.status !== "pacing" || (previous.status === "pacing" && previous.attempt === state.attempt)) return
    tickEvent.attempt = state.attempt
    timer = setTimeout(tick, TEXT_RENDER_PACE_MS)
  }

  createEffect(() => {
    syncEvent.text = getValue()
    syncEvent.live = live?.() ?? false
    dispatch(syncEvent)
  })

  onCleanup(() => dispatch(DISPOSED_PACED_TEXT_EVENT))

  return value
}

export function PacedMarkdown(props: { text: string; cacheKey: string; streaming: boolean }) {
  const value = createPacedValue(
    () => props.text,
    () => props.streaming,
  )

  return (
    <Show when={value()}>
      <Markdown text={value()} cacheKey={props.cacheKey} streaming={props.streaming} deferUntilReady />
    </Show>
  )
}

function UserMessageComments(props: { comments: SessionUserComment[]; bounded: boolean }) {
  const i18n = useI18n()
  const [state, setState] = createStore({ expanded: false })
  const comments = createMemo(() => (props.bounded && !state.expanded ? props.comments.slice(0, 5) : props.comments))

  return (
    <div data-slot="user-message-comments" data-bounded={props.bounded ? "true" : undefined}>
      <For each={comments()}>
        {(comment) => (
          <CommentCard
            comment={comment.comment ?? ""}
            target={commentCardTarget(comment)}
            title={comment.type === "quote" ? quoteTooltip(comment) : comment.comment || undefined}
            tooltip
            wide
          />
        )}
      </For>
      <Show when={props.bounded && props.comments.length > 5 && !state.expanded}>
        <Button size="small" variant="ghost-muted" onClick={() => setState("expanded", true)}>
          {i18n.t("ui.common.showMore")}
        </Button>
      </Show>
    </div>
  )
}

export function CurrentUserMessageDisplay(props: {
  sessionID: string
  message: SessionMessageUser
  text: string
  agent: string
  model: SessionMessageAssistant["model"]
  actions?: SessionUserActions
  comments?: SessionUserComment[]
  references?: SessionUserAttachmentReference[]
  voice?: boolean
  run?: UserRun
  /** The newest delivered prompt, whose revert undoes the last turn. */
  latest?: boolean
  /** Whether run changes snap now, while a message arrives, rather than spring. Omitted, the corner always snaps. */
  runSnaps?: () => boolean
  /** Whether the footer shows the agent icon. A child session's bottom bar already names the agent and model. */
  showAgent?: boolean
  /** Folds a long message to its first lines with a Read more toggle. Omitted, the message always shows in full. */
  fold?: boolean
  /** Whether a folded message is open. The timeline owns it so it survives row recycling. */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}) {
  const data = useData()
  const dialog = useDialog()
  const i18n = useI18n()

  const fold = createDisclosure({
    open: () => props.expanded,
    onOpenChange: (expanded) => props.onExpandedChange?.(expanded),
  })

  const expanded = fold.open
  const setExpanded = fold.setOpen

  const status = createMemo(() => props.actions?.pending?.status(props.message.id))
  // A prompt still `sending` has no server row yet, so nothing can move, delete, revert or fork it.
  const sending = createMemo(() => status() === "sending")
  const pending = createMemo(() => status() !== undefined && status() !== "queued" && !sending())
  const waiting = createMemo(() => status() === "steering" || status() === "stranded" || sending())
  // SAFETY: opted-in reads leave stored files as `media:` refs, a PromptAttachment variant the generated message type does not list.
  const files = createMemo(() => (props.message.files ?? []) as PromptAttachment[])
  const attachments = createMemo(() => files().filter(attached))
  const references = createMemo(() => props.references ?? [])
  const inlineFiles = createMemo(() => files().filter((file) => !!file.mention))
  const agents = createMemo(() => props.message.agents ?? [])
  const comments = createMemo(() => props.comments ?? [])
  const copyText = () => (props.voice ? props.text : props.message.text)

  const agentItems = createMemo<MetaItem[]>(() => {
    const agent = agentLabel(props.agent, data.agents)

    return agent ? [{ label: agent }] : []
  })

  const sent = createMemo(() => messageTime(props.message.time.created, i18n.locale()))
  const sentDetail = createMemo(() => messageTimeDetail(props.message.time.created, i18n.locale()))

  const agentDetails = createMemo(
    () => formatMetaText([...agentItems(), ...modelItems(data, props.model)]) || i18n.t("ui.message.agentDetails"),
  )

  // Bubble corners tighten where two bubbles meet, as in the iOS app's grouped corners.
  const meetsBelow = createMemo(() => !!props.run?.below && !!props.text)

  const meetsAbove = createMemo(
    () => !!props.run?.above && !!props.text && attachments().length === 0 && references().length === 0,
  )

  const runPose = () => ({
    top: meetsAbove() ? 1 : 0,
    bottom: meetsBelow() ? 1 : 0,
  })

  // The first paint is the resting pose; the spring's first write lands a frame later.
  const restingPose = untrack(runPose)

  let root: HTMLDivElement | undefined
  springStyle(
    () => root,
    runPose,
    (el, value) => {
      el.style.setProperty("--user-run-top", `${value.top}`)
      el.style.setProperty("--user-run-bottom", `${value.bottom}`)
    },
    // A bubble that meets the one below snaps its corner while the next message grows in; otherwise it springs.
    { ...userRunSpring, snap: () => meetsBelow() && (props.runSnaps?.() ?? true) },
  )

  const copy = createCopyFeedback()
  const copyFull = createCopyFeedback()

  const [action, setAction] = createSignal(createMessageActionState())

  const capabilities = createMemo<MessageActionCapabilities>(() => ({
    pending: pending(),
    canPending: !!props.actions?.pending,
    canRevert: !!props.actions?.revert,
    canFork: !!props.actions?.fork,
  }))

  const actionView = createMemo(() => viewMessageActions(action(), capabilities()))

  const runAction = (kind: MessageAction) => {
    const input = { sessionID: props.sessionID, messageID: props.message.id }

    if (kind === "queue") return props.actions?.pending?.queue(input)

    if (kind === "remove") return props.actions?.pending?.remove(input)

    if (kind === "revert") return props.actions?.revert?.(input)

    return props.actions?.fork?.(input)
  }

  const dispatch = (event: MessageActionEvent) => {
    const next = transitionMessageAction(action(), event)
    setAction(next.state)
    next.effects.forEach((effect) => {
      // The executor turns a synchronous throw into a rejection, so every outcome settles the attempt.
      void new Promise<void>((resolve) => resolve(runAction(effect.action))).then(
        () => dispatch({ type: "succeeded", attempt: effect.attempt }),
        () => dispatch({ type: "failed", attempt: effect.attempt }),
      )
    })
  }

  const request = (kind: MessageAction) => dispatch({ type: "requested", action: kind, capabilities: capabilities() })

  onCleanup(() => dispatch({ type: "disposed" }))

  const renderAttachments = () => (
    <Show when={attachments().length > 0 || references().length > 0}>
      <div data-slot="user-message-attachments">
        <For each={references()}>
          {(file) => (
            <AttachmentCard title={file.name} hover={file.path}>
              {typeLabel(file.name, file.mime, i18n.t("ui.common.file"))}
            </AttachmentCard>
          )}
        </For>
        <Index each={attachments()}>
          {(file) => {
            const mediaTarget = createMemo(() =>
              resolveAttachmentMediaTarget(file(), { peekMedia: data.peekMedia, hasReader: !!data.readMedia }),
            )

            const [mediaState, setMediaState] = createSignal(INITIAL_ATTACHMENT_MEDIA_STATE)
            let mediaController: AbortController | undefined
            let mediaTimer: ReturnType<typeof setTimeout> | undefined

            const dispatchMedia = (event: AttachmentMediaEvent) => {
              const step = transitionAttachmentMedia(untrack(mediaState), event)
              setMediaState(step.state)
              step.effects.forEach((effect) => {
                if (effect.type === "cancel") {
                  clearTimeout(mediaTimer)
                  mediaTimer = undefined
                  mediaController?.abort()
                  mediaController = undefined

                  return
                }

                const controller = new AbortController()
                const readMedia = data.readMedia
                mediaController = controller
                mediaTimer = setTimeout(
                  () => dispatchMedia({ type: "read.timed-out", attempt: effect.attempt }),
                  effect.timeoutMs,
                )
                // A read that resolves, rejects or throws settles its attempt.
                void Promise.resolve()
                  .then(() => readMedia?.(effect.uri, effect.mime, controller.signal))
                  .then(
                    (loaded) =>
                      dispatchMedia(
                        loaded
                          ? { type: "read.succeeded", attempt: effect.attempt, src: loaded }
                          : { type: "read.failed", attempt: effect.attempt },
                      ),
                    () => dispatchMedia({ type: "read.failed", attempt: effect.attempt }),
                  )
              })
            }

            createEffect(() => dispatchMedia({ type: "target.synced", target: mediaTarget() }))
            onCleanup(() => dispatchMedia(DISPOSED_ATTACHMENT_MEDIA_EVENT))

            const mediaView = createMemo(() => viewAttachmentMedia(mediaState(), mediaTarget()))
            const name = () => file().name ?? i18n.t("ui.message.attachment.alt")
            const image = () => file().mime.startsWith("image/")

            const width = () => {
              const current = file()

              return "width" in current ? current.width : undefined
            }

            const height = () => {
              const current = file()

              return "height" in current ? current.height : undefined
            }

            return (
              <Show
                when={!image()}
                fallback={
                  <div
                    data-slot="user-message-attachment"
                    data-type="image"
                    data-clickable={mediaView().clickable ? "true" : undefined}
                    data-placeholder={mediaView().placeholder ? "true" : undefined}
                    data-width={width()}
                    data-height={height()}
                    onClick={(event) => {
                      const src = mediaView().src
                      const origin = event.currentTarget

                      if (src) return dialog.show(() => <ImagePreview src={src} alt={name()} origin={origin} />)

                      if (mediaView().canRetry) dispatchMedia({ type: "retry.requested", target: mediaTarget() })
                    }}
                  >
                    <Switch>
                      <Match when={mediaView().src}>
                        {(src) => (
                          <img
                            data-slot="user-message-attachment-image"
                            src={src()}
                            width={width()}
                            height={height()}
                            alt={name()}
                          />
                        )}
                      </Match>
                      <Match when={mediaView().status === "failed"}>
                        <div
                          data-slot="user-message-attachment-icon"
                          role="img"
                          aria-label={i18n.t("ui.fileMedia.state.error", {
                            kind: i18n.t("ui.fileMedia.kind.image"),
                          })}
                        >
                          <Icon name="outline-photo" size="small" />
                        </div>
                      </Match>
                    </Switch>
                  </div>
                }
              >
                <AttachmentCard
                  title={getFilename(name())}
                  hover={name()}
                  clickable={!!props.actions?.openAttachment}
                  onClick={() => props.actions?.openAttachment?.(file())}
                >
                  {typeLabel(name(), file().mime, i18n.t("ui.common.file"))}
                </AttachmentCard>
              </Show>
            )
          }}
        </Index>
      </div>
    </Show>
  )

  return (
    <div
      ref={root}
      data-component="user-message"
      data-pending={waiting() ? "true" : undefined}
      style={{
        "--user-run-top": `${restingPose.top}`,
        "--user-run-bottom": `${restingPose.bottom}`,
      }}
      data-timeline-part-id={props.text ? `${props.message.id}:text:0` : undefined}
    >
      {renderAttachments()}
      <Show
        when={props.text}
        fallback={
          <Show when={comments().length > 0}>
            <UserMessageComments comments={comments()} bounded={false} />
          </Show>
        }
      >
        <div data-slot="user-message-body" data-voice={props.voice ? "true" : undefined}>
          <Show when={props.voice}>
            <div data-slot="user-message-voice" role="img" aria-label={i18n.t("ui.message.voice")}>
              <Tooltip appearance="compact" value={i18n.t("ui.message.voice")} placement="top" gutter={4}>
                <Icon name="outline-wave-audio" size="small" />
              </Tooltip>
            </div>
          </Show>
          <div
            data-slot="user-message-text"
            dir="auto"
            data-comments={comments().length > 0 ? "true" : undefined}
            onCopy={copySessionReferences}
          >
            <Show
              when={props.fold}
              fallback={<CurrentHighlightedText text={props.text} files={inlineFiles()} agents={agents()} />}
            >
              <UserMessageFold
                id={`${props.message.id}-text`}
                text={props.text}
                expanded={expanded()}
                onExpandedChange={setExpanded}
              >
                <CurrentHighlightedText text={props.text} files={inlineFiles()} agents={agents()} />
              </UserMessageFold>
            </Show>
            <Show when={comments().length > 0}>
              <UserMessageComments comments={comments()} bounded />
            </Show>
          </div>
        </div>
      </Show>
      {/* The footer stays visible; waiting states swap the time for Pending, and each state keeps only its actions. */}
      <Show when={props.text || comments().length > 0 || pending() || waiting()}>
        <div data-slot="user-message-footer">
          <Show
            when={waiting()}
            fallback={
              <MessageTime
                slot="user-message-time"
                at={props.message.time.created}
                label={sent()}
                detail={sentDetail()}
              />
            }
          >
            <span data-slot="user-message-pending">{i18n.t("ui.message.pending")}</span>
          </Show>
          <Show when={props.showAgent !== false}>
            <MessageAgentIcon slot="user-message-agent" agent={props.agent} details={agentDetails()} />
          </Show>
          <Show when={pending() && props.actions?.pending}>
            <MessageIconButton
              icon="bullet-list"
              label={i18n.t("ui.message.moveToQueue")}
              disabled={actionView().disabled.queue}
              onClick={() => request("queue")}
            />
          </Show>
          <Show when={!pending() && !sending() && props.actions?.fork}>
            <MessageIconButton
              icon="fork"
              label={i18n.t("ui.message.forkMessage")}
              disabled={actionView().disabled.fork}
              onClick={() => request("fork")}
            />
          </Show>
          <MessageActionButton
            copied={copy.copied()}
            size="small"
            label={copy.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
            disabled={!copyText()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => copy.copy(copyText())}
            aria-label={copy.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
          />
          <Show when={props.voice}>
            <MessageActionButton
              copied={copyFull.copied()}
              size="small"
              label={copyFull.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyFullMessage")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => copyFull.copy(props.message.text)}
              aria-label={
                copyFull.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyFullMessage")
              }
            />
          </Show>
          <Show when={!pending() && !sending() && props.actions?.revert}>
            <MessageIconButton
              icon="reset"
              label={props.latest ? i18n.t("ui.message.undoMessage") : i18n.t("ui.message.revertMessage")}
              disabled={actionView().disabled.revert}
              onClick={() => request("revert")}
            />
          </Show>
          <Show when={pending() && props.actions?.pending}>
            <MessageIconButton
              icon="trash"
              label={i18n.t("ui.message.deletePending")}
              disabled={actionView().disabled.remove}
              onClick={() => request("remove")}
            />
          </Show>
        </div>
      </Show>
    </div>
  )
}

// The OpenCode iOS app's fold (UserBubbleFold): a message past 12 lines shows its first 8, so a fold always hides at
// least 5 lines and a message just past the limit never folds away a line or two.
const USER_MESSAGE_FOLD = { over: 12, show: 8 }

function UserMessageFold(props: {
  id: string
  text: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  children: JSX.Element
}) {
  const i18n = useI18n()
  // Hard line breaks are a floor on the laid-out lines, so most long messages fold before the row is first measured.
  const [lines, setLines] = createSignal(props.text.trimEnd().split("\n").length)
  const long = () => lines() > USER_MESSAGE_FOLD.over
  const folded = () => long() && !props.expanded

  let content: HTMLDivElement | undefined
  let toggle: HTMLButtonElement | undefined

  // The text is laid out whole and clipped, so its own height is the measure at any width.
  const measure = () => {
    // A cached tab's timeline is detached while hidden and measures 0.
    if (!content?.isConnected || content.offsetHeight === 0) return
    const lineHeight = parseFloat(getComputedStyle(content).lineHeight) || 20
    setLines(Math.round(content.offsetHeight / lineHeight))
  }

  onMount(() => {
    // The bubble gets its wrapping width after the surrounding view mounts.
    queueMicrotask(measure)
    const observer = new ResizeObserver(measure)
    observer.observe(content!)
    onCleanup(() => observer.disconnect())
  })

  // Opening grows the row downward, so its top stays put. Closing a message whose top is scrolled above the screen
  // would leave the reader past its end, so then the toggle stays where it was pressed.
  const flip = () => {
    const opening = !props.expanded
    const scroller = toggle ? scrollParent(toggle) : undefined
    const above = !!content && !!scroller && content.getBoundingClientRect().top < viewportTop(scroller)
    const before = toggle?.getBoundingClientRect().top
    props.onExpandedChange(opening)

    if (opening || !above || before === undefined || !toggle || !scroller) return
    const moved = before - toggle.getBoundingClientRect().top

    if (moved > 1) scroller.scrollTop -= moved
  }

  return (
    <>
      <div
        id={props.id}
        data-slot="user-message-fold"
        data-folded={folded() ? "" : undefined}
        style={{ "max-height": folded() ? `${USER_MESSAGE_FOLD.show}lh` : undefined }}
      >
        <div ref={content}>{props.children}</div>
      </div>
      <Show when={long()}>
        <button
          ref={toggle}
          type="button"
          data-slot="user-message-fold-toggle"
          aria-expanded={props.expanded}
          aria-controls={props.id}
          onClick={flip}
        >
          <span>{props.expanded ? i18n.t("ui.message.showLess") : i18n.t("ui.message.readMore")}</span>
          <Icon name="chevron-down" />
        </button>
      </Show>
    </>
  )
}

function viewportTop(scroller: Element) {
  return scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
}

function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY

    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node
  }

  return document.scrollingElement
}

function CurrentHighlightedText(props: { text: string; files: PromptAttachment[]; agents: PromptAgentAttachment[] }) {
  const segments = createMemo(() => {
    const references = [
      ...props.files.flatMap((file) =>
        file.mention ? [{ start: file.mention.start, end: file.mention.end, type: "file" as const }] : [],
      ),
      ...props.agents.flatMap((agent) =>
        agent.mention ? [{ start: agent.mention.start, end: agent.mention.end, type: "agent" as const }] : [],
      ),
    ].sort((a, b) => a.start - b.start)

    const result: HighlightSegment[] = []

    // Plain text between references may contain URLs, which become links.
    const pushText = (text: string) =>
      result.push(
        ...linkSegments(text).map(
          (segment): HighlightSegment => ({
            text: segment.text,
            type: segment.href ? "link" : undefined,
          }),
        ),
      )

    let last = 0
    references.forEach((reference) => {
      if (reference.start < last) return

      if (reference.start > last) pushText(props.text.slice(last, reference.start))
      result.push({ text: props.text.slice(reference.start, reference.end), type: reference.type })
      last = reference.end
    })

    if (last < props.text.length) pushText(props.text.slice(last))

    return result
  })

  return (
    <For each={segments()}>
      {(segment) => (
        <Show
          when={segment.type === "link"}
          fallback={
            <span data-highlight={segment.type}>
              <Show
                when={segment.type && segment.text.startsWith("@")}
                fallback={<SessionReferenceText text={segment.text} />}
              >
                <span data-slot="user-message-mention-prefix">@</span>
                {segment.text.slice(1)}
              </Show>
            </span>
          }
        >
          <a data-slot="user-message-link" href={segment.text} target="_blank" rel="noopener noreferrer">
            {segment.text}
          </a>
        </Show>
      )}
    </For>
  )
}

type HighlightSegment = { text: string; type?: "file" | "agent" | "link" }

function copySessionReferences(event: ClipboardEvent & { currentTarget: HTMLDivElement }) {
  const selection = window.getSelection()

  if (event.defaultPrevented || !event.clipboardData || !selection || selection.isCollapsed) return
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index))

  if (!ranges.every((range) => event.currentTarget.contains(range.commonAncestorContainer))) return
  const text = sessionReferenceClipboardText(event.currentTarget, ranges)

  if (text === undefined) return
  event.preventDefault()
  event.clipboardData.setData("text/plain", text)
}

function SessionReferenceText(props: { text: string }) {
  const markdown = useMarkdown()
  const root = document.createElement("span")
  createEffect(() => root.replaceChildren(sessionReferenceText(props.text, (id) => markdown?.sessionTitle?.(id))))
  onCleanup(
    setupSessionLinks(
      root,
      () => markdown?.openSession,
      () => markdown?.sessionMenu,
    ),
  )

  return root
}

/** A compaction the server admitted but has not started, drawn as the divider a started one opens with. */
export function SessionCompactionQueued() {
  const i18n = useI18n()

  return (
    <div data-component="session-compaction-message">
      <CompactionDivider label={i18n.t("ui.messagePart.compaction.queued")} />
    </div>
  )
}

function CompactionDivider(props: { label: string }) {
  return (
    <div class="py-2">
      <TimelineSeparator label={props.label} />
    </div>
  )
}

export function SessionCompactionMessage(props: { message: SessionMessageCompaction; error: string }) {
  const i18n = useI18n()
  const summary = () => (props.message.status === "failed" ? "" : props.message.summary)

  const error = () => {
    if (props.message.status !== "failed") return ""

    if (props.message.error.type === "aborted" || props.message.error.type === "compaction.interrupted") return ""

    return props.error
  }

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  // Usage of the compaction request itself; the resulting context size only shows on the next assistant step.
  const usage = () => {
    if (props.message.status === "running" || !props.message.tokens) return ""
    const tokens = props.message.tokens
    const input = tokens.input + tokens.cache.read + tokens.cache.write
    const output = tokens.output + tokens.reasoning

    if (input + output <= 0) return ""

    return i18n.t("ui.messagePart.compaction.usage", {
      input: compact().format(input),
      output: compact().format(output),
    })
  }

  const outcome = () => {
    if (props.message.status !== "failed")
      return props.message.status === "completed" && props.message.native?.messages
        ? "ui.messagePart.providerCompaction"
        : "ui.messagePart.compaction"

    if (props.message.error.type === "aborted") return "ui.messagePart.compaction.cancelled"

    if (props.message.error.type === "compaction.interrupted") return "ui.messagePart.compaction.interrupted"

    return "ui.messagePart.compaction.failed"
  }

  const label = createMemo(() => [i18n.t(outcome()), usage()].filter(Boolean).join(" · "))

  return (
    <Show
      when={props.message.reason === "manual" || props.message.status === "failed"}
      fallback={
        <QuietCompaction
          id={props.message.id}
          created={props.message.time.created}
          running={props.message.status === "running"}
          summary={summary()}
          usage={usage()}
        />
      }
    >
      <div data-component="session-compaction-message">
        <CompactionDivider label={i18n.t("ui.messagePart.compaction.started")} />
        <Show when={summary().trim()}>
          <div data-component="text-part" data-timeline-part-id={props.message.id}>
            <div data-slot="text-part-body">
              <PacedMarkdown
                text={summary()}
                cacheKey={props.message.id}
                streaming={props.message.status === "running"}
              />
            </div>
          </div>
        </Show>
        <Show when={props.message.status === "running"}>
          <div role="status" class="py-2">
            <BasicTool
              icon="archive"
              trigger={{ title: i18n.t("ui.messagePart.compaction.running") }}
              status="running"
              locked
              hideDetails
            />
          </div>
        </Show>
        <Show when={props.message.status !== "running"}>
          <div class="py-2">
            <TimelineSeparator label={label()} />
          </div>
        </Show>
        <Show when={error()}>
          <Card variant="error" class="error-card">
            <LinkedText text={error()} />
          </Card>
        </Show>
      </div>
    </Show>
  )
}

/**
 * An automatic compaction, drawn as one divider that reads Compacting, then Compacted. Its height never changes, and
 * clicking it opens the summary.
 */
function QuietCompaction(props: { id: string; created: number; running: boolean; summary: string; usage: string }) {
  const i18n = useI18n()
  const [open, setOpen] = createSignal(false)
  // A new one waits out the grace before showing Compacting; one that ends inside it, as a precomputed summary does,
  // only fades in as Compacted. One already running or finished when the history loads shows without an entrance.
  const initial = createCompactionEntranceState({ ageMs: Date.now() - props.created, running: props.running })
  const [entrance, setEntrance] = createSignal(initial.state)
  const enter = createMemo(() => selectCompactionEnter(entrance()))
  let graceTimer: ReturnType<typeof setTimeout> | undefined

  const runEntrance = (effect: CompactionEntranceEffect) => {
    clearTimeout(graceTimer)
    graceTimer = undefined

    if (effect.type === "schedule-grace")
      graceTimer = setTimeout(() => dispatchEntrance(GRACE_ELAPSED_EVENT), effect.delayMs)
  }

  const dispatchEntrance = (event: CompactionEntranceEvent) => {
    const result = transitionCompactionEntrance(untrack(entrance), event)
    setEntrance(result.state)
    result.effects.forEach(runEntrance)
  }

  initial.effects.forEach(runEntrance)
  createEffect(() => dispatchEntrance({ type: "running.changed", running: props.running }))
  onCleanup(() => dispatchEntrance(DISPOSED_COMPACTION_ENTRANCE_EVENT))

  const expandable = () => !props.running && !!props.summary.trim()

  const label = createMemo(() =>
    splitEnding(i18n.t("ui.messagePart.compaction.running"), i18n.t("ui.messagePart.compaction.done")),
  )

  return (
    <div data-component="session-compaction-message" data-quiet="" data-enter={enter()}>
      <div class="py-2">
        <button
          type="button"
          data-slot="session-compaction-divider"
          data-state={props.running ? "running" : "done"}
          class="flex h-8 w-full items-center gap-3 text-v2-text-text-faint"
          disabled={!expandable()}
          aria-busy={props.running}
          aria-expanded={expandable() ? open() : undefined}
          aria-controls={expandable() && open() ? `${props.id}-summary` : undefined}
          aria-label={props.running ? label().running : label().done}
          onClick={() => setOpen((value) => !value)}
        >
          <span data-slot="session-compaction-line" data-side="start" class="h-px min-w-0 flex-1">
            <span data-slot="session-compaction-light" />
          </span>
          <span
            data-slot="session-compaction-label"
            class="relative flex shrink-0 whitespace-nowrap text-[13px] font-[440] leading-text-compact tracking-[-0.04px]"
          >
            <span>{label().stem}</span>
            <span data-slot="session-compaction-ending" class="grid justify-items-start">
              <span data-slot="session-compaction-running">{label().ending.running}</span>
              <span data-slot="session-compaction-done">{label().ending.done}</span>
            </span>
            <span data-slot="session-compaction-glint" aria-hidden="true">
              <span data-slot="session-compaction-glint-stem">{label().stem}</span>
              <span data-slot="session-compaction-glint-ending">{label().ending.running}</span>
            </span>
          </span>
          <span data-slot="session-compaction-line" data-side="end" class="h-px min-w-0 flex-1">
            <span data-slot="session-compaction-light" />
          </span>
        </button>
      </div>
      <Show when={expandable() && open()}>
        <div id={`${props.id}-summary`} data-slot="session-compaction-summary">
          <div data-component="text-part" data-timeline-part-id={props.id}>
            <div data-slot="text-part-body">
              <PacedMarkdown text={props.summary} cacheKey={props.id} streaming={false} />
            </div>
          </div>
          <Show when={props.usage}>
            <div class="mt-2 text-[13px] leading-text-compact text-v2-text-text-faint tabular-nums">{props.usage}</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/** Splits Compacting and Compacted at their shared stem, so only the ending changes when the compaction ends. */
function splitEnding(running: string, done: string) {
  const chars = [...running]
  const others = [...done]
  const at = chars.findIndex((char, index) => char !== others[index])
  const stem = chars.slice(0, at === -1 ? chars.length : at).join("")

  return { running, done, stem, ending: { running: running.slice(stem.length), done: done.slice(stem.length) } }
}

export function AssistantTextContent(props: {
  id: string
  text: string
  message: SessionMessageAssistant
  showCopy: boolean
  turnDurationMs?: number | null
  turnTokensPerSecond?: number
  /** When the turn's last completed assistant step finished, shown at rest beside the Copy button. */
  turnCompletedAt?: number
  /** A child session's bottom bar already names the agent and model, so its reply tooltip omits them. */
  hideAgentMeta?: boolean
  /** Whether the prompt that started this turn is in the timeline viewport. */
  isPromptVisible?: () => boolean
  /** Scrolls the timeline back to the prompt that started this turn. */
  onJumpToPrompt?: () => void
  /** The finished turn's web searches and fetches, shown as a chip in its footer. */
  sources?: TurnSources
  onOpenSources?: () => void
}) {
  const data = useData()
  const i18n = useI18n()
  const sourcesHost = useSources()
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))
  // A footer that arrives after the reply rendered belongs to a turn that just finished, so its chip fades in.
  let rendered = false
  onMount(() => (rendered = true))
  const sources = () => (props.showCopy && sourcesHost?.enabled ? props.sources : undefined)

  const interrupted = () => isInterruptedError(props.message.error)

  const labels = createMemo<MetaItem[]>(() => {
    if (props.hideAgentMeta) return []

    const agent = agentLabel(props.message.agent, data.agents)

    return [...(agent ? [{ label: agent }] : []), ...modelItems(data, props.message.model)]
  })

  const duration = createMemo(() => {
    const completed = props.message.time.completed

    const ms =
      props.turnDurationMs === null
        ? -1
        : props.turnDurationMs !== undefined
          ? props.turnDurationMs
          : completed !== undefined
            ? completed - props.message.time.created
            : -1

    if (!(ms >= 0)) return ""
    const total = Math.round(ms / 1000)

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt().format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt().format(Math.floor(total / 60)),
      seconds: numfmt().format(total % 60),
    })
  })

  const completedAt = createMemo(() => {
    const at = props.turnCompletedAt

    if (at === undefined) return undefined

    return { at, label: messageTime(at, i18n.locale()) }
  })

  const completedDetail = createMemo(() => {
    const value = completedAt()

    return value ? messageTimeDetail(value.at, i18n.locale()) : ""
  })

  const meta = createMemo<MetaItem[]>(() => [
    ...labels(),
    ...[duration(), interrupted() ? i18n.t("ui.message.interrupted") : ""].flatMap((label) =>
      label ? [{ label }] : [],
    ),
  ])

  const speed = createMemo(() => {
    if (props.turnTokensPerSecond === undefined) return undefined

    return i18n.t("ui.message.tokensPerSecond", {
      value: new Intl.NumberFormat(i18n.locale(), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }).format(props.turnTokensPerSecond),
    })
  })

  const agentDetails = createMemo(() => formatMetaText(meta(), speed()) || i18n.t("ui.message.agentDetails"))

  const copy = createCopyFeedback()

  return (
    <Show when={props.text}>
      <div data-component="text-part" data-timeline-part-id={props.id}>
        <div data-slot="text-part-body">
          <PacedMarkdown text={props.text} cacheKey={props.id} streaming={props.message.time.completed === undefined} />
        </div>
        <Show when={sources()} fallback={<Show when={props.showCopy}>{copyFooter()}</Show>}>
          {(value) => (
            <div data-slot="text-part-footer">
              <SourcesChip
                sources={value()}
                icons={sourcesHost?.icons ?? "letters"}
                appear={rendered}
                onOpen={() => props.onOpenSources?.()}
              />
              {copyFooter()}
            </div>
          )}
        </Show>
      </div>
    </Show>
  )

  function copyFooter() {
    return (
      <div data-slot="text-part-copy-wrapper" data-interrupted={interrupted() ? "" : undefined}>
        <MessageActionButton
          copied={copy.copied()}
          size="small"
          label={copy.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => copy.copy(props.text)}
          aria-label={copy.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyResponse")}
        />
        <MessageAgentIcon slot="text-part-agent" agent={props.message.agent} details={agentDetails()} />
        <Show when={completedAt()}>
          {(value) => (
            <MessageTime
              slot="text-part-completed-at"
              at={value().at}
              label={value().label}
              detail={completedDetail()}
            />
          )}
        </Show>
        <Show when={props.onJumpToPrompt && props.isPromptVisible && !props.isPromptVisible()}>
          <Tooltip appearance="compact" value={i18n.t("ui.message.jumpToPrompt")} placement="top" gutter={4}>
            <IconButton
              icon={<Icon name="arrow-up" />}
              size="small"
              variant="ghost-muted"
              aria-label={i18n.t("ui.message.jumpToPrompt")}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onJumpToPrompt?.()}
            />
          </Tooltip>
        </Show>
      </div>
    )
  }
}

export function AssistantReasoningContent(props: {
  id: string
  content: SessionMessageAssistantReasoning
  streaming: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onContentRendered?: () => void
}) {
  const i18n = useI18n()
  const heading = createMemo(() => (props.streaming ? reasoningHeading(props.content.text) : ""))

  const duration = createMemo(() => {
    const time = props.content.time

    if (time?.completed === undefined) return undefined
    const total = Math.max(0, Math.round((time.completed - time.created) / 1000))
    const numfmt = new Intl.NumberFormat(i18n.locale())

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt.format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt.format(Math.floor(total / 60)),
      seconds: numfmt.format(total % 60),
    })
  })

  return (
    <div data-component="reasoning-part" data-timeline-part-id={props.id}>
      <BasicTool
        icon="mcp"
        status={props.streaming ? "running" : "completed"}
        compact
        hasContent
        allowOpenWhilePending
        hideDetails={!props.content.text.trim()}
        open={props.open}
        defaultOpen={props.defaultOpen}
        onOpenChange={(value) => {
          props.onOpenChange?.(value)
          props.onContentRendered?.()
        }}
        trigger={(open) => (
          <div data-slot="basic-tool-tool-info-structured">
            <div data-slot="basic-tool-tool-info-main">
              <span data-slot="basic-tool-tool-title">
                <TextShimmer
                  text={i18n.t(props.streaming ? "ui.sessionTurn.status.thinking" : "ui.message.thought")}
                  active={props.streaming}
                />
              </span>
              <Show
                when={props.streaming && !open()}
                fallback={
                  <Show when={!props.streaming && duration()}>
                    {(value) => <span data-slot="basic-tool-tool-subtitle">{value()}</span>}
                  </Show>
                }
              >
                <span data-slot="basic-tool-tool-subtitle">
                  <TextReveal text={heading()} />
                </span>
              </Show>
            </div>
          </div>
        )}
      >
        <PacedMarkdown text={props.content.text} cacheKey={props.id} streaming={props.streaming} />
      </BasicTool>
    </div>
  )
}
