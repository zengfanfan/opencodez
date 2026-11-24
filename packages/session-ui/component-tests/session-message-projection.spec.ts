import { expect, story } from "../../stories/playwright/story"

declare global {
  interface Window {
    __growPointer?: Promise<string>
  }
}

story("reveals turn details from the agent icon", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--response-speed", { args: { steered: true } })
  const reply = timeline.locator('[data-component="text-part"]').filter({ hasText: "The timeline checks passed." })
  const footer = reply.locator('[data-slot="text-part-copy-wrapper"]')
  const icon = footer.locator('[data-slot="text-part-agent"]')
  const copy = footer.getByRole("button", { name: "Copy response", exact: true })
  const details = page.getByRole("tooltip").filter({ hasText: "Build" })

  await expect(icon).toBeVisible()
  await expect(copy).toBeVisible()
  await expect(footer.locator('[data-slot="text-part-meta"]')).toHaveCount(0)

  await icon.hover()
  await expect(details).toBeVisible()
  await expect(details).toContainText("Claude Sonnet 4")
  await expect(details).toContainText("Balanced")
  await expect(details).toContainText("5m 2s")
  await expect(details).toContainText("60 tok/s")

  await copy.hover()
  await expect(details).toBeHidden()

  for (const width of [1000, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await icon.hover()
    await expect(details).toBeVisible()
    const box = (await icon.boundingBox())!

    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  }
})

story("omits turn speed when a model step has no streaming time", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--response-speed", { args: { measured: false } })
  const reply = timeline.locator('[data-component="text-part"]').filter({ hasText: "The timeline checks passed." })
  const icon = reply.locator('[data-slot="text-part-agent"]')

  await icon.hover()
  const details = page.getByRole("tooltip").filter({ hasText: "5m 2s" })

  await expect(details).toBeVisible()
  await expect(details).not.toContainText("tok/s")
})

story("keeps quote attachment icons fixed while long text truncates", async ({ mount, page }) => {
  const gallery = await mount("current-session-timeline-rows--quote-attachments")

  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  for (const title of ["Remove this", "Can we make this smaller?"]) {
    const icon = gallery
      .locator('[data-component="attachment-card"]')
      .filter({ hasText: title })
      .locator('[data-slot="icon-svg"]')

    await expect(icon).toHaveCSS("width", "12px")
    await expect(icon).toHaveCSS("height", "12px")
  }

  const label = gallery.locator('[data-slot="attachment-card-label"]').filter({ hasText: "It has a 32px minimum" })

  expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await expect(label).toHaveCSS("text-overflow", "ellipsis")
})

story.describe("response footer", () => {
  story.use({ timezoneId: "UTC" })

  story("shows the turn's last completed step and its details", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--response-speed", {
      args: { trailingTool: true },
    })

    const reply = timeline.locator('[data-component="text-part"]').filter({ hasText: "The timeline checks passed." })
    const footer = reply.locator('[data-slot="text-part-copy-wrapper"]')
    const completed = footer.locator('[data-slot="text-part-completed-at"]')
    const icon = footer.locator('[data-slot="text-part-agent"]')
    const details = page.getByRole("tooltip").filter({ hasText: "Build" })
    const timeTip = page.getByRole("tooltip").filter({ hasText: "Wednesday" })

    // The trailing tool step completes later than the text, so its time names the turn's completion.
    await expect(completed).toHaveText("Jan 1, 2025 12:05 AM")
    await expect(completed).toHaveAttribute("datetime", "2025-01-01T00:05:05.000Z")
    await expect(completed).toBeVisible()
    await expect(icon).toBeVisible()
    await expect(footer.locator('[data-slot="text-part-meta"]')).toHaveCount(0)

    const iconBox = (await icon.boundingBox())!
    const timeBox = (await completed.boundingBox())!

    expect(iconBox.x).toBeLessThan(timeBox.x)

    await completed.hover()
    await expect(timeTip).toBeVisible()
    await expect(timeTip).toContainText("Wednesday")
    await expect(timeTip).toContainText("January 1, 2025")
    await expect(timeTip).toContainText("12:05:05")
    await expect(timeTip).toContainText("UTC")

    await icon.hover()
    await expect(details).toBeVisible()
    await expect(details).toContainText("tok/s")
  })

  story("opens the agent and time details with the keyboard", async ({ mount, page }) => {
    const timeline = await mount("current-session-timeline-rows--response-speed")
    const reply = timeline.locator('[data-component="text-part"]').filter({ hasText: "The timeline checks passed." })
    const footer = reply.locator('[data-slot="text-part-copy-wrapper"]')
    const copy = footer.getByRole("button", { name: "Copy response", exact: true })
    const details = page.getByRole("tooltip").filter({ hasText: "Build" })
    const timeTip = page.getByRole("tooltip").filter({ hasText: "Wednesday" })

    await copy.focus()
    await expect(details).toBeHidden()
    await expect(footer.locator('[data-slot="text-part-agent"] [data-slot="icon-svg"]')).not.toHaveClass(
      /text-v2-agent/,
    )

    await page.keyboard.press("Tab")
    await expect(details).toBeVisible()

    await page.keyboard.press("Tab")
    await expect(timeTip).toBeVisible()
  })

  story("omits the completion time while the turn streams", async ({ mount }) => {
    const timeline = await mount("current-session-timeline-rows--streaming-reasoning-and-text")
    await expect(timeline.locator('[data-slot="text-part-completed-at"]')).toHaveCount(0)
  })
})

