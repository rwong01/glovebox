const miles = new Intl.NumberFormat('en-US')
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatMiles(value) {
  return Number.isFinite(Number(value)) ? miles.format(Math.round(Number(value))) : null
}

export function formatCurrency(value) {
  return Number.isFinite(Number(value)) ? currency.format(Number(value)) : null
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
