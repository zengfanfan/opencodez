import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { setupLocalLinks } from "./markdown-local-links"

beforeAll(() => GlobalRegistrator.register())

afterAll(() => GlobalRegistrator.unregister())

afterEach(() => window.getSelection()?.removeAllRanges())

function root(markup: string) {
  const element = document.createElement("div")
  element.innerHTML = markup

  return element
}

function selectContents(element: Element) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

test("right-clicking a link or an inline path opens the menu without opening the file", () => {
  const element = root('<p><a data-local-link="src/app.ts">app</a> and <code data-inline-code-kind="path">src/b.ts</code></p>')
  const opened: string[] = []
  const menus: { path: string; x: number; y: number }[] = []

  const dispose = setupLocalLinks(
    element,
    () => (path) => opened.push(path),
    () => (input) => menus.push(input),
  )

  const link = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 34 })
  element.querySelector("a")!.dispatchEvent(link)
  const code = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 })
  element.querySelector("code")!.dispatchEvent(code)

  expect(menus).toEqual([
    { path: "src/app.ts", x: 12, y: 34 },
    { path: "src/b.ts", x: 5, y: 6 },
  ])
  expect([link.defaultPrevented, code.defaultPrevented]).toEqual([true, true])
  expect(opened).toEqual([])
  dispose()
})

test("ordinary text keeps the native menu", () => {
  const element = root("<p>plain text</p>")
  const menus: unknown[] = []
  const dispose = setupLocalLinks(element, () => undefined, () => (input) => menus.push(input))
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })

  element.querySelector("p")!.dispatchEvent(event)

  expect(menus).toEqual([])
  expect(event.defaultPrevented).toBe(false)
  dispose()
})

test("a handled event is left alone", () => {
  const element = root('<p><a data-local-link="src/app.ts">app</a></p>')
  const menus: unknown[] = []
  const dispose = setupLocalLinks(element, () => undefined, () => (input) => menus.push(input))
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })

  event.preventDefault()
  element.querySelector("a")!.dispatchEvent(event)

  expect(menus).toEqual([])
  dispose()
})

test("the keyboard menu key opens the menu next to the focused link", () => {
  const element = root('<p><a data-local-link="src/app.ts">app</a></p>')
  const link = element.querySelector("a")!
  const menus: { path: string; x: number; y: number }[] = []
  const bounds = { left: 40, bottom: 60, right: 80, top: 40, width: 40, height: 20, x: 40, y: 40, toJSON: () => ({}) }
  link.getBoundingClientRect = () => bounds
  const dispose = setupLocalLinks(element, () => undefined, () => (input) => menus.push(input))
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "ContextMenu" })

  link.dispatchEvent(event)

  expect(menus).toEqual([{ path: "src/app.ts", x: 40, y: 60 }])
  expect(event.defaultPrevented).toBe(true)
  dispose()
})

test("left-clicking still opens the file, and dispose removes the listeners", () => {
  const element = root('<p><a data-local-link="src/app.ts">app</a></p>')
  const opened: string[] = []
  const dispose = setupLocalLinks(element, () => (path) => opened.push(path))

  element.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  dispose()
  element.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))

  expect(opened).toEqual(["src/app.ts"])
})

test("a selection over a local link keeps the click and the native context menu", () => {
  const element = root(
    '<p><a data-local-link="src/app.ts">app</a> and <code data-inline-code-kind="path">src/b.ts</code></p>',
  )

  const opened: string[] = []
  const menus: unknown[] = []

  const dispose = setupLocalLinks(
    element,
    () => (path) => opened.push(path),
    () => (input) => menus.push(input),
  )

  const link = element.querySelector("a")!
  selectContents(link)

  const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
  link.dispatchEvent(click)
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  link.dispatchEvent(menu)

  expect(opened).toEqual([])
  expect(menus).toEqual([])
  expect([click.defaultPrevented, menu.defaultPrevented]).toEqual([false, false])

  window.getSelection()?.removeAllRanges()
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
  expect(opened).toEqual(["src/app.ts"])
  dispose()
})

test("a selection over an inline path keeps the context menu native", () => {
  const element = root('<p><code data-inline-code-kind="path">src/b.ts</code></p>')
  const opened: string[] = []
  const menus: unknown[] = []

  const dispose = setupLocalLinks(
    element,
    () => (path) => opened.push(path),
    () => (input) => menus.push(input),
  )

  const code = element.querySelector("code")!
  selectContents(code)

  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true })
  code.dispatchEvent(menu)

  expect(opened).toEqual([])
  expect(menus).toEqual([])
  expect(menu.defaultPrevented).toBe(false)
  dispose()
})