story.describe("user message footer", () => {
  story.use({ timezoneId: "UTC" })

  story("reveals the footer on hover with the send time and the actions the message can take", async ({
    mount,
    page,
  }) => {
    const timeline = await mount("current-prompt-message--pending")
    const message = timeline.locator('[data-component="user-message"]')
    await timeline.getByLabel("Delivery state").selectOption("delivered")
    await page.mouse.move(0, 0)

    const footer = message.locator('[data-slot="user-message-footer"]')
    const time = footer.locator('[data-slot="user-message-time"]')
    const agent = footer.locator('[data-slot="user-message-agent"]')
    const fork = footer.getByRole("button", { name: "Fork from here", exact: true })
    const copy = footer.getByRole("button", { name: "Copy message", exact: true })
    const revert = footer.getByRole("button", { name: "Revert to here", exact: true })

    await expect(footer).toHaveCSS("opacity", "0")
    await expect(footer).toHaveCSS("pointer-events", "none")
    await message.hover()
    await expect(footer).toHaveCSS("opacity", "1")
    await expect(footer).toHaveCSS("pointer-events", "auto")
    await expect(timeline.locator('[data-slot="user-message-menu"]')).toHaveCount(0)
    await expect(timeline.getByRole("button", { name: "More actions", exact: true })).toHaveCount(0)
    await expect(time).toHaveText("Jan 1, 2025 12:00 AM")
    await expect(time).toHaveAttribute("datetime", "2025-01-01T00:00:00.000Z")

    const boxes = await Promise.all(
      [time, agent, fork, copy, revert].map((item) => item.boundingBox()),
    )

    if (boxes.some((box) => !box)) throw new Error("Footer geometry is unavailable")

    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]!.x).toBeGreaterThan(boxes[index - 1]!.x)
    }

    const [agentColor, copyColor] = await Promise.all([
      agent.evaluate((element) => getComputedStyle(element).color),
      copy.evaluate((element) => getComputedStyle(element).color),
    ])

    expect(agentColor).toBe(copyColor)

    await time.hover()
    const timeTip = page.getByRole("tooltip").filter({ hasText: "Wednesday" })
    await expect(timeTip).toBeVisible()
    await expect(timeTip).toContainText("January 1, 2025")
    await expect(timeTip).toContainText("12:00:00")

    await agent.hover()
    const details = page.getByRole("tooltip").filter({ hasText: "Build" })
    await expect(details).toBeVisible()
    await expect(details).toContainText("Claude Sonnet 4")
    await expect(details).toContainText("Balanced")

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await page.clock.install()
    await copy.click()
    await expect(footer.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
    await page.clock.runFor(2_000)
    await expect(copy).toBeVisible()
  })

  story("names the newest prompt's revert Undo and earlier ones Revert to here", async ({ mount }) => {
    const timeline = await mount("current-session-timeline-rows--prompt-runs")
    await timeline.getByRole("button", { name: "Send next", exact: true }).click()
    const messages = timeline.locator('[data-component="user-message"]')
    await expect(messages).toHaveCount(2)

    const first = messages.nth(0)
    const second = messages.nth(1)

    await expect(first.getByRole("button", { name: "Revert to here", exact: true })).toBeVisible()
    await expect(second.getByRole("button", { name: "Undo", exact: true })).toBeVisible()
    await expect(first.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
    await expect(second.getByRole("button", { name: "Revert to here", exact: true })).toHaveCount(0)
  })
})

