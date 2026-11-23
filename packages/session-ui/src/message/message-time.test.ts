import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import { messageTime } from "./message-time"

afterEach(() => setSystemTime())

const clock = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date)

const shortDate = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date)

const mediumDate = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date)

describe("messageTime", () => {
  const now = new Date(2025, 6, 15, 18, 0)
  const today = new Date(2025, 6, 15, 14, 32)
  const yesterday = new Date(2025, 6, 14, 14, 32)
  const thisYear = new Date(2025, 0, 20, 14, 32)
  const older = new Date(2024, 0, 20, 14, 32)

  test("reply keeps the clock alone today", () => {
    setSystemTime(now)
    expect(messageTime(today.getTime(), "en-US", "reply")).toBe("2:32 PM")
    expect(messageTime(today.getTime(), "de-DE", "reply")).toBe("14:32")
  })

  test("reply names yesterday and separates it from the clock with a space", () => {
    setSystemTime(now)
    expect(messageTime(yesterday.getTime(), "en-US", "reply")).toBe("Yesterday 2:32 PM")
    expect(messageTime(yesterday.getTime(), "de-DE", "reply")).toBe("Gestern 14:32")
  })

  test("reply separates this year's date from the clock with a space", () => {
    setSystemTime(now)
    expect(messageTime(thisYear.getTime(), "en-US", "reply")).toBe(`${shortDate(thisYear, "en-US")} 2:32 PM`)
    expect(messageTime(thisYear.getTime(), "de-DE", "reply")).toBe(`${shortDate(thisYear, "de-DE")} 14:32`)
  })

  test("reply separates an older date from the clock with a space", () => {
    setSystemTime(now)
    expect(messageTime(older.getTime(), "en-US", "reply")).toBe(`${mediumDate(older, "en-US")} 2:32 PM`)
    expect(messageTime(older.getTime(), "de-DE", "reply")).toBe(`${mediumDate(older, "de-DE")} 14:32`)
  })

  test("reply keeps the date and clock separated by a space in Arabic", () => {
    setSystemTime(now)
    expect(messageTime(thisYear.getTime(), "ar-EG", "reply")).toBe(
      `${shortDate(thisYear, "ar-EG")} ${clock(thisYear, "ar-EG")}`,
    )
    expect(messageTime(older.getTime(), "ar-EG", "reply")).toBe(
      `${mediumDate(older, "ar-EG")} ${clock(older, "ar-EG")}`,
    )
  })

  test("menu keeps its comma between the day and the clock", () => {
    setSystemTime(now)
    expect(messageTime(today.getTime(), "en-US", "menu")).toBe("Today, 2:32 PM")
    expect(messageTime(yesterday.getTime(), "en-US", "menu")).toBe("Yesterday, 2:32 PM")
    expect(messageTime(thisYear.getTime(), "en-US", "menu")).toBe(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(thisYear),
    )
    expect(messageTime(older.getTime(), "en-US", "menu")).toBe(
      new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(older),
    )
  })
})
