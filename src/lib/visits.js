/**
 * Rolls service records up into visits.
 *
 * A record is one line item, because that is what the flagging engine needs to
 * answer "when was the oil last done". A person reading their history thinks in
 * visits: one trip to the shop where four things were done. A dozen visits over
 * six years can easily be two hundred records, and listing those flat buries
 * the shape of the history entirely.
 *
 * Pure, so the grouping rules can be tested without a database.
 */
import { toDate } from './dates.js'

/**
 * @param {object[]} records rows from `service_records`
 * @returns {object[]} visits, newest first
 */
export function groupIntoVisits(records = []) {
  const byKey = new Map()

  // A continuation page has no date or odometer of its own, so the natural key
  // cannot place it. Its receipt_group can: map each group to the natural key
  // of whichever page in it did carry a header, and the orphan joins that visit
  // rather than becoming one.
  const groupToNaturalKey = new Map()
  for (const record of records) {
    if (!record?.receipt_group) continue
    if (record.service_date == null || record.mileage_at_service == null) continue
    if (!groupToNaturalKey.has(record.receipt_group)) {
      groupToNaturalKey.set(record.receipt_group, naturalKey(record))
    }
  }

  for (const record of records) {
    const key = visitKey(record, groupToNaturalKey)
    let visit = byKey.get(key)

    if (!visit) {
      visit = {
        key,
        date: record.service_date ?? null,
        mileage: numberOrNull(record.mileage_at_service),
        vendor: record.vendor ?? null,
        records: [],
        cost: null,
        source: record.source ?? 'manual',
      }
      byKey.set(key, visit)
    }

    // A visit's header comes from whichever of its records actually has one:
    // a continuation page may carry line items and nothing else.
    visit.date ??= record.service_date ?? null
    visit.mileage ??= numberOrNull(record.mileage_at_service)
    visit.vendor ??= record.vendor ?? null

    const cost = numberOrNull(record.cost)
    if (cost != null) visit.cost = (visit.cost ?? 0) + cost

    visit.records.push(record)
  }

  const visits = [...byKey.values()]

  for (const visit of visits) {
    // Within a visit, order by how the rules are ordered elsewhere so the same
    // item always appears in the same place.
    visit.records.sort((a, b) =>
      String(a.service_type).localeCompare(String(b.service_type)),
    )
  }

  // Newest first. Undated visits sort to the end rather than to 1970, since an
  // undated record is of unknown age, not ancient.
  return visits.sort((a, b) => {
    const at = toDate(a.date)?.getTime()
    const bt = toDate(b.date)?.getTime()
    if (at != null && bt != null && at !== bt) return bt - at
    if (at != null && bt == null) return -1
    if (at == null && bt != null) return 1
    // Same date, or neither dated: higher odometer is the later visit.
    return (b.mileage ?? -1) - (a.mileage ?? -1)
  })
}

/**
 * What makes two records the same visit.
 *
 * The natural key — date, odometer, shop — wins wherever both a date and an
 * odometer are known, because it is simply true: you cannot be at one shop
 * twice on the same day at the same mileage. It also needs no migration, which
 * matters for records scanned one page at a time before pages were grouped;
 * each of those got its own `receipt_group` and would otherwise show as a
 * separate visit forever.
 *
 * `receipt_group` is the fallback for records the natural key cannot place — a
 * continuation page with no date and no odometer of its own. That is exactly
 * what the group id is for.
 */
function naturalKey(record) {
  return [
    'k',
    record.service_date ?? '',
    record.mileage_at_service ?? '',
    (record.vendor ?? '').trim().toLowerCase(),
  ].join('|')
}

function visitKey(record, groupToNaturalKey) {
  // Enough on the record itself to place it.
  if (record.service_date != null && record.mileage_at_service != null) {
    return naturalKey(record)
  }

  // Otherwise borrow the key of the header page it was scanned with.
  if (record.receipt_group) {
    return groupToNaturalKey.get(record.receipt_group) ?? `g:${record.receipt_group}`
  }

  return naturalKey(record)
}

function numberOrNull(value) {
  // `Number(null)` is 0 and `Number('')` is 0, so the empty cases have to be
  // rejected before coercion — otherwise a visit with no odometer reads "0 mi"
  // and a visit with no priced line reads "$0.00".
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