story("shows only the actions each delivery state allows", async ({ mount }) => {
  const timeline = await mount("current-prompt-message--pending")
  const message = timeline.locator('[data-component="user-message"]')
  const bubble = message.locator('[data-slot="user-message-text"]')
  const footer = timeline.locator('[data-slot="user-message-footer"]')
  const button = (name: string) => footer.getByRole("button", { name, exact: true })
  const pending = footer.locator('[data-slot="user-message-pending"]')

  const cases = [
    {
      status: "starting",
      waiting: false,
      present: ["Move to queue", "Copy message", "Delete"],
      absent: ["Fork from here", "Revert to here", "Undo"],
    },
    {
      status: "steering",
      waiting: true,
      present: ["Move to queue", "Copy message", "Delete"],
      absent: ["Fork from here", "Revert to here", "Undo"],
    },
    {
      status: "stranded",
      waiting: true,
      present: ["Move to queue", "Copy message", "Delete"],
      absent: ["Fork from here", "Revert to here", "Undo"],
    },
    {
      status: "sending",
      waiting: true,
      present: ["Copy message"],
      absent: ["Move to queue", "Delete", "Fork from here", "Revert to here", "Undo"],
    },
    {
      status: "queued",
      waiting: false,
      present: ["Fork from here", "Copy message", "Revert to here"],
      absent: ["Move to queue", "Delete", "Undo"],
    },
    {
      status: "delivered",
      waiting: false,
      present: ["Fork from here", "Copy message", "Revert to here"],
      absent: ["Move to queue", "Delete", "Undo"],
    },
  ] as const

  for (const item of cases) {
    await timeline.getByLabel("Delivery state").selectOption(item.status)
    await bubble.hover()
    await expect(footer).toHaveCSS("opacity", "1")
    await expect(pending).toHaveCount(item.waiting ? 1 : 0)

    for (const name of item.present) await expect(button(name)).toBeVisible()

    for (const name of item.absent) await expect(button(name)).toHaveCount(0)
  }
})

story("shows a Pending footer for an attachment-only sending message", async ({ mount }) => {
  const timeline = await mount("current-prompt-message--sending-attachment")
  const message = timeline.locator('[data-component="user-message"]')
  const footer = timeline.locator('[data-slot="user-message-footer"]')

  await expect(footer).toHaveCSS("opacity", "0")
  await message.hover()
  await expect(footer).toHaveCSS("opacity", "1")
  await expect(footer.locator('[data-slot="user-message-pending"]')).toHaveText("Pending")
  await expect(footer.getByRole("button", { name: "Copy message", exact: true })).toBeDisabled()
  await expect(
    footer.getByRole("button", { name: /^(Move to queue|Delete|Fork from here|Revert to here|Undo)$/ }),
  ).toHaveCount(0)
})

story("keeps pending steer actions usable after a request fails", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  const message = timeline.locator('[data-component="user-message"]')
  const footer = timeline.locator('[data-slot="user-message-footer"]')
  const queue = footer.getByRole("button", { name: "Move to queue", exact: true })
  const remove = footer.getByRole("button", { name: "Delete", exact: true })
  const failures = timeline.getByLabel("Failed actions")

  await timeline.getByLabel("Actions fail").check()
  await message.locator('[data-slot="user-message-text"]').hover()
  await queue.click()
  await expect(failures).toHaveText("1")
  await expect(queue).toBeEnabled()
  await expect(remove).toBeEnabled()
  await remove.click()
  await expect(failures).toHaveText("2")
  await expect(remove).toBeEnabled()
})

story("reveals each run bubble's footer on its own hover", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--prompt-runs")
  const send = timeline.getByRole("button", { name: "Send next", exact: true })
  await send.click()
  await send.click()

  const messages = timeline.locator('[data-component="user-message"]')
  const footers = timeline.locator('[data-slot="user-message-footer"]')
  await expect(footers).toHaveCount(3)

  for (let index = 0; index < 3; index += 1) {
    await expect(footers.nth(index)).toHaveCSS("opacity", "0")
    await messages.nth(index).locator('[data-slot="user-message-text"]').hover()
    await expect(footers.nth(index)).toHaveCSS("opacity", "1")
    await page.mouse.move(0, 0)
    await expect(footers.nth(index)).toHaveCSS("opacity", "0")
  }
})

