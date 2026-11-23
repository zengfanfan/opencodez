import { describe, expect, test } from "bun:test"
import type { FileAttachmentPart, ImageAttachmentPart, Prompt, TextPart } from "@/composer/state"
import { trimPrompt } from "./prompt-parts"

const text = (content: string, start = 0): TextPart => ({
  type: "text",
  content,
  start,
  end: start + content.length,
})

const textOf = (prompt: Prompt) => prompt.map((part) => ("content" in part ? part.content : "")).join("")

const file: FileAttachmentPart = { type: "file", path: "a.ts", content: "@a.ts", start: 2, end: 7 }

const image: ImageAttachmentPart = {
  type: "image",
  id: "image",
  filename: "a.png",
  mime: "image/png",
  blob: { id: "image", url: "" },
}

describe("trimPrompt", () => {
  test.each([
    { name: "leading and trailing blank lines", input: "\n\n  hello\n\n", expected: "  hello" },
    { name: "blank lines made of spaces and tabs", input: "\n \t\nhello\n \n", expected: "hello" },
    { name: "internal blank lines", input: "a\n\nb\n", expected: "a\n\nb" },
    { name: "CRLF blank lines", input: "\r\n\r\nhello  \r\n\r\n", expected: "hello  " },
    { name: "a single line of spaces", input: "   ", expected: "" },
    { name: "first-line indentation", input: "  hello", expected: "  hello" },
    { name: "trailing spaces on the content line", input: "hello  ", expected: "hello  " },
    { name: "a final newline", input: "hello\n", expected: "hello" },
    { name: "a lone CR", input: "\r", expected: "\r" },
    { name: "a lone CR after a newline", input: "a\n\r", expected: "a\n\r" },
    { name: "a lone CR before a CRLF", input: "a\n \r\r\n", expected: "a\n \r" },
  ])("drops $name", ({ input, expected }) => {
    expect(textOf(trimPrompt([text(input)]))).toBe(expected)
  })

  test("keeps text part offsets continuous", () => {
    expect(trimPrompt([text("a\n"), text("\n   ", 2)])).toEqual([text("a")])
    expect(trimPrompt([text("\n\n"), text("a", 2), text("b", 3)])).toEqual([text("a"), text("b", 1)])
    expect(trimPrompt([text("\n"), text("   ", 1)])).toEqual([text("")])
  })

  test("keeps attachments when only blank lines are sent", () => {
    expect(trimPrompt([text("\n\n"), image, text("   ", 2)])).toEqual([image])
  })

  test("shifts mentions with the text", () => {
    expect(trimPrompt([text("\n\n"), file, text("\n\n", 7)])).toEqual([{ ...file, start: 0, end: 5 }])
  })

  test("stays linear on long runs of blank lines", () => {
    const input = "\n".repeat(100_000) + "x" + "\n".repeat(100_000)

    expect(trimPrompt([text(input)])).toEqual([text("x")])
  })
})
