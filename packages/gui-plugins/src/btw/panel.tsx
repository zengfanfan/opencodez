import { createMemo, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import { createCopyFeedback } from "@opencode/session-ui/copy"
import { agentIcon } from "@opencode/session-ui/agent-icon"
import { Markdown } from "@opencode/session-ui/markdown"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type { BtwFailure } from "./machine"
import type { BtwModel } from "./model"

export default function SessionBtwPanel(props: { btw: BtwModel; session: MountedSession; id: string }) {
  const ctx = usePlugin()
  const i18n = useI18n()
  const view = createMemo(() => props.btw.view(props.session, props.id))

  const chat = createMemo(() => {
    const current = view()

    return current.phase === "loading" || current.phase === "missing" ? undefined : current
  })

  const running = createMemo(() => view().phase === "running")

  const failure = createMemo(() => {
    const current = view()

    return current.phase === "failed" ? current.failure : undefined
  })

  const answered = createMemo(() => {
    const current = view()

    return current.phase === "answered" ? current : undefined
  })

  const question = () => chat()?.question

  const failureDetail = (value: BtwFailure) => {
    if (value.reason === "empty") return ctx.t("error.empty")

    if (value.reason === "timeout") return ctx.t("error.timeout")

    if (value.reason === "error") return value.message

    return undefined
  }

  const timefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }))

  const detailfmt = createMemo(
    () =>
      new Intl.DateTimeFormat(i18n.locale(), {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }),
  )

  const timeDetail = (at: number) => detailfmt().format(at)
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))

  const agentLabel = createMemo(() => {
    const agent = chat()?.agent

    return agent ? agent[0]?.toUpperCase() + agent.slice(1) : ""
  })

  const modelLabel = createMemo(() => {
    const model = chat()?.model

    if (!model) return ""
    const ref = props.session.directory ? { directory: props.session.directory } : undefined
    const models = props.session.server.data.location.model.list(ref)

    const found = models?.findLast(
      (item) => item.providerID === model.providerID && item.id === model.id && item.status !== "deprecated",
    )

    const name = found?.name ?? model.id

    if (!model.variant || model.variant === "default") return name

    return i18n.t("ui.message.modelVariant", {
      model: name,
      variant: model.variant[0]?.toUpperCase() + model.variant.slice(1),
    })
  })

  const userMeta = createMemo(() => [agentLabel(), modelLabel()].filter(Boolean).join("\u00A0\u00B7\u00A0"))

  const created = createMemo(() => chat()?.created)

  const stamp = createMemo(() => {
    const value = created()

    return value !== undefined ? timefmt().format(value) : ""
  })

  const durationLabel = createMemo(() => {
    const ms = answered()?.duration

    if (ms === undefined || !(ms >= 0)) return ""
    const total = Math.round(ms / 1000)

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt().format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt().format(Math.floor(total / 60)),
      seconds: numfmt().format(total % 60),
    })
  })

  const answerMeta = createMemo(() => [agentLabel(), modelLabel(), durationLabel()].filter(Boolean).join(" \u00B7 "))

  // The reply footer's timestamp is the moment the answer finished: the question time plus its measured duration.
  const answerAt = createMemo(() => {
    const current = answered()

    if (current?.created === undefined || current.duration === undefined) return undefined
    const at = current.created + current.duration

    return { at, label: timefmt().format(at) }
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-btw-panel">
      <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
        <div class="min-w-0 w-full max-w-full px-4 pt-6 pb-8 md:max-w-session md:mx-auto md:px-6">
          <div data-component="user-message">
            <div data-slot="user-message-body">
              <div data-slot="user-message-text" dir="auto">
                {question()}
              </div>
            </div>
            <Show when={question()}>
              <div data-slot="user-message-footer">
                <Show when={created()}>
                  {(at) => (
                    <Timestamp slot="user-message-time" at={at()} label={stamp()} detail={timeDetail(at())} />
                  )}
                </Show>
                <Tooltip
                  appearance="compact"
                  value={userMeta() || i18n.t("ui.message.agentDetails")}
                  placement="top"
                  gutter={4}
                >
                  <span data-slot="user-message-agent" tabIndex={0}>
                    <span class="sr-only">{userMeta() || i18n.t("ui.message.agentDetails")}</span>
                    <Icon name={agentIcon(chat()?.agent)} size="small" />
                  </span>
                </Tooltip>
                <CopyButton
                  size="small"
                  text={question()}
                  label={i18n.t("ui.message.copyMessage")}
                  copiedLabel={i18n.t("ui.message.copied")}
                />
              </div>
            </Show>
          </div>

          <Switch>
            <Match when={running()}>
              <div
                data-component="session-working"
                role="status"
                class="flex h-9 items-center pt-3 text-[13px] font-[530] leading-text-compact"
              >
                <TextShimmer text={ctx.t("session.timeline.working")} active />
              </div>
            </Match>
            <Match when={failure()}>
              {(current) => (
                <div class="flex flex-col items-start gap-3 pt-4">
                  <div class="flex flex-col gap-1">
                    <div class="text-13-regular text-text-weak">{ctx.t("error")}</div>
                    <Show when={failureDetail(current())}>
                      {(detail) => <div class="text-12-regular text-text-weak break-words">{detail()}</div>}
                    </Show>
                  </div>
                  <Button size="small" variant="outline" onClick={() => props.btw.retry(props.session, props.id)}>
                    {ctx.t("retry")}
                  </Button>
                </div>
              )}
            </Match>
            <Match when={answered()}>
              {(reply) => (
                <div data-component="text-part">
                  <div data-slot="text-part-body">
                    <Markdown text={reply().answer} class="text-14-regular" />
                  </div>
                  <div data-slot="text-part-copy-wrapper">
                    <CopyButton
                      size="small"
                      text={reply().answer}
                      label={i18n.t("ui.message.copyResponse")}
                      copiedLabel={i18n.t("ui.message.copied")}
                    />
                    <Tooltip
                      appearance="compact"
                      value={answerMeta() || i18n.t("ui.message.agentDetails")}
                      placement="top"
                      gutter={4}
                    >
                      <span data-slot="text-part-agent" tabIndex={0}>
                        <span class="sr-only">{answerMeta() || i18n.t("ui.message.agentDetails")}</span>
                        <Icon name={agentIcon(chat()?.agent)} size="small" />
                      </span>
                    </Tooltip>
                    <Show when={answerAt()}>
                      {(value) => (
                        <Timestamp
                          slot="text-part-completed-at"
                          at={value().at}
                          label={value().label}
                          detail={timeDetail(value().at)}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              )}
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}

function Timestamp(props: {
  at: number
  label: string
  detail: string
  slot: "user-message-time" | "text-part-completed-at"
}) {
  return (
    <Tooltip value={props.detail} appearance="standard" placement="top">
      <time
        data-slot={props.slot}
        dateTime={new Date(props.at).toISOString()}
        dir="auto"
        tabIndex={0}
        aria-label={props.detail}
      >
        {props.label}
      </time>
    </Tooltip>
  )
}

function CopyButton(props: {
  text?: string
  label: string
  copiedLabel: string
  size?: "small" | "normal"
}) {
  const ctx = usePlugin()

  const system = ctx.system

  return (
    <Show when={props.text} keyed>
      {(text) => {
        const copy = createCopyFeedback({
          write: system.copy,
          onError: () => showToast({ title: ctx.t("common.requestFailed") }),
        })

        const label = () => (copy.copied() ? props.copiedLabel : props.label)

        return (
          <Tooltip
            appearance="compact"
            value={label()}
            placement="top"
            gutter={4}
            forceOpen={copy.copied() || undefined}
          >
            <IconButton
              size={props.size ?? "normal"}
              variant="ghost-muted"
              icon={<Icon name={copy.copied() ? "check" : "copy"} />}
              aria-label={label()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => copy.copy(text)}
            />
          </Tooltip>
        )
      }}
    </Show>
  )
}