story("names the newest prompt's revert Undo and earlier ones Revert to here", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--prompt-runs")
  await timeline.getByRole("button", { name: "Send next", exact: true }).click()
  const messages = timeline.locator('[data-component="user-message"]')
  await expect(messages).toHaveCount(2)

  const first = messages.nth(0)
  const second = messages.nth(1)

  await first.locator('[data-slot="user-message-text"]').hover()
  await expect(first.locator('[data-slot="user-message-footer"]')).toHaveCSS("opacity", "1")
  await expect(first.getByRole("button", { name: "Revert to here", exact: true })).toBeVisible()
  await second.locator('[data-slot="user-message-text"]').hover()
  await expect(second.locator('[data-slot="user-message-footer"]')).toHaveCSS("opacity", "1")
  await expect(second.getByRole("button", { name: "Undo", exact: true })).toBeVisible()
  await expect(first.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0)
  await expect(second.getByRole("button", { name: "Revert to here", exact: true })).toHaveCount(0)
})

story("drops a pending footer at once on delivery with and without hover", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  const message = timeline.locator('[data-component="user-message"]')
  const footer = message.locator('[data-slot="user-message-footer"]')
  const pending = footer.locator('[data-slot="user-message-pending"]')
  const time = footer.locator('[data-slot="user-message-time"]')
  const bubble = timeline.locator('[data-slot="user-message-text"]')

  await page.mouse.move(0, 0)
  await expect(footer).toHaveCSS("height", "20px")
  await expect(footer).toHaveCSS("margin-top", "8px")

  for (const hover of [true, false]) {
    await timeline.getByLabel("Delivery state").selectOption("steering")

    if (hover) await bubble.hover()

    if (!hover) await page.mouse.move(0, 0)

    await expect(footer).toHaveCSS("opacity", hover ? "1" : "0")
    await expect(pending).toHaveText("Pending")

    await timeline.getByLabel("Delivery state").selectOption("delivered")

    if (hover) await bubble.hover()

    if (!hover) await page.mouse.move(0, 0)

    await expect(pending).toHaveCount(0)
    await expect(time).toHaveCount(1)
    await expect(footer).toHaveCSS("opacity", hover ? "1" : "0")
    await expect(message).not.toHaveAttribute("data-delivering")
    expect(await footer.evaluate((element) => element.getAnimations().length)).toBe(0)
  }

  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce")
  await timeline.getByLabel("Delivery state").selectOption("steering")
  await timeline.getByLabel("Delivery state").selectOption("delivered")
  await expect(pending).toHaveCount(0)
  await expect(time).toHaveCount(1)
  expect(await footer.evaluate((element) => element.getAnimations().length)).toBe(0)
})

