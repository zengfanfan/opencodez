import { expect, story } from "../../stories/playwright/story"

story.describe("touch timeline", () => {
  story.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  story("keeps message actions and metadata visible without hover", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--response-speed")
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true)

    for (const action of [
      { slot: "user-message-footer", name: "Copy message" },
      { slot: "text-part-copy-wrapper", name: "Copy response" },
    ]) {
      const actions = timeline.locator(`[data-slot="${action.slot}"]`)
      await expect(actions).toHaveCount(1)
      await expect(actions).toHaveCSS("opacity", "1")
      await expect(actions).toHaveCSS("pointer-events", "auto")
      await expect(actions.getByRole("button", { name: action.name, exact: true })).toBeVisible()
    }

    // The user footer keeps the agent details in a tooltip; the reply details are tooltips too.
    const userAgent = timeline.locator('[data-slot="user-message-agent"]')
    await expect(userAgent).toBeVisible()
    await expect(userAgent.locator(".sr-only")).toContainText("Build")
    await expect(timeline.locator('[data-slot="user-message-meta"]')).toHaveCount(0)
    await expect(timeline.locator('[data-slot="user-message-pending"]')).toHaveCount(0)

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
    await expect(details).toContainText("60 tok/s")

    await page.touchscreen.tap(10, 10)
    await expect(details).toBeHidden()

    const bounds = (await wrapper.boundingBox())!

    for (const item of [completed, icon]) {
      const box = (await item.boundingBox())!

      expect(box.x).toBeGreaterThanOrEqual(bounds.x)
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
    }
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

  story("closes the previous user agent tooltip when another opens", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--response-speed", { args: { steered: true } })
    const first = timeline.locator('[data-timeline-row="UserMessage"][data-message-id="msg_speed_user"]')
    const second = timeline.locator('[data-timeline-row="UserMessage"][data-message-id="msg_speed_steer"]')
    const firstIcon = first.locator('[data-slot="user-message-agent"]')
    const secondIcon = second.locator('[data-slot="user-message-agent"]')
    const firstTrigger = firstIcon.locator("..")
    const secondTrigger = secondIcon.locator("..")

    await expect(firstTrigger).toHaveAttribute("data-component", "tooltip-v2-trigger")
    await firstIcon.tap()
    await expect(firstTrigger).toHaveAttribute("aria-describedby", /.+/)
    const firstId = await firstTrigger.getAttribute("aria-describedby")

    if (!firstId) throw new Error("The first agent tooltip did not open")
    await expect(page.locator(`[role="tooltip"][id="${firstId}"]`)).toBeVisible()

    await secondIcon.tap()
    await expect(secondTrigger).toHaveAttribute("aria-describedby", /.+/)
    const secondId = await secondTrigger.getAttribute("aria-describedby")

    if (!secondId) throw new Error("The second agent tooltip did not open")
    await expect(page.locator(`[role="tooltip"][id="${secondId}"]`)).toBeVisible()
    await expect(firstTrigger).not.toHaveAttribute("aria-describedby")
  })
})

story("desktop user message footer waits for hover or keyboard focus and opens details", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  await timeline.getByLabel("Delivery state").selectOption("delivered")
  expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true)

  const message = timeline.locator('[data-component="user-message"]')
  const footer = timeline.locator('[data-slot="user-message-footer"]')
  const time = footer.locator('[data-slot="user-message-time"]')
  const agent = footer.locator('[data-slot="user-message-agent"]')
  const fork = footer.getByRole("button", { name: "Fork from here", exact: true })
  await expect(footer).toHaveCount(1)
  await expect(footer).toHaveCSS("opacity", "0")
  await expect(footer).toHaveCSS("pointer-events", "none")
  await message.hover()
  await expect(footer).toHaveCSS("opacity", "1")
  await expect(footer).toHaveCSS("pointer-events", "auto")
  await expect(timeline.locator('[data-slot="user-message-menu"]')).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("opacity", "0")

  await page.keyboard.press("Tab")
  await fork.focus()
  await expect(footer).toHaveCSS("opacity", "1")
  await page.keyboard.press("Shift+Tab")
  await expect(agent).toBeFocused()
  await expect(page.getByRole("tooltip").filter({ hasText: "Build" })).toBeVisible()

  await page.keyboard.press("Shift+Tab")
  await expect(time).toBeFocused()
  await expect(page.getByRole("tooltip").filter({ hasText: "Wednesday" })).toBeVisible()
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
