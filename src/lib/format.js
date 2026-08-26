import { numberOrNull } from './num.js'

const miles = new Intl.NumberFormat('en-US')
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatMiles(value) {
  // null must come back as null, not "0" — an absent odometer is not zero miles.
  const n = numberOrNull(value)
  return n == null ? null : miles.format(Math.round(n))
}

export function formatCurrency(value) {
  const n = numberOrNull(value)
  return n == null ? null : currency.format(n)
}

/** "84,210 mi" — the odometer as it appears everywhere in the UI. */
export function formatOdometer(value) {
  const n = formatMiles(value)
  return n == null ? null : `${n} mi`
}

export function titleCase(value) {
  if (!value) return ''
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
