/**
 * Rolls service records up into visits.
 *
 * A record is one line item, because that is what the flagging engine needs to
 * answer "when was the oil last done". A person reading their history thinks in
 * visits: one trip to the shop where four things were done. A dozen visits over
 * six years can easily be two hundred records, and listing those flat buries
 * the shape of the history entirely.
 *
 * Pure, so the grouping and de-duplication rules can be tested without a
 * database — and so both apply to records already stored, with no migration.
 */
import { toDate } from './dates.js'

/**
 * @param {object[]} records rows from `service_records`
 * @returns {object[]} visits, newest first
 */
export function groupIntoVisits(records = []) {
  const byKey = new Map()

  // A continuation page has no date of its own, so the natural key cannot place
  // it. Its receipt_group can: map each group to the key of whichever page in
  // it did carry a header, and the orphan joins that visit rather than becoming
  // one of its own.
  const groupToKey = new Map()
  for (const record of records) {
    if (!record?.receipt_group || record.service_date == null) continue
    if (!groupToKey.has(record.receipt_group)) {
      groupToKey.set(record.receipt_group, naturalKey(record))
    }
  }

  for (const record of records) {
    const key = visitKey(record, groupToKey)
    let visit = byKey.get(key)

    if (!visit) {
      visit = {
        key,
        date: record.service_date ?? null,
        mileage: null,
        vendor: record.vendor ?? null,
        records: [],
        duplicates: [],
        cost: null,
        source: record.source ?? 'manual',
      }
      byKey.set(key, visit)
    }

    // A visit's header comes from whichever of its records actually has one:
    // a continuation page may carry line items and nothing else.
    visit.date ??= record.service_date ?? null
    visit.vendor ??= record.vendor ?? null

    // Pages of one invoice can disagree on the odometer by a misread digit.
    // The highest reading is the safest single answer — the ratchet elsewhere
    // works the same way.
    const mileage = numberOrNull(record.mileage_at_service)
    if (mileage != null) visit.mileage = Math.max(visit.mileage ?? 0, mileage)

    visit.records.push(record)
  }

  const visits = absorbUndatedVendors([...byKey.values()])

  for (const visit of visits) {
    const { kept, duplicates } = dedupeRecords(visit.records)
    visit.records = kept
    visit.duplicates = duplicates

    // Total from the kept rows only. Summing before de-duplication would count
    // a line printed on both a detail page and a summary page twice.
    visit.cost = kept.reduce((total, record) => {
      const cost = numberOrNull(record.cost)
      return cost == null ? total : (total ?? 0) + cost
    }, null)

    // Within a visit, a stable order so the same item is always in the same place.
    visit.records.sort((a, b) => String(a.service_type).localeCompare(String(b.service_type)))
  }

  // Newest first. Undated visits sort to the end rather than to 1970, since an
  // undated record is of unknown age, not ancient.
  return visits.sort((a, b) => {
    const at = toDate(a.date)?.getTime()
    const bt = toDate(b.date)?.getTime()
    if (at != null && bt != null && at !== bt) return bt - at
    if (at != null && bt == null) return -1
    if (at == null && bt != null) return 1
    return (b.mileage ?? -1) - (a.mileage ?? -1)
  })
}

/**
 * What makes two records the same visit: the same day at the same shop.
 *
 * Deliberately NOT the odometer. Pages of one invoice regularly disagree on it
 * by a misread digit, and splitting a visit over that would be exactly the
 * wrong call — you cannot be at one shop twice in one day.
 *
 * `receipt_group` is the fallback for a page with no date of its own, which is
 * precisely what a group id is for.
 */
function naturalKey(record) {
  return ['k', record.service_date ?? '', normaliseVendor(record.vendor)].join('|')
}

function visitKey(record, groupToKey) {
  if (record.service_date != null) return naturalKey(record)
  if (record.receipt_group) return groupToKey.get(record.receipt_group) ?? `g:${record.receipt_group}`
  return naturalKey(record)
}

