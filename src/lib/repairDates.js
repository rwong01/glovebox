/**
 * Recovers service dates from records that were saved before the date parsing
 * was fixed.
 *
 * No re-scanning and no API calls: `raw_notes` holds the full transcription of
 * every page, so the date is already in the database. It was lost on the way
 * in — either dropped by a validator that accepted only perfectly zero-padded
 * ISO, or replaced with the day of the scan because the column used to be NOT
 * NULL. The second is the damaging one: a 2019 oil change dated to the day you
 * scanned it silently distorts the driving pace every projection rests on.
 *
 * Pure, so the rules can be tested and so the UI can show exactly what would
 * change before anything is written.
 */
import { findDatesInText } from './receiptDate.js'

/** A date within a day of the scan is the substitution, not a coincidence. */
const SUBSTITUTION_TOLERANCE_DAYS = 1

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Why a record is a candidate for repair.
 *
 * `substituted` — the stored date is the day it was scanned. Nobody scans a
 *                 backlog the day the work was done, so this is the old NOT
 *                 NULL fallback showing through.
 * `missing`     — no date at all, but the transcription contains one.
 */
export const REPAIR_REASONS = {
  SUBSTITUTED: 'substituted',
  MISSING: 'missing',
}

function utcDatePart(timestamp) {
  if (typeof timestamp !== 'string') return null
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(timestamp)
  return match ? match[1] : null
}

function daysApart(a, b) {
  if (!a || !b) return null
  return Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / DAY_MS
}

/**
 * Works out what should change, without changing anything.
 *
 * @param {object[]} records rows from `service_records`
 * @returns {{id: string, from: string|null, to: string, reason: string, record: object}[]}
 */
export function proposeDateRepairs(records = []) {
  const proposals = []

  for (const record of records) {
    // Only scanned records. A date typed in by hand is the user's own claim and
    // is never second-guessed.
    if (record?.source !== 'ocr') continue

    const scannedOn = utcDatePart(record.created_at)
    const stored = record.service_date ?? null

    let reason = null
    if (stored == null) {
      reason = REPAIR_REASONS.MISSING
    } else {
      const gap = daysApart(stored, scannedOn)
      if (gap != null && gap <= SUBSTITUTION_TOLERANCE_DAYS) reason = REPAIR_REASONS.SUBSTITUTED
    }
    if (!reason) continue

    // The first date in a transcription is nearly always the invoice date; it
    // is printed in the header, above everything else on the page.
    const [recovered] = findDatesInText(record.raw_notes)
    if (!recovered) continue

    // Recovering the same value is not a repair.
    if (recovered === stored) continue

    proposals.push({ id: record.id, from: stored, to: recovered, reason, record })
  }

  return proposals
}

/**
 * Rolls proposals up for display, so a 200-record repair reads as a handful of
 * visits rather than a wall of rows.
 */
export function summariseRepairs(proposals = []) {
  const byChange = new Map()

  for (const proposal of proposals) {
    const key = `${proposal.from ?? 'none'}→${proposal.to}`
    const entry = byChange.get(key) ?? {
      from: proposal.from,
      to: proposal.to,
      reason: proposal.reason,
      count: 0,
      vendor: proposal.record?.vendor ?? null,
      mileage: proposal.record?.mileage_at_service ?? null,
    }
    entry.count += 1
    byChange.set(key, entry)
  }

  return [...byChange.values()].sort((a, b) => String(b.to).localeCompare(String(a.to)))
}
