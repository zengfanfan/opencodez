import { expect, story } from "../../stories/playwright/story"

story.describe("touch timeline", () => {
  story.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  story("keeps message actions and metadata visible without hover", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--response-speed")
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)

    for (const action of [
      { slot: "user-message-menu", name: "More actions" },
      { slot: "text-part-copy-wrapper", name: "Copy response" },
    ]) {
      const actions = timeline.locator(`[data-slot="${action.slot}"]`)
      await expect(actions).toHaveCount(1)
      await expect(actions).toHaveCSS("opacity", "1")
      await expect(actions).toHaveCSS("pointer-events", "auto")
      await expect(actions.getByRole("button", { name: action.name, exact: true })).toBeVisible()
    }

    // The user message meta still omits agent and model on mobile; the reply details are tooltips.
    await expect(timeline.locator('[data-slot="user-message-meta-item"]')).toHaveCount(0)
    await expect(timeline.locator('[data-slot="user-message-pending"]')).toBeHidden()

    const completed = timeline.locator('[data-slot="text-part-completed-at"]')
    const icon = timeline.locator('[data-slot="text-part-agent"]')
    const wrapper = timeline.locator('[data-slot="text-part-copy-wrapper"]')

    await expect(completed).toHaveCount(1)
    await expect(completed).toBeVisible()
    await expect(icon).toBeVisible()

    // Tapping the time does nothing without hover; tapping the icon opens the turn details.
    await completed.tap()
    await expect(page.getByRole("tooltip").filter({ hasText: "Wednesday" })).toHaveCount(0)

    await icon.tap()
    const details = page.getByRole("tooltip").filter({ hasText: "Build" })
    await expect(details).toBeVisible()
    await expect(details).toContainText("Claude Sonnet 4")
    await expect(details).toContainText("Balanced")
    await expect(details).toContainText("60.0 tok/s")

    await page.touchscreen.tap(10, 10)
    await expect(details).toBeHidden()

    const bounds = (await wrapper.boundingBox())!

    for (const item of [completed, icon]) {
      const box = (await item.boundingBox())!

      expect(box.x).toBeGreaterThanOrEqual(bounds.x)
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
    }
  })

  story("keeps the always-shown chevron clear of the prompt's text", async ({ mount }) => {
    const timeline = await mount("current-prompt-message--pending")
    await timeline.getByLabel("Delivery state").selectOption("delivered")
    const bubble = timeline.locator('[data-slot="user-message-text"]')
    await expect(bubble.getByRole("button", { name: "More actions", exact: true })).toBeVisible()

    // Every rendered line box of the prompt, against the chevron's box: none may overlap.
    const overlaps = await bubble.evaluate((element) => {
      const menu = element.querySelector('[data-slot="user-message-menu"]')
      const chevron = menu?.querySelector("button")?.getBoundingClientRect()

      if (!menu || !chevron) throw new Error("The chevron is not rendered")

      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (menu.contains(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      })

      const lines: DOMRect[] = []

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(node)
        lines.push(...range.getClientRects())
      }

      if (lines.length === 0) throw new Error("The prompt has no text")

      return lines.filter(
        (line) =>
          line.width > 0 &&
          line.left < chevron.right &&
          line.right > chevron.left &&
          line.top < chevron.bottom &&
          line.bottom > chevron.top,
      ).length
    })

    expect(overlaps).toBe(0)
  })

  story("keeps shell copy visible without hover", async ({ mount }) => {
    const timeline = await mount("current-session-terminal-work--expanded-shell")
    const copy = timeline.locator('[data-slot="bash-copy"]')
    await expect(copy).toHaveCount(2)

    for (const button of await copy.all()) {
      await expect(button).toHaveCSS("opacity", "1")
      await expect(button).toHaveCSS("pointer-events", "auto")
    }
  })

  story("keeps error copy visible without hover", async ({ mount, page }) => {
    const errors = await mount("components-tool-error-card--all")
    const patch = errors.locator('[data-kind="tool-error-card"]').filter({ hasText: "Patch" })
    await patch.getByRole("button", { name: /Patch.*Verification failed/ }).tap()
    await page.touchscreen.tap(385, 800)
    const copy = patch.locator('[data-slot="tool-error-card-copy"]')
    await expect(copy).toHaveCSS("opacity", "1")
    await expect(copy).toHaveCSS("pointer-events", "auto")
  })

  story("keeps fenced code copy visible without hover", async ({ mount }) => {
    const markdown = await mount("components-markdown--complete-response")
    const code = markdown.locator('[data-component="markdown-code"]').filter({ hasText: "export const value = 42" })
    await expect(code).toHaveCount(1)
    await expect(code.locator('[data-slot="markdown-copy-button"]')).toHaveCSS("opacity", "1")
  })
})

story("desktop user message actions still appear on hover and keyboard focus", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true)

  const actions = timeline.locator('[data-slot="user-message-menu"]')
  await expect(actions).toHaveCount(1)
  await expect(actions).toHaveCSS("opacity", "0")
  await expect(actions).toHaveCSS("pointer-events", "none")
  await actions.locator("..").hover()
  await expect(actions).toHaveCSS("opacity", "1")
  await expect(actions).toHaveCSS("pointer-events", "auto")
  await page.mouse.move(0, 0)
  await expect(actions).toHaveCSS("opacity", "0")
  await actions.getByRole("button", { name: "More actions", exact: true }).focus()
  await expect(actions).toHaveCSS("opacity", "1")
  await expect(actions).toHaveCSS("pointer-events", "auto")
})

story("desktop response details wait for the agent icon", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true)

  const actions = timeline.locator('[data-slot="text-part-copy-wrapper"]')
  await expect(actions).toHaveCount(1)
  await expect(actions).toHaveCSS("height", "20px")
  await expect(actions).toHaveCSS("margin-top", "8px")
  await expect(actions).toHaveCSS("gap", "4px")
  await expect(actions).toHaveCSS("opacity", "1")
  await expect(actions).toHaveCSS("pointer-events", "auto")

  const copy = actions.getByRole("button", { name: "Copy response", exact: true })
  await expect(copy).toBeVisible()
  await expect(copy).toHaveCSS("width", "20px")
  await expect(copy).toHaveCSS("height", "20px")
  await expect(copy.locator('[data-slot="icon-svg"]')).toHaveCSS("width", "14px")
  const rest = await copy.boundingBox()

  const icon = actions.locator('[data-slot="text-part-agent"]')
  await expect(icon).toBeVisible()
  await expect(actions.locator('[data-slot="text-part-meta"]')).toHaveCount(0)

  await icon.hover()
  const details = page.getByRole("tooltip").filter({ hasText: "Build" })
  await expect(details).toBeVisible()
  await expect(details).toContainText("Claude Sonnet 4")
  await expect(details).toContainText("4s")
  expect(await copy.boundingBox()).toEqual(rest)

  await copy.hover()
  await expect(details).toBeHidden()
  await expect(actions).toHaveCSS("opacity", "1")

  await copy.focus()
  await expect(details).toBeHidden()
})