story("marks pending metadata without badging delivered, starting, or queued prompts", async ({ mount, page }) => {
  const timeline = await mount("current-prompt-message--pending")
  // The controlled message renders last; Grouped prompts adds an earlier one above it.
  const message = timeline.locator('[data-component="user-message"]').last()
  const footer = message.locator('[data-slot="user-message-footer"]')
  const indicator = footer.locator('[data-slot="user-message-pending"]')
  const text = message.locator('[data-slot="user-message-text"]')

  for (const status of ["steering", "stranded", "sending", "starting", "queued", "delivered"]) {
    await timeline.getByLabel("Delivery state").selectOption(status)
    const pending = status === "steering" || status === "stranded" || status === "sending"

    if (pending) await expect(indicator).toBeVisible()

    if (!pending) await expect(indicator).toHaveCount(0)

    const colors = await message.evaluate((element, pending) => {
      const probe = document.createElement("span")
      probe.style.color = `var(--v2-text-text-${pending ? "muted" : "base"})`
      probe.style.backgroundColor = `var(--v2-background-bg-layer-${pending ? "01" : "02"})`
      element.append(probe)
      const result = { color: getComputedStyle(probe).color, background: getComputedStyle(probe).backgroundColor }
      probe.remove()

      return result
    }, pending)

    await expect(text).toHaveCSS("color", colors.color)
    await expect(text).toHaveCSS("background-color", colors.background)
  }

  await expect(timeline.locator('[data-slot="user-message-meta"]')).toHaveCount(0)
  await expect(message.locator('[data-slot="user-message-agent"] .sr-only')).toHaveText(
    "Build · Claude Sonnet 4 Balanced",
  )

  // A steer reads Pending in the footer; the agent and model stay in the icon's accessible details.
  await timeline.getByLabel("Delivery state").selectOption("steering")
  await expect(indicator).toHaveText("Pending")
  await expect(message.locator('[data-slot="user-message-agent"] .sr-only')).toHaveText(
    "Build · Claude Sonnet 4 Balanced",
  )

  await timeline.getByLabel("Voice message", { exact: true }).check()
  const voice = message.getByRole("img", { name: "Voice", exact: true })
  await expect(voice).toBeVisible()
  await message.locator('[data-slot="user-message-text"]').hover()
  await expect(indicator).toBeVisible()
  await expect(message.getByRole("button", { name: "Copy full message", exact: true })).toBeVisible()
  await expect(indicator.locator("svg")).toHaveCount(0)

  await expect(voice.locator("use")).toHaveAttribute("href", "#opencode-v2-icon-outline-wave-audio")
  await expect(voice).toHaveCSS("width", "20px")
  await expect(voice).toHaveCSS("height", "20px")
  await expect(voice.locator('[data-slot="icon-svg"]')).toHaveCSS("width", "14px")
  await expect(voice.locator('[data-slot="icon-svg"]')).toHaveCSS("height", "14px")

  await timeline.getByLabel("Grouped prompts", { exact: true }).check()
  const groupedMessages = timeline.locator('[data-component="user-message"]')
  const footers = timeline.locator('[data-slot="user-message-footer"]')
  await expect(footers).toHaveCount(2)

  for (let index = 0; index < 2; index += 1) {
    await expect(footers.nth(index)).toHaveCSS("opacity", "0")
    await groupedMessages.nth(index).locator('[data-slot="user-message-text"]').hover()
    await expect(footers.nth(index)).toHaveCSS("opacity", "1")
    await expect(footers.nth(index).locator('[data-slot="user-message-pending"]')).toHaveText("Pending")
  }

  await expect(timeline.getByRole("img", { name: "Pending", exact: true })).toHaveCount(0)
  await timeline.getByLabel("Grouped prompts", { exact: true }).uncheck()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(indicator).toBeVisible()
  await expect(timeline.locator('[data-slot="user-message-meta"]')).toHaveCount(0)
  expect(await footer.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)

  await timeline.getByLabel("Prompt text", { exact: true }).uncheck()
  await expect(timeline.getByText("notes.json", { exact: true })).toBeVisible()
  await expect(indicator).toBeVisible()
  await message.hover()
  await message.getByRole("button", { name: "Move to queue", exact: true }).click()
  await expect(footer).toHaveCount(0)
})

story("copies the display text and the full voice prompt from separate buttons", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--voice-messages")
  const row = timeline.locator('[data-timeline-row="UserMessage"][data-message-id="msg_user_voice"]')
  const footer = row.locator('[data-slot="user-message-footer"]')
  await expect(footer).toHaveCSS("opacity", "0")
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await page.clock.install()
  await row.locator('[data-slot="user-message-text"]').hover()
  await expect(footer).toHaveCSS("opacity", "1")

  const copy = footer.getByRole("button", { name: "Copy message", exact: true })
  const full = footer.getByRole("button", { name: "Copy full message", exact: true })

  await expect(copy).toBeVisible()
  await expect(full).toBeVisible()
  await copy.click()
  await expect(footer.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("Checking the upload test.")
  await page.clock.runFor(2_000)
  await expect(copy).toBeVisible()

  await full.click()
  await expect(footer.getByRole("button", { name: "Copied", exact: true })).toBeVisible()
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('"instruction": "check the upload test"')
  await expect(copy).toBeVisible()
})

