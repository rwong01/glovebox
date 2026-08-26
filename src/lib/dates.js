/**
 * Date helpers shared by the flagging engine and the UI.
 *
 * Kept separate from `flagging.js` so both can be tested in isolation, and so
 * there is exactly one place that decides how a Postgres `date` becomes a
 * JavaScript `Date`.
 */

/** Days in an average Gregorian month. Used for pace maths, never for due dates. */
export const AVG_DAYS_PER_MONTH = 30.436875

/**
 * Parses a value into a Date.
 *
 * The important case is a bare `YYYY-MM-DD` from a Postgres `date` column.
 * `new Date('2024-03-03')` parses that as UTC midnight, which renders as
 * March 2nd for anyone west of Greenwich. Parsing the parts by hand pins it to
 * local midnight instead, so a service logged on the 3rd always reads as the 3rd.
 */
export function toDate(value) {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (dateOnly) {
      const [, y, m, d] = dateOnly
      return new Date(Number(y), Number(m) - 1, Number(d))
    }
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Formats a Date as `YYYY-MM-DD` in local time, for writing back to Postgres. */
export function toISODate(value) {
  const date = toDate(value)
  if (!date) return null
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Adds calendar months, clamping the day so that Jan 31 + 1 month is Feb 28
 * rather than rolling into March. Due dates use this rather than a day count,
 * so "12 months after March 3rd" is always March 3rd.
 */
export function addMonths(value, months) {
  const date = toDate(value)
  if (!date || !Number.isFinite(months)) return null
  const day = date.getDate()
  const shifted = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const daysInTarget = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate()
  shifted.setDate(Math.min(day, daysInTarget))
  shifted.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds())
  return shifted
}

export function addDays(value, days) {
  const date = toDate(value)
  if (!date || !Number.isFinite(days)) return null
  const out = new Date(date.getTime())
  out.setDate(out.getDate() + Math.round(days))
  return out
}

/** Fractional months between two dates. Negative if `to` precedes `from`. */
export function monthsBetween(from, to) {
  const a = toDate(from)
  const b = toDate(to)
  if (!a || !b) return null
  return (b.getTime() - a.getTime()) / (AVG_DAYS_PER_MONTH * 24 * 60 * 60 * 1000)
}

export function daysBetween(from, to) {
  const a = toDate(from)
  const b = toDate(to)
  if (!a || !b) return null
  return (b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000)
}

/** "Mar 2024". Pinned to en-US so notes read identically everywhere. */
export function formatMonthYear(value) {
  const date = toDate(value)
  if (!date) return null
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** "Mar 3, 2024" — used in the service log table where the exact day matters. */
export function formatDay(value) {
  const date = toDate(value)
  if (!date) return null
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * A duration in words: "8 months", "2.5 years", "6 years".
 * Switches to years past 18 months, where month counts stop being readable.
 */
export function formatDuration(months) {
  if (!Number.isFinite(months)) return null
  const m = Math.abs(months)
  if (m < 1) return 'under a month'
  if (m < 1.5) return 'a month'
  if (m < 18) return `${Math.round(m)} months`
  const years = m / 12
  const rounded = Math.round(years * 10) / 10
  return `${rounded === Math.round(rounded) ? Math.round(rounded) : rounded.toFixed(1)} years`
}

/**
 * The same duration in adjective form: "12-month", "3-year", "2.5-year".
 *
 * Needed because the noun form does not survive being placed before another
 * noun — "past the 3 years limit" is wrong, "past the 3-year limit" is not.
 */
export function formatDurationAdjective(months) {
  if (!Number.isFinite(months)) return null
  const m = Math.abs(months)
  if (m < 18) return `${Math.max(1, Math.round(m))}-month`
  const rounded = Math.round((m / 12) * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}-year`
}
