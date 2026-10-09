export type ReadingRange = { timezone: string; start: string; end: string }

export type ReviewQuarter = {
  year: number
  quarter: number
  timezone: string
  start: string
  end: string
}

export function reviewCalendar(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const date = (instant: number) => {
    const parts = formatter.formatToParts(instant)
    const part = (type: string) => parts.find(value => value.type === type)!.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
  const cache = new Map<string, number>()
  // First instant of the civil date, including zones with midnight DST transitions.
  const boundary = (day: string) => {
    const cached = cache.get(day)
    if (cached !== undefined) return cached
    const utc = Date.parse(`${day}T00:00:00Z`)
    let low = utc - 2 * 86_400_000
    let high = utc + 2 * 86_400_000
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (date(mid) < day) low = mid + 1
      else high = mid
    }
    cache.set(day, low)
    return low
  }
  return { date, boundary }
}

export function nextDate(day: string, offset = 1): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}

export function monday(day: string): string {
  return nextDate(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))
}

export function reviewQuarter(year: number, quarter: number, timezone: string): ReviewQuarter {
  if (!Number.isInteger(year) || year < 1900 || year > 9998 || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
    throw new Error('Invalid review quarter')
  }
  const calendar = reviewCalendar(timezone)
  const first = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
  const last = quarter === 4 ? `${year + 1}-01-01` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-01`
  return { year, quarter, timezone, start: new Date(calendar.boundary(first)).toISOString(), end: new Date(calendar.boundary(last)).toISOString() }
}
