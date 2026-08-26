/**
 * Coercion that treats "not recorded" as absent rather than as zero.
 *
 * `Number(null)` is 0 and `Number('')` is 0, and `Number.isFinite(0)` is true,
 * so the obvious `Number.isFinite(Number(x))` guard silently accepts an empty
 * field as a real reading of zero. That has cost this project three separate
 * bugs — a brake inspection with no thickness written down read as 0mm and
 * flagged red, a service with no odometer read as "done at 0 miles" and also
 * flagged red, and a visit with no odometer displayed as "0 mi".
 *
 * Blank means blank. Somewhere further along, code should look back to the last
 * record that actually carries a number instead of inventing one here.
 */
export function numberOrNull(value) {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
