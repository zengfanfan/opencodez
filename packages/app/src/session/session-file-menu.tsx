import { For, Show } from "solid-js"
import { Portal } from "solid-js/web"
import { Menu } from "@opencode/ui/menu"
import { writeClipboard } from "@opencode/session-ui/copy"
import { fileManagerApp } from "@/home/projects/file-manager"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useServerSDK } from "@/runtime/server/client"
import { useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import {
  displayedLocalPath,
  joinLocalPath,
  localFileActions,
  resolvableLocalPath,
  selectLocalFile,
  type LocalFileAction,
  type LocalFileResolution,
} from "./local-file"

export type SessionFileMenuTarget = { path: string; directory: string; x: number; y: number }

export function SessionFileMenu(props: { target: SessionFileMenuTarget | undefined; onClose: () => void }) {
  const language = useLanguage()
  const platform = usePlatform()
  const server = useServer()
  const serverSDK = useServerSDK()

  const path = () => (props.target ? displayedLocalPath(props.target.path) : "")

  const actions = () =>
    localFileActions({
      desktop: platform.platform === "desktop",
      local: server.isLocal,
      path: path(),
    })

  const failure = (cause: unknown, text: string) =>
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: cause instanceof Error ? cause.message : text,
    })

  const multiple = (text: string) =>
    showToast({ variant: "error", title: language.t("session.file.multiple"), description: text })

  // The left-click picker decides this for a click; a menu action resolves it only when the user picks one.
  const resolve = async (target: SessionFileMenuTarget): Promise<LocalFileResolution> => {
    const value = resolvableLocalPath(displayedLocalPath(target.path))

    // The menu offers only Copy Path for this case; this guard keeps the other actions unreachable.
    if (!value) return { kind: "missing" }

    if (value.absolute) return { kind: "file", path: joinLocalPath(target.directory, value.path) }

    const found = await serverSDK.api.file
      .find({ location: { directory: target.directory }, query: value.path, type: "file", limit: 200 })
      .catch(() => undefined)

    if (!found) return { kind: "file", path: joinLocalPath(target.directory, value.path) }

    const selection = selectLocalFile(
      found.location.directory,
      value.path,
      found.data.map((entry) => entry.path),
    )

    // Files the search index skips, such as ignored ones, still open by their literal path.
    return selection.kind === "missing"
      ? { kind: "file", path: joinLocalPath(target.directory, value.path) }
      : selection
  }

  const copy = async (text: string) => {
    if (!text) return

    const written = platform.writeClipboardText
      ? await platform.writeClipboardText(text).then(() => true)
      : await writeClipboard(text)

    if (!written) return failure(undefined, text)
    showToast({ variant: "success", icon: "circle-check", title: language.t("common.copied"), description: text })
  }

  const fileAction = async (action: LocalFileAction, target: SessionFileMenuTarget) => {
    const text = displayedLocalPath(target.path)
    const resolved = await resolve(target)

    if (resolved.kind === "multiple") return multiple(text)

    if (resolved.kind !== "file") return failure(undefined, text)

    if (action === "open") {
      if (!platform.openPath) return
      await platform.openPath(resolved.path).catch((cause) => failure(cause, text))

      return
    }

    if (action === "saveAs") {
      if (!platform.saveFileAs) return

      const result = await platform.saveFileAs(resolved.path).catch((cause) => {
        failure(cause, text)

        return undefined
      })

      if (result === "sameFile") {
        showToast({ variant: "error", title: language.t("session.file.sameFile"), description: text })
      } else if (result === "unverified") {
        showToast({ variant: "error", title: language.t("session.file.unverified"), description: text })
      }

      return
    }

    if (!platform.revealPath) return

    const revealed = await platform.revealPath(resolved.path).catch((cause) => {
      failure(cause, text)

      return false
    })

    if (!revealed) failure(undefined, text)
  }

  const label = (action: LocalFileAction) => {
    if (action === "open") return language.t("session.file.open")

    if (action === "saveAs") return language.t("session.file.saveAs")

    if (action === "copy") return language.t("session.location.copyPath")

    const os = platform.platform === "desktop" ? (platform.os ?? "unknown") : "unknown"

    return language.t(fileManagerApp(os).actionLabel)
  }

  return (
    <Menu
      modal={false}
      placement="bottom-start"
      gutter={2}
      open={!!props.target}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      {/* Portaled so a transformed ancestor never offsets the fixed trigger. */}
      <Portal>
        <Menu.Trigger
          as="span"
          aria-hidden="true"
          disabled
          class="pointer-events-none fixed size-px"
          style={{ left: `${props.target?.x ?? 0}px`, top: `${props.target?.y ?? 0}px` }}
        />
      </Portal>
      <Menu.Portal>
        <Menu.Content onCloseAutoFocus={(event) => event.preventDefault()}>
          <Show when={props.target}>
            {(target) => (
              <For each={actions()}>
                {(action) => (
                  <Menu.Item
                    onSelect={() => {
                      const chosen = target()
                      const text = displayedLocalPath(chosen.path)
                      props.onClose()

                      if (action === "copy") void copy(text)
                      else void fileAction(action, chosen)
                    }}
                  >
                    {label(action)}
                  </Menu.Item>
                )}
              </For>
            )}
          </Show>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  )
}
