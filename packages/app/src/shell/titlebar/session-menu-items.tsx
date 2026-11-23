import { Menu } from "@opencode/ui/menu"
import { useDialog } from "@opencode/ui/context/dialog"
import { useLanguage } from "@/runtime/i18n/language"
import { createSessionExporter } from "@/session/commands/export-session"
import { SessionReadMenuItem } from "@/session/session-read-menu-item"
import { sessionLabel } from "@/session/title"
import { DeleteDialog } from "./inbox"
import { inboxArchived, inboxBusy, type InboxEntry, type SessionInbox } from "./inbox-model"
import { RenameDialog } from "./project-session-row"

/**
 * The session row menu shared by the Inbox and Cozy sidebars. Pin actions are optional so the Inbox keeps its
 * existing rows unchanged while Cozy adds pinning.
 */
export function SessionMenuItems(props: {
  inbox: SessionInbox
  entry: InboxEntry
  pinned?: boolean
  onPin?: () => void
  onUnpin?: () => void
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const exporter = createSessionExporter()

  return (
    <>
      {props.onPin || props.onUnpin ? (
        <Menu.Item
          onSelect={() => {
            if (props.pinned) props.onUnpin?.()
            else props.onPin?.()
          }}
        >
          {language.t(props.pinned ? "sidebar.recent.unpin" : "sidebar.recent.pin")}
        </Menu.Item>
      ) : null}
      <Menu.Item
        onSelect={() => {
          const current = props.entry

          void dialog.show(() => (
            <RenameDialog
              title={sessionLabel(current.session)}
              onRename={(title) => props.inbox.rename(current, title)}
            />
          ))
        }}
      >
        {language.t("common.rename")}
      </Menu.Item>
      <Menu.Item
        disabled={exporter.exporting({ server: props.entry.server, sessionID: props.entry.session.id })}
        onSelect={() => exporter.export({ server: props.entry.server, sessionID: props.entry.session.id })}
      >
        {language.t("common.export")}…
      </Menu.Item>
      <SessionReadMenuItem server={props.entry.server} session={props.entry.session} />
      <Menu.Separator />
      {inboxArchived(props.entry) ? (
        <Menu.Item onSelect={() => void props.inbox.unarchive(props.entry)}>
          {language.t("sidebar.inbox.unarchive")}
        </Menu.Item>
      ) : (
        <Menu.Item onSelect={() => void props.inbox.archive(props.entry)}>{language.t("common.archive")}</Menu.Item>
      )}
      {inboxBusy(props.entry.status) ? null : (
        <>
          <Menu.Separator />
          <Menu.Item
            onSelect={() => {
              const current = props.entry

              void dialog.show(() => (
                <DeleteDialog title={current.session.title} onConfirm={() => void props.inbox.remove(current)} />
              ))
            }}
          >
            {language.t("common.delete")}…
          </Menu.Item>
        </>
      )}
    </>
  )
}
