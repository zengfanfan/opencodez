// Names a moment's day relatively: Today and Yesterday, then the date this year, then the date with its year.
export function messageTime(time: number, locale: string) {
  const date = new Date(time)
  const now = new Date()
  const midnight = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((midnight(now) - midnight(date)) / 86_400_000)
  const clock = new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(date)

  if (days === 0 || days === 1) {
    const day = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day")
    const label = `${day[0]?.toLocaleUpperCase(locale)}${day.slice(1)}`

    return days === 0 ? clock : `${label} ${clock}`
  }

  const sameYear = date.getFullYear() === now.getFullYear()

  const day = new Intl.DateTimeFormat(
    locale,
    sameYear ? { month: "short", day: "numeric" } : { dateStyle: "medium" },
  ).format(date)

  return `${day} ${clock}`
}

export function messageTimeDetail(time: number, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(time)
}