story("keeps the previous pending footer when another steer joins the run", async ({ mount, page }) => {
  const timeline = await mount("current-session-timeline-rows--prompt-runs")
  const send = timeline.getByRole("button", { name: "Send next", exact: true })

  for (let count = 0; count < 4; count += 1) await send.click()

  const fourth = timeline.locator('[data-timeline-row="UserMessage"][data-message-id="msg_end_4"]')
  await expect(fourth.locator('[data-slot="user-message-pending"]')).toHaveText("Pending")
  await expect(timeline.locator('[data-timeline-grow]')).toHaveCount(0)

  await page.evaluate(() => {
    window.__growPointer = new Promise<string>((resolve) => {
      let observer: MutationObserver | undefined

      const find = (node: Node) => {
        if (!(node instanceof HTMLElement)) return undefined

        if (!node.hasAttribute("data-timeline-grow")) return undefined

        if (node.getAttribute("data-timeline-row") !== "UserMessage") return undefined

        if (node.dataset.messageId !== "msg_end_5") return undefined

        return node
      }

      const inspect = (node: Node) => {
        const found = find(node)

        if (found) {
          observer?.disconnect()
          resolve(getComputedStyle(found).pointerEvents)

          return true
        }

        if (node instanceof HTMLElement) {
          for (const child of node.querySelectorAll<HTMLElement>('[data-timeline-grow]')) {
            const nested = find(child)

            if (!nested) continue

            observer?.disconnect()
            resolve(getComputedStyle(nested).pointerEvents)

            return true
          }
        }

        return false
      }

      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes") {
            if (inspect(record.target)) return

            continue
          }

          for (const node of record.addedNodes) {
            if (inspect(node)) return
          }
        }
      })

      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ["data-timeline-grow"],
        childList: true,
        subtree: true,
      })
    })
  })

  await send.click()

  const pointer = await page.evaluate(() => {
    if (!window.__growPointer) throw new Error("Growth observer was not installed")

    return window.__growPointer
  })

  expect(pointer).toBe("none")
  await expect(timeline.locator('[data-timeline-grow]')).toHaveCount(0)

  const fifth = timeline.locator('[data-timeline-row="UserMessage"][data-message-id="msg_end_5"]')
  const fourthFooter = fourth.locator('[data-slot="user-message-footer"]')
  const fifthFooter = fifth.locator('[data-slot="user-message-footer"]')
  await fourth.locator('[data-slot="user-message-text"]').hover()
  await expect(fourthFooter).toHaveCSS("opacity", "1")
  const fourthBox = (await fourthFooter.boundingBox())!
  await fifth.locator('[data-slot="user-message-text"]').hover()
  await expect(fifthFooter).toHaveCSS("opacity", "1")
  const fifthBubble = (await fifth.locator('[data-slot="user-message-text"]').boundingBox())!

  expect(fourthBox.y + fourthBox.height).toBeLessThanOrEqual(fifthBubble.y)
  await expect(fourthFooter.locator('[data-slot="user-message-pending"]')).toHaveText("Pending")
  await expect(fifthFooter.locator('[data-slot="user-message-pending"]')).toHaveText("Pending")

  const leftovers = await fifth.evaluate((row) => {
    // SAFETY: the locator resolves a timeline row element, which is an HTMLElement.
    const element = row as HTMLElement
    // SAFETY: the row always renders its session-turn content wrapper before it is measured.
    const content = element.firstElementChild as HTMLElement | null

    return {
      pointerEvents: element.style.pointerEvents,
      height: element.style.height,
      opacity: content?.style.opacity,
      visibility: content?.style.visibility,
      transform: content?.style.transform,
    }
  })

  expect(leftovers).toEqual({ pointerEvents: "", height: "", opacity: "", visibility: "", transform: "" })
})

