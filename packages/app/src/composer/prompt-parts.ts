import type { ContentPart, ImageAttachmentPart, PathAttachmentPart, Prompt } from "./state"
import { parseSessionMention, serializeSessionMention } from "@opencode/util/session-mention"

const BLANK_HEAD = /^(?:[ \t]*\r?\n)+/

// Where the trailing blank lines start. Scanned from the end so a pasted run of blank lines stays linear.
function contentEnd(text: string) {
  let end = text.length

  while (end > 0) {
    const newline = text.lastIndexOf("\n", end - 1)
    const line = text.slice(newline + 1, end)

    if (/[^ \t]/.test(line)) return end

    if (newline < 0) return 0
    end = newline - (text[newline - 1] === "\r" ? 1 : 0)
  }

  return 0
}

/** Drops blank lines at either end of a draft, shifting each part's offsets with the text it keeps. */
export function trimPrompt(prompt: Prompt): Prompt {
  const text = prompt.map((part) => ("content" in part ? part.content : "")).join("")
  const head = text.match(BLANK_HEAD)?.[0].length ?? 0
  const end = contentEnd(text)

  if (!head && end === text.length) return prompt

  let offset = 0

  const trimmed = prompt.flatMap((part): Prompt => {
    if (!("content" in part)) return [part]

    const from = Math.max(offset, head)
    const to = Math.min(offset + part.content.length, end)
    const content = to > from ? part.content.slice(from - offset, to - offset) : ""
    offset += part.content.length

    if (!content && part.type === "text") return []

    return [{ ...part, content, start: from - head, end: from - head + content.length }]
  })

  return trimmed.length ? trimmed : [{ type: "text", content: "", start: 0, end: 0 }]
}

export function serializePrompt(prompt: Prompt): Prompt {
  // Editor offsets measure titles; wire offsets measure stable session tokens.
  let offset = 0

  return prompt.map((part) => {
    if (!("content" in part)) return part
    const mention = part.type === "session" ? parseSessionMention(part.id) : undefined
    const content = mention ? serializeSessionMention(mention) : part.content

    const next = {
      ...part,
      content,
      start: part.start + offset,
      end: part.end + offset + content.length - part.content.length,
    }

    offset += content.length - part.content.length

    return next
  })
}

/** Parts that sit beside the text rather than inside it. */
export function isAttachment(part: ContentPart): part is ImageAttachmentPart | PathAttachmentPart {
  return part.type === "image" || part.type === "path"
}

export function clonePrompt(prompt: Prompt): Prompt {
  return prompt.map((part) =>
    part.type === "file" ? { ...part, selection: part.selection ? { ...part.selection } : undefined } : { ...part },
  )
}

export function promptLength(prompt: Prompt) {
  return prompt.reduce((length, part) => length + ("content" in part ? part.content.length : 0), 0)
}

export function appendPrompt(prompt: Prompt, following: Prompt): Prompt {
  const start = promptLength(prompt)
  const offset = start + 2

  return [
    ...clonePrompt(prompt),
    { type: "text", content: "\n\n", start, end: offset },
    ...clonePrompt(following).map((part) =>
      isAttachment(part) ? part : { ...part, start: part.start + offset, end: part.end + offset },
    ),
  ]
}
