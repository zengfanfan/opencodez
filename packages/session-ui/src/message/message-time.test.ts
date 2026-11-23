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

  test("keeps the clock alone today", () => {
    setSystemTime(now)
    expect(messageTime(today.getTime(), "en-US")).toBe("2:32 PM")
    expect(messageTime(today.getTime(), "de-DE")).toBe("14:32")
  })

  test("names yesterday and separates it from the clock with a space", () => {
    setSystemTime(now)
    expect(messageTime(yesterday.getTime(), "en-US")).toBe("Yesterday 2:32 PM")
    expect(messageTime(yesterday.getTime(), "de-DE")).toBe("Gestern 14:32")
  })

  test("separates this year's date from the clock with a space", () => {
    setSystemTime(now)
    expect(messageTime(thisYear.getTime(), "en-US")).toBe(`${shortDate(thisYear, "en-US")} 2:32 PM`)
    expect(messageTime(thisYear.getTime(), "de-DE")).toBe(`${shortDate(thisYear, "de-DE")} 14:32`)
  })

  test("separates an older date from the clock with a space", () => {
    setSystemTime(now)
    expect(messageTime(older.getTime(), "en-US")).toBe(`${mediumDate(older, "en-US")} 2:32 PM`)
    expect(messageTime(older.getTime(), "de-DE")).toBe(`${mediumDate(older, "de-DE")} 14:32`)
  })

  test("keeps the date and clock separated by a space in Arabic", () => {
    setSystemTime(now)
    expect(messageTime(thisYear.getTime(), "ar-EG")).toBe(
      `${shortDate(thisYear, "ar-EG")} ${clock(thisYear, "ar-EG")}`,
    )
    expect(messageTime(older.getTime(), "ar-EG")).toBe(
      `${mediumDate(older, "ar-EG")} ${clock(older, "ar-EG")}`,
    )
  })
})