/**
 * Folds a same-day visit with no shop name into the named one from that day.
 *
 * A page whose header was cropped or unreadable produces a vendorless record.
 * Where exactly one named visit exists that day it plainly belongs there; where
 * there are two, there is no way to tell which, so it stays on its own.
 */
function absorbUndatedVendors(visits) {
  const byDate = new Map()
  for (const visit of visits) {
    if (!visit.date) continue
    const list = byDate.get(visit.date) ?? []
    list.push(visit)
    byDate.set(visit.date, list)
  }

  const absorbed = new Set()
  for (const list of byDate.values()) {
    const named = list.filter((v) => v.vendor)
    const unnamed = list.filter((v) => !v.vendor)
    if (named.length !== 1 || unnamed.length === 0) continue

    const target = named[0]
    for (const orphan of unnamed) {
      target.records.push(...orphan.records)
      if (orphan.mileage != null) target.mileage = Math.max(target.mileage ?? 0, orphan.mileage)
      absorbed.add(orphan)
    }
  }

  return visits.filter((visit) => !absorbed.has(visit))
}

/**
 * Removes line items the same visit states more than once.
 *
 * A multi-page invoice often repeats itself: a summary page lists what the
 * detail pages already itemised, so the same work arrives twice. The rules:
 *
 *   - A tracked item appears at most once per visit. "The oil was changed on
 *     this visit" is a single fact; a second oil_change row is a repeat, not a
 *     second oil change. Front and rear are separate keys, so an axle split is
 *     unaffected.
 *   - Catch-all rows are compared on their printed wording, since a visit
 *     genuinely can have several. Two rows reading the same but carrying
 *     DIFFERENT non-null costs are two real lines, not a repeat.
 *
 * The surviving copy is whichever carries more information, so a page with the
 * measurement wins over one with just the label.
 */
export function dedupeRecords(records = []) {
  const kept = []
  const duplicates = []

  for (const record of records) {
    const match = kept.findIndex((existing) => isSameLineItem(existing, record))
    if (match === -1) {
      kept.push(record)
      continue
    }
    if (informationScore(record) > informationScore(kept[match])) {
      duplicates.push(kept[match])
      kept[match] = record
    } else {
      duplicates.push(record)
    }
  }

  return { kept, duplicates }
}

function isSameLineItem(a, b) {
  if (a.service_type !== b.service_type) return false

  // Every tracked item is once-per-visit by definition.
  if (a.service_type !== 'other') return true

  if (normaliseText(a.service_type_raw) !== normaliseText(b.service_type_raw)) return false

  // Same wording but two different prices means two real lines.
  const aCost = numberOrNull(a.cost)
  const bCost = numberOrNull(b.cost)
  if (aCost != null && bCost != null && aCost !== bCost) return false

  return true
}

/** How much a row actually tells us, used to pick which copy survives. */
function informationScore(record) {
  return (
    (record.cost != null ? 1 : 0) +
    (record.measured_value != null ? 1 : 0) +
    (record.verdict ? 1 : 0) +
    (record.service_type_raw ? 1 : 0) +
    (record.service_date ? 1 : 0) +
    (record.mileage_at_service != null ? 1 : 0)
  )
}

/**
 * The visit a given record belongs to, with all of its siblings.
 *
 * Used when editing one line item, so a change to a field the whole visit
 * shares — the date, the odometer, the shop — can be applied to the visit
 * rather than to one row, which would silently split it off into its own.
 */
export function findVisitFor(records = [], recordId) {
  if (!recordId) return null
  return (
    groupIntoVisits(records).find((visit) =>
      visit.records.concat(visit.duplicates).some((r) => r.id === recordId),
    ) ?? null
  )
}

function normaliseVendor(vendor) {
  return (vendor ?? '').trim().toLowerCase()
}

function normaliseText(value) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function numberOrNull(value) {
  // `Number(null)` is 0 and `Number('')` is 0, so the empty cases have to be
  // rejected before coercion. Letting them through made an absent odometer read
  // as 0 mi, and made an absent cost look like a different price to a real one.
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