// Moved from packages/app/e2e/regression/session-timeline-collapse-state.spec.ts
story("keeps a manually collapsed tool collapsed when later assistant content streams", async ({ mount }) => {
  const timeline = await mount("current-session-file-changes--changing-files", { args: { scenario: "streaming" } })
  const tool = timeline.locator('[data-timeline-part-id="tool_edit_status"]')
  const trigger = tool.locator('[data-scope="apply-patch"] button')
  await expect(trigger).toHaveAttribute("aria-expanded", "true")
  // SAFETY: the locator targets a rendered DOM element, which is always an HTMLElement in the story.
  await tool.evaluate((element) => ((element as HTMLElement).dataset.regressionMarker = "before-stream"))
  await trigger.click()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await timeline.getByRole("button", { name: "Stream sibling content" }).click()
  await expect(timeline.getByText("Streaming added a later assistant text part.", { exact: true })).toBeVisible()
  await expect(tool).toHaveAttribute("data-regression-marker", "before-stream")
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await expect(tool.locator("xpath=ancestor::*[@data-timeline-row]")).toHaveAttribute(
    "data-timeline-row",
    "AssistantPart",
  )
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders interruption independently when the turn is not compacted", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "interruption" } })
  await expect(timeline.getByText("Interrupted", { exact: true })).toBeVisible()
  await expect(timeline.getByText("Before", { exact: true })).toBeVisible()
  await expect(timeline.getByText("After", { exact: true })).toBeVisible()

  const rows = await timeline
    .locator('[data-timeline-row="AssistantPart"], [data-timeline-row="TurnDivider"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-timeline-row")))

  expect(rows).toEqual(["AssistantPart", "TurnDivider", "AssistantPart"])
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders aliased and long custom model notices", async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 700 })
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "models" } })
  const shortName = "GPT-5.4 nano"
  const longName = "Company Gateway Extra Long Context Model for Narrow Timeline Layouts"

  const short = timeline
    .locator('[data-slot="session-timeline-notice"]')
    .filter({ hasText: shortName })
    .filter({ hasText: "xhigh" })

  const long = timeline.locator('[data-slot="session-timeline-notice"]').filter({ hasText: longName })
  await expect(short).toBeVisible()
  await expect(short.getByText(`Switched to ${shortName}`, { exact: true })).toBeVisible()
  await expect(short.locator('[data-slot="session-timeline-notice-variant"]')).toHaveText("xhigh")
  await expect(timeline.getByText("fast-nano", { exact: true })).toHaveCount(0)
  await expect(short.locator('[data-component="provider-icon"]')).toBeVisible()

  const variantDefault = timeline
    .locator('[data-slot="session-timeline-notice"]')
    .filter({ hasText: "Switched variant to Default" })

  const variantHigh = timeline
    .locator('[data-slot="session-timeline-notice"]')
    .filter({ hasText: "Switched variant to high" })

  await expect(variantDefault.getByText("Switched variant to Default", { exact: true })).toBeVisible()
  await expect(variantHigh.getByText("Switched variant to high", { exact: true })).toBeVisible()
  await expect(variantDefault.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(variantHigh.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(long).toBeVisible()
  await expect(long.locator('[data-component="provider-icon"]')).toBeVisible()
  await expect(long.locator('[data-slot="session-timeline-notice-variant"]')).toHaveCount(0)
  await expect(long.locator("[title]")).toHaveAttribute("title", `Switched to ${longName}`)
  await expect.poll(() => long.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

// Moved from packages/app/e2e/regression/session-timeline-projection.spec.ts
story("renders user image, file attachment, file reference, and agent reference", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "attachments" } })
  await expect(timeline.getByAltText("pixel.png")).toBeVisible()
  await expect(timeline.getByText("tsconfig.json")).toBeVisible()
  await expect(timeline.getByText("@src/a.ts", { exact: true })).toBeVisible()
  await expect(timeline.getByText("@explore", { exact: true })).toBeVisible()

  const accent = await timeline.evaluate((element) => {
    const probe = document.createElement("span")
    probe.style.color = "var(--v2-text-text-accent)"
    element.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()

    return color
  })

  for (const mention of await timeline.locator("[data-highlight]").all()) {
    await expect(mention).toHaveCSS("color", accent)
    await expect(mention).toHaveCSS("font-weight", "440")
  }

  for (const prefix of await timeline.locator('[data-slot="user-message-mention-prefix"]').all()) {
    await expect(prefix).toHaveCSS("color", accent)
  }

  const attachments = timeline.locator('[data-slot="user-message-attachments"]')
  const body = timeline.locator('[data-slot="user-message-body"]')
  const [attachmentsBox, bodyBox] = await Promise.all([attachments.boundingBox(), body.boundingBox()])
  expect(attachmentsBox).not.toBeNull()
  expect(bodyBox).not.toBeNull()
  expect(bodyBox!.y - (attachmentsBox!.y + attachmentsBox!.height)).toBe(8)
})

story("a stored image that fails to load shows a failed tile that retries", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "media" } })
  const tiles = timeline.locator('[data-slot="user-message-attachment"]')

  await expect(timeline.getByAltText("ready.svg")).toBeVisible()
  // A failed read used to keep the loading placeholder forever.
  const failed = tiles.first()
  await expect(failed.getByRole("img", { name: "Unable to load image." })).toBeVisible()
  await expect(failed).not.toHaveAttribute("data-placeholder")

  const tileSize = { width: 132, height: 88 }
  expect(await failed.boundingBox()).toMatchObject(tileSize)

  await failed.click()
  await expect(timeline.getByAltText("flaky.svg")).toBeVisible()
  expect(await failed.boundingBox()).toMatchObject(tileSize)
})

