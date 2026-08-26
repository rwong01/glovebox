/**
 * Reads the date off a service receipt.
 *
 * Shops print dates every way there is — 03/04/24, 2024-3-4, MAR 04 2024,
 * 4 March 2024 — and a vision model asked for ISO will mostly, but not always,
 * comply. A validator that accepts only a perfectly zero-padded YYYY-MM-DD
 * therefore throws away a large share of the dates it is handed, silently, and
 * every undated record it creates is one the flagging engine cannot use.
 *
 * So: accept what receipts actually look like, and normalise here.
 *
 * Pure, with `today` injected, so the two-digit-year and future-date rules can
 * be tested without waiting for the calendar.
 */

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/** No car has a service history from before this. */
const EARLIEST_YEAR = 1950

/**
 * Ambiguity policy for a bare numeric date.
 *
 * `03/04/2024` is March 4th in the US and April 3rd nearly everywhere else,
 * and nothing on the page settles it. Where one component is above 12 the
 * order is determined; where neither is, this decides. US ordering, because
 * that is where the odometers are in miles.
 */
const AMBIGUOUS_ORDER = 'month-first'

const pad = (n) => String(n).padStart(2, '0')

/** True if y/m/d is a real calendar date, not the 31st of February. */
function isRealDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const probe = new Date(y, m - 1, d)
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
}

/**
 * Expands a two-digit year. `24` is 2024 and `98` is 1998 — the split point
 * moves with the clock rather than sitting at a hardcoded pivot.
 */
function expandYear(value, today) {
  if (value >= 100) return value
  const currentTwoDigit = today.getFullYear() % 100
  const century = Math.floor(today.getFullYear() / 100) * 100
  // Allow next year, since an invoice can be dated slightly ahead.
  return value <= currentTwoDigit + 1 ? century + value : century - 100 + value
}

function build(y, m, d, today) {
  if (!isRealDate(y, m, d)) return null
  if (y < EARLIEST_YEAR) return null
  // A service record cannot be from the future; a year's grace covers clock
  // skew and an invoice dated a day ahead.
  if (y > today.getFullYear() + 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Parses one date string into `YYYY-MM-DD`, or null.
 *
 * @param {string} value
 * @param {{today?: Date}} [options]
 */
export function parseReceiptDate(value, { today = new Date() } = {}) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  // Year first: 2024-03-04, 2024/3/4
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text)
  if (iso) {
    return build(Number(iso[1]), Number(iso[2]), Number(iso[3]), today)
  }

  // Month name anywhere: Mar 4 2024, March 4th, 2024, 4 Mar 2024
  const named = matchNamedMonth(text, today)
  if (named) return named

  // All numeric: 03/04/2024, 3-4-24
  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(text)
  if (numeric) {
    const a = Number(numeric[1])
    const b = Number(numeric[2])
    const year = expandYear(Number(numeric[3]), today)

    // One component above 12 can only be the day, which settles the order.
    if (a > 12 && b <= 12) return build(year, b, a, today)
    if (b > 12 && a <= 12) return build(year, a, b, today)
    return AMBIGUOUS_ORDER === 'month-first'
      ? build(year, a, b, today)
      : build(year, b, a, today)
  }

  return null
}

function matchNamedMonth(text, today) {
  // "Mar 4, 2024" / "March 4th 2024"
  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/.exec(text)
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()]
    if (month) {
      return build(expandYear(Number(monthFirst[3]), today), month, Number(monthFirst[2]), today)
    }
  }

  // "4 Mar 2024" / "4th March, 2024"
  const dayFirst = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{2,4})$/.exec(text)
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()]
    if (month) {
      return build(expandYear(Number(dayFirst[3]), today), month, Number(dayFirst[1]), today)
    }
  }

  return null
}

/**
 * Every plausible date in a block of text, in the order it appears.
 *
 * Used as a last resort when the structured extraction came back without one:
 * the transcription is already stored, so the date is usually right there in
 * it. The first date on a service invoice is almost always the invoice date,
 * printed in the header.
 */
export function findDatesInText(text) {
  if (typeof text !== 'string' || !text) return []

  const patterns = [
    /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g,
    /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
    /\b[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/g,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{2,4}\b/g,
  ]

  const found = []
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.push({ index: match.index, raw: match[0] })
    }
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map((entry) => parseReceiptDate(entry.raw))
    .filter(Boolean)
}

/**
 * Best available service date, trying each source in descending order of trust.
 *
 * 1. What the model resolved to ISO.
 * 2. What the model transcribed verbatim off the page — reparsed here, which
 *    catches the cases where it read the date correctly but formatted it
 *    however the receipt did.
 * 3. The first date in the full transcription.
 *
 * @returns {{date: string|null, source: 'model'|'raw'|'text'|null}}
 */
export function resolveServiceDate({ isoValue, rawValue, fullText }, { today = new Date() } = {}) {
  const fromModel = parseReceiptDate(isoValue, { today })
  if (fromModel) return { date: fromModel, source: 'model' }

  const fromRaw = parseReceiptDate(rawValue, { today })
  if (fromRaw) return { date: fromRaw, source: 'raw' }

  const [fromText] = findDatesInText(fullText)
  if (fromText) return { date: fromText, source: 'text' }

  return { date: null, source: null }
}
