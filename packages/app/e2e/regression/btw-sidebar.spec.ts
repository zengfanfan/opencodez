import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { openSession } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

test.use({ viewport: { width: 1440, height: 900 } })

test("keeps separate one-shot /btw answers and restores them after reload", async ({ page }, testInfo) => {
  const prompts: unknown[] = []
  const generations: { sessionID: string; prompt: string }[] = []

  const { editor } = await openSession(page, {
    name: "BtwQuestions",
    onPrompt: (input) => prompts.push(input),
    generate: (input) => {
      generations.push(input)

      return {
        text: input.prompt.includes("second question")
          ? "Second answer"
          : `First answer\n\n${"A detailed explanation of the first question.\n\n".repeat(100)}End of first answer`,
      }
    },
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await editor.fill("/btw first question")
  await editor.press("Enter")
  await expect(panel.getByText("First answer", { exact: true })).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(1)
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toHaveCount(1)
  await panel.getByText("End of first answer", { exact: true }).scrollIntoViewIfNeeded()
  await expect(panel.getByText("End of first answer", { exact: true })).toBeInViewport()
  await editor.fill("/btw second question")
  await editor.press("Enter")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  const first = page.getByRole("tab", { name: "first question", exact: true })
  const second = page.getByRole("tab", { name: "second question", exact: true })
  await expect(first).toBeVisible()
  await expect(second).toHaveAttribute("data-selected", "")
  await page.screenshot({ path: testInfo.outputPath("separate-tabs.png") })
  expect(generations).toHaveLength(2)
  expect(generations[1]?.prompt).not.toContain("first question")
  expect(generations[1]?.prompt).not.toContain("First answer")

  await page.reload()
  await expect(first).toBeVisible()
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  await first.click()
  await expect(panel.getByText("First answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("Second answer", { exact: true })).toHaveCount(0)
  await expect(panel.getByRole("textbox")).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("restored-answer.png") })

  // Closing a tab forgets its question; the other tab and its answer survive a reload.
  await first.click({ button: "middle" })
  await expect(first).toHaveCount(0)
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  await page.reload()
  await expect(second).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Second answer", { exact: true })).toBeVisible()
  await expect(first).toHaveCount(0)
  expect(generations).toHaveLength(2)
  expect(prompts).toEqual([])
})

test("keeps follow-ups in one /btw thread without touching the session", async ({ page }) => {
  const prompts: unknown[] = []
  const generations: { sessionID: string; prompt: string }[] = []

  const { editor } = await openSession(page, {
    name: "BtwThread",
    onPrompt: (input) => prompts.push(input),
    generate: (input) => {
      generations.push(input)

      return { text: input.prompt.includes("follow-up") ? "Follow-up answer" : "Thread answer" }
    },
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  const composer = panel.getByRole("textbox")
  const send = panel.getByRole("button", { name: "Send", exact: true })

  await editor.fill("/btw first side question")
  await editor.press("Enter")
  await expect(panel.getByText("Thread answer", { exact: true })).toBeVisible()
  await expect(composer).toBeEditable()
  await expect(send).toBeDisabled()

  await composer.fill("follow-up question")
  await expect(send).toBeEnabled()
  await composer.press("Enter")
  await expect(panel.getByText("Follow-up answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("first side question", { exact: true })).toBeVisible()
  await expect(composer).toHaveValue("")
  await expect(page.getByRole("tab", { name: "first side question", exact: true })).toHaveCount(1)

  expect(generations).toHaveLength(2)
  expect(generations[1]?.prompt).toContain("first side question")
  expect(generations[1]?.prompt).toContain("Thread answer")
  expect(generations[1]?.prompt).toContain("follow-up question")
  expect(prompts).toEqual([])

  await page.reload()
  await expect(panel.getByText("first side question", { exact: true })).toBeVisible()
  await expect(panel.getByText("follow-up question", { exact: true })).toBeVisible()
  await expect(panel.getByText("Thread answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("Follow-up answer", { exact: true })).toBeVisible()
  await expect(composer).toBeEditable()
})

test("isolates concurrent side questions and makes interrupted and blank answers retryable", async ({ page }) => {
  const held = Promise.withResolvers<void>()
  const attempts: string[] = []
  const prompts: unknown[] = []

  const { editor } = await openSession(page, {
    name: "BtwConcurrent",
    onPrompt: (input) => prompts.push(input),
    generate: async (input) => {
      attempts.push(input.prompt)

      if (input.prompt.includes("slow question") && attempts.length === 1) {
        await held.promise

        return { text: "Abandoned answer" }
      }

      // A reply with only a tool call or reasoning reaches the panel as blank text.
      if (input.prompt.includes("blank question")) {
        return {
          text:
            attempts.filter((item) => item.includes("blank question")).length === 1 ? "   \n  " : "Recovered answer",
        }
      }

      return { text: input.prompt.includes("fast question") ? "Fast answer" : "Retried answer" }
    },
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  await editor.fill("/btw slow question")
  await editor.press("Enter")
  await expect(panel.getByRole("status")).toContainText("Working")
  await editor.fill("/btw fast question")
  await editor.press("Enter")
  await expect(panel.getByText("Fast answer", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "slow question", exact: true }).click()
  await expect(panel.getByRole("status")).toContainText("Working")
  await expect(panel.getByText("Fast answer", { exact: true })).toHaveCount(0)

  await page.reload()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toBeVisible()
  await expect(panel.getByRole("status")).toHaveCount(0)
  expect(attempts).toHaveLength(2)
  await panel.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(panel.getByText("Retried answer", { exact: true })).toBeVisible()
  expect(attempts).toHaveLength(3)
  expect(attempts[2]).toContain("slow question")
  expect(attempts[2]).not.toContain("fast question")
  held.resolve()
  await page.getByRole("tab", { name: "fast question", exact: true }).click()
  await expect(panel.getByText("Fast answer", { exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "slow question", exact: true }).click()
  await expect(panel.getByText("Retried answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("Abandoned answer", { exact: true })).toHaveCount(0)
  await expect(panel.getByRole("textbox")).toHaveCount(1)

  await editor.fill("/btw blank question")
  await editor.press("Enter")
  await expect(page.getByRole("tab", { name: "blank question", exact: true })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toBeVisible()
  await expect(panel.getByText("The model replied without any text.", { exact: true })).toBeVisible()
  await expect(panel.getByRole("status")).toHaveCount(0)
  await panel.getByRole("button", { name: "Retry", exact: true }).click()
  await expect(panel.getByText("Recovered answer", { exact: true })).toBeVisible()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toHaveCount(0)
  expect(attempts.filter((item) => item.includes("blank question"))).toHaveLength(2)
  expect(prompts).toEqual([])
})

test("keeps many long-titled side tabs usable at a narrow desktop width", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 700 })

  const { editor } = await openSession(page, {
    name: "BtwOverflow",
    generate: () => ({ text: "Saved overflow answer" }),
  })

  const panel = page.locator('[data-slot="session-btw-panel"]')
  const questions = Array.from({ length: 12 }, (_, index) => `Side ${index + 1}: ${"long-title-".repeat(30)}`)

  for (const question of questions) {
    await editor.fill(`/btw ${question}`)
    await editor.press("Enter")
    await expect(page.getByRole("tab", { name: question, exact: true })).toHaveAttribute("data-selected", "")
    await expect(panel.getByText("Saved overflow answer", { exact: true })).toBeVisible()
  }

  await expect(page.getByRole("tab", { name: /^Side \d+:/ })).toHaveCount(12)
  await expect(panel.getByRole("textbox")).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole("tab", { name: /^Side \d+:/ })).toHaveCount(12)
  await expect(panel.getByText("Saved overflow answer", { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("narrow-many-tabs.png") })
})

test("answers /btw in the side panel without admitting a prompt", async ({ page }) => {
  await page.clock.install()
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  const generations: { sessionID: string; prompt: string }[] = []
  const prompts: unknown[] = []
  const generated = Promise.withResolvers<void>()
  const leftBehind = Promise.withResolvers<void>()
  const main = { id: "ses_btw_sidebar", title: "Side question session" }
  const other = { id: "ses_btw_sidebar_other", title: "Other side question session" }
  const ownerWarnings: string[] = []
  page.on("console", (message) => {
    if (message.text().includes("computations created outside a `createRoot` or `render`"))
      ownerWarnings.push(message.text())
  })

  const { editor } = await openSession(page, {
    name: "BtwSidebar",
    sessions: [main, other],
    onPrompt: (input) => prompts.push(input),
    generate: async (input) => {
      generations.push(input)

      if (input.sessionID === other.id) return { text: "This answer belongs to the **other session**." }

      if (input.prompt.includes("left behind")) {
        await leftBehind.promise

        return { text: "This answer arrived after the user left." }
      }

      await generated.promise

      return {
        text: "The retry loop uses **exponential backoff** and stops after three attempts.\n\n```ts\nconst delay = 2 ** attempt\n```",
      }
    },
  })

  await editor.fill("/btw")
  const suggestion = page.locator('[data-suggestion-id="btw.ask"]')
  await expect(suggestion).toBeVisible()
  await suggestion.click()
  await expect(editor).toHaveText("/btw ")
  await editor.press("Enter")
  const panel = page.locator('[data-slot="session-btw-panel"]')
  await expect(panel).toBeHidden()
  await expect(page.getByText("Add a question after /btw", { exact: true })).toBeVisible()
  expect(generations).toEqual([])
  expect(prompts).toEqual([])

  await editor.fill("/btw how does the retry loop work?")
  await editor.press("Enter")
  await expect(panel).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveCount(1)
  await expect(panel.getByRole("textbox")).toBeEditable()
  await expect(panel.getByRole("button", { name: "Send", exact: true })).toBeDisabled()
  await expect(panel.getByRole("status")).toContainText("Working")
  await expect(page.getByRole("tab", { name: "how does the retry loop work?", exact: true })).toHaveAttribute(
    "data-selected",
    "",
  )
  generated.resolve()
  await expect(panel.getByText("how does the retry loop work?", { exact: true })).toBeVisible()
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await expect(panel.getByText("const delay = 2 ** attempt", { exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "Copy message", exact: true })).toHaveCount(1)
  await expect(panel.getByRole("button", { name: "Revert to here", exact: true })).toHaveCount(0)
  await expect(panel.getByRole("button", { name: "Copy response", exact: true })).toHaveCount(1)
  await expect(panel.locator('[data-slot="text-part-agent"] .sr-only')).toContainText(/\d+s/)
  const answerTime = panel.locator('[data-slot="text-part-completed-at"]')
  await expect(answerTime).toBeVisible()
  const btwUser = panel.locator('[data-component="user-message"]')
  const userTime = btwUser.locator('[data-slot="user-message-time"]')
  await btwUser.hover()
  await userTime.hover()
  await expect(page.getByRole("tooltip").filter({ hasText: /\d{4}/ })).toBeVisible()
  await answerTime.hover()
  await expect(page.getByRole("tooltip").filter({ hasText: /\d{4}/ })).toBeVisible()
  await panel.getByRole("button", { name: "Copy response", exact: true }).hover()
  await expect(page.getByRole("tooltip", { name: "Copy response", exact: true })).toBeVisible()
  const feedback = page.getByRole("tooltip", { name: "Copied", exact: true })
  const btwCopy = btwUser.locator('[data-slot="user-message-footer"]')
  await page.mouse.move(0, 0)
  await expect(btwCopy).toHaveCSS("opacity", "0")
  await expect(btwCopy).toHaveCSS("pointer-events", "none")

  for (const [component, label] of [
    ["user-message", "Copy message"],
    ["text-part", "Copy response"],
  ]) {
    const row = panel.locator(`[data-component="${component}"]`)

    const button = row.getByRole("button", { name: label, exact: true })

    await row.hover()
    await button.click()
    await expect(feedback).toBeVisible()
    await page.clock.fastForward(1_000)
    await expect(feedback).toHaveCSS("opacity", "1")
    await expect(row.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
    await page.clock.fastForward(1_000)
    await expect(button).toBeVisible()
    await expect(page.getByRole("tooltip")).toBeHidden()
  }

  expect(generations).toHaveLength(1)
  expect(generations[0]?.sessionID).toBe(main.id)
  expect(generations[0]?.prompt).toContain("how does the retry loop work?")
  expect(prompts).toEqual([])
  await expect(editor).toHaveText("")

  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(other.id)}"]`).click()
  await expectSessionTitle(page, other.title)
  await editor.fill("/btw what belongs here?")
  await editor.press("Enter")
  await expect(panel.getByText("other session", { exact: false })).toBeVisible()
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await expect(panel.getByText("other session", { exact: false })).toHaveCount(0)

  await editor.fill("/btw is this question left behind?")
  await editor.press("Enter")
  await expect(panel.getByRole("status")).toContainText("Working")
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(other.id)}"]`).click()
  await expectSessionTitle(page, other.title)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  // Leaving the session does not abandon its question: it is still working, and its answer lands once it arrives.
  await expect(panel.getByRole("status")).toContainText("Working")
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  leftBehind.resolve()
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  await expect(panel.getByText("This answer arrived after the user left.", { exact: true })).toBeVisible()
  await expect(panel.getByText("Couldn’t answer that question", { exact: true })).toHaveCount(0)
  expect(generations.filter((item) => item.prompt.includes("left behind"))).toHaveLength(1)

  await page.reload()
  await expectSessionTitle(page, main.title)
  await expect(page.getByRole("tab", { name: "is this question left behind?", exact: true })).toHaveAttribute(
    "data-selected",
    "",
  )
  await expect(panel.getByText("This answer arrived after the user left.", { exact: true })).toBeVisible()
  await expect(panel.getByRole("status")).toHaveCount(0)
  await page.getByRole("tab", { name: "how does the retry loop work?", exact: true }).click()
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Home", exact: true }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.locator(`[data-titlebar-tab-link][href="${sessionHref(main.id)}"]`).click()
  await expectSessionTitle(page, main.title)
  await expect(page.getByRole("tab", { name: "how does the retry loop work?", exact: true })).toHaveAttribute(
    "data-selected",
    "",
  )
  await expect(panel.getByText("exponential backoff", { exact: false })).toBeVisible()
  expect(ownerWarnings).toEqual([])
})

test("opens a side chat from the composer and from the new tab view", async ({ page }) => {
  const { editor } = await openSession(page, {
    name: "BtwOpen",
    generate: (input) => ({
      text: input.prompt.includes("from the composer") ? "Composer answer" : "New tab answer",
    }),
  })

  const openSide = page.getByRole("button", { name: "Open side chat", exact: true })
  const submit = page.locator('[data-action="composer-submit"]')
  const openBox = await openSide.boundingBox()
  const submitBox = await submit.boundingBox()

  if (!openBox || !submitBox) throw new Error("composer buttons are not laid out")
  expect(openBox.height).toBeLessThan(submitBox.height)

  await openSide.click()
  const panel = page.locator('[data-slot="session-btw-panel"]')
  const composer = panel.getByRole("textbox")
  await expect(panel).toBeVisible()
  await expect(composer).toBeEditable()
  // Opening a side chat moves the keyboard into it.
  await expect(composer).toBeFocused()

  await editor.fill("main line one")
  await editor.press("Shift+Enter")
  await editor.pressSequentially("main line two")
  await composer.fill("side line one")
  await composer.press("Shift+Enter")
  await composer.pressSequentially("side line two")

  // Both composers rest two lines tall, so a second line does not grow either box, and the boxes line up at the
  // bottom like the main composer.
  const mainBox = await page.locator('[data-component="composer"]').boundingBox()
  const sideBox = await composer.locator("xpath=..").boundingBox()
  const mainInput = await page.locator('[data-component="composer-editor"]').boundingBox()
  const sideInput = await composer.boundingBox()

  if (!mainBox || !sideBox || !mainInput || !sideInput) throw new Error("composers are not laid out")

  expect(mainInput.height).toBe(48)
  expect(sideInput.height).toBe(48)
  expect(sideBox.height).toBe(mainBox.height)
  expect(Math.round(sideBox.y + sideBox.height)).toBe(Math.round(mainBox.y + mainBox.height))

  // Scrolled text fades at both edges like the main composer, and the bottom fade closes at the end of the draft.
  const fade = () =>
    composer.evaluate((element) => getComputedStyle(element).getPropertyValue("--btw-composer-fade").trim())

  await composer.fill(Array.from({ length: 20 }, (_, index) => `side line ${index}`).join("\n"))
  await composer.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect.poll(fade).toBe("16px")
  expect(await composer.evaluate((element) => getComputedStyle(element).maskImage)).toContain("linear-gradient")
  await composer.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(fade).toBe("0px")

  // The thread scrolls under the composer with the same bottom fade as the main timeline.
  const thread = panel.locator('[data-slot="session-btw-scroll"]')
  expect(await thread.evaluate((element) => getComputedStyle(element).maskImage)).toContain("linear-gradient")

  await composer.fill("from the composer")
  await composer.press("Enter")
  await expect(panel.getByText("Composer answer", { exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "from the composer", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "Add tab", exact: true }).click()
  await page.getByRole("button", { name: "Side chat", exact: true }).click()
  await expect(composer).toBeEditable()
  await expect(composer).toBeFocused()

  await composer.fill("from the new tab")
  await composer.press("Enter")
  await expect(panel.getByText("New tab answer", { exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "from the new tab", exact: true })).toBeVisible()
})

test("localizes the /btw footer controls", async ({ page }) => {
  const { editor } = await openSession(page, {
    name: "BtwLocale",
    sessions: [{ id: "ses_btw_locale", title: "Locale side question" }],
    seed: { locale: "zh" },
    generate: async () => ({ text: "这是侧栏回答。" }),
  })

  await editor.fill("/btw 这是一个问题")
  await editor.press("Enter")
  const panel = page.locator('[data-slot="session-btw-panel"]')
  await expect(panel.getByText("这是侧栏回答。", { exact: true })).toBeVisible()
  await expect(panel.getByRole("textbox")).toHaveAttribute("placeholder", "继续追问")
  await expect(panel.getByRole("button", { name: "发送", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "打开侧边聊天", exact: true })).toBeVisible()
  await expect(panel.getByRole("button", { name: "复制消息", exact: true })).toHaveCount(1)
  await expect(panel.getByRole("button", { name: "复制回复", exact: true })).toHaveCount(1)

  const user = panel.locator('[data-component="user-message"]')
  await user.hover()
  await panel.locator('[data-slot="user-message-time"]').hover()
  await expect(page.getByRole("tooltip").filter({ hasText: /\d{4}/ })).toBeVisible()

  const answerTime = panel.locator('[data-slot="text-part-completed-at"]')
  await answerTime.hover()
  await expect(page.getByRole("tooltip").filter({ hasText: /\d{4}/ })).toBeVisible()
  await panel.getByRole("button", { name: "复制回复", exact: true }).hover()
  await expect(page.getByRole("tooltip", { name: "复制回复", exact: true })).toBeVisible()

  const openSide = page.getByRole("button", { name: "打开侧边聊天", exact: true })
  await openSide.hover()
  await expect(page.getByRole("tooltip", { name: "打开侧边聊天", exact: true })).toBeVisible()

  const send = panel.getByRole("button", { name: "发送", exact: true })
  await panel.getByRole("textbox").fill("继续问")
  await send.hover()
  await expect(page.getByRole("tooltip", { name: "发送", exact: true })).toBeVisible()

  await page.getByRole("button", { name: "添加标签页", exact: true }).click()
  await page.getByRole("button", { name: "侧边聊天", exact: true }).click()
  await expect(panel.getByRole("textbox")).toHaveAttribute("placeholder", "继续追问")
})