story("shows note selectors and keeps annotation subtitles with or without comments", async ({ mount, page }) => {
  const gallery = await mount("current-session-timeline-rows--note-attachments")

  const cases = [
    { name: "Named", heading: "button#save", secondary: "Browser annotation" },
    { name: "Unnamed", heading: "button.icon-only", secondary: "Browser annotation" },
    { name: "Legacy", heading: "Legacy element", secondary: "Legacy element" },
    { name: "Whitespace", heading: "Fallback element", secondary: "Fallback element" },
    { name: "Title only", heading: "button#save", secondary: "Original label" },
    { name: "Commented", heading: "Fix this", secondary: "Browser annotation" },
    { name: "RTL subtitle", heading: "button#save", secondary: "تعليق المتصفح" },
    { name: "RTL legacy", heading: "العنصر الأصلي", secondary: "العنصر الأصلي" },
    {
      name: "Long selector",
      heading: 'main > section.settings-panel > form > button[data-action="save-all-account-preferences"]',
      secondary: "Browser annotation",
    },
  ]

  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  for (const item of cases) {
    const section = gallery.getByRole("region", { name: item.name, exact: true })
    const card = section.getByRole("button")
    const heading = card.locator('[data-slot="attachment-card-title"]')
    const label = card.locator('[data-slot="attachment-card-label"]')
    await expect(heading).toHaveText(item.heading)
    await expect(label).toHaveText(item.secondary)
  }

  const long = gallery.getByRole("region", { name: "Long selector", exact: true }).getByRole("button")
  await expect(long).toHaveCSS("width", "160px")
  await expect(long).toHaveCSS("height", "52px")
  await expect(long.locator('[data-slot="attachment-card-title"]')).toHaveCSS("white-space", "nowrap")
  await expect(long.locator('[data-slot="attachment-card-title"]')).toHaveCSS("text-overflow", "ellipsis")
  const rtl = gallery.getByRole("region", { name: "RTL subtitle", exact: true }).getByRole("button")
  const label = rtl.locator('[data-slot="attachment-card-label"]')
  await expect(label).toHaveCSS("white-space", "nowrap")
  await expect(label).toHaveCSS("text-overflow", "ellipsis")
  await expect(label).toHaveAttribute("dir", "ltr")
  await expect(label).toHaveCSS("unicode-bidi", "isolate")
  expect(
    await long
      .locator('[data-slot="attachment-card-title"]')
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true)

  const named = gallery.getByRole("region", { name: "Named", exact: true }).getByRole("button")
  await page.clock.install()
  await named.hover()
  await page.clock.runFor(1000)
  await expect(page.getByRole("tooltip")).toHaveText("button#save\nBrowser annotation")
  await long.hover()
  await page.clock.runFor(1000)
  await expect(page.getByRole("tooltip", { name: /^main > section/ })).toHaveText(
    'main > section.settings-panel > form > button[data-action="save-all-account-preferences"]\nBrowser annotation',
  )
  await page.clock.resume()
  await named.click()
  await expect(gallery.getByLabel("Selected attachment")).toHaveText("Named")
  await rtl.focus()
  await page.keyboard.press("Enter")
  await expect(gallery.getByLabel("Selected attachment")).toHaveText("RTL subtitle")
  await named.focus()
  await page.keyboard.press("Space")
  await expect(gallery.getByLabel("Selected attachment")).toHaveText("Named")
})

story("links URLs in user messages without swallowing punctuation or mentions", async ({ mount }) => {
  const timeline = await mount("current-session-timeline-rows--conversation", { args: { scenario: "links" } })
  const links = timeline.locator('[data-slot="user-message-text"] a[data-slot="user-message-link"]')
  await expect(links).toHaveCount(2)
  await expect(links.nth(0)).toHaveText("https://github.com/Hona/mesh")
  await expect(links.nth(0)).toHaveAttribute("href", "https://github.com/Hona/mesh")
  await expect(links.nth(0)).toHaveAttribute("target", "_blank")
  await expect(links.nth(0)).toHaveCSS("cursor", "pointer")
  await expect(links.nth(1)).toHaveText("https://opencode.ai/docs")
  await expect(timeline.getByText("@src/a.ts", { exact: true })).toBeVisible()
  await expect(timeline.locator('[data-slot="user-message-text"]')).toHaveText(
    "set it up on this pc https://github.com/Hona/mesh, then compare @src/a.ts with (https://opencode.ai/docs).",
  )
})
