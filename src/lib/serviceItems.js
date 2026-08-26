/**
 * Canonical service item keys and measurement handling.
 *
 * The database is the source of truth for the rules themselves — this module
 * only holds what both the browser and the serverless functions need to agree
 * on before a rule row is in hand: which keys exist, and what unit each
 * measurable item is stored in.
 */

/**
 * Fallback list, used when the caller does not supply the keys it loaded from
 * `service_rules`. Kept in sync with the seed in supabase/schema.sql — with
 * one deliberate exception: `odometer_reading` is a manual-only log entry, not
 * something a receipt line item should ever be mapped to, so it is left out
 * of both this list and the live item keys passed to the vision model.
 */
export const DEFAULT_ITEM_KEYS = [
  'oil_change',
  'transmission_fluid',
  'brake_pads_front',
  'brake_pads_rear',
  'brake_rotors_front',
  'brake_rotors_rear',
  'brake_fluid',
  'tires_tread_front',
  'tires_tread_rear',
  'tires_age_front',
  'tires_age_rear',
  'cabin_air_filter',
  'engine_air_filter',
  'coolant',
  'spark_plugs',
  'battery',
  'other',
]

/** The unit each measurable item is stored in. Everything else converts to this. */
export const CANONICAL_UNITS = {
  tires_tread_front: '32nds',
  tires_tread_rear: '32nds',
  brake_pads_front: 'mm',
  brake_pads_rear: 'mm',
}

/**
 * Front and rear wear at different rates and can be serviced independently —
 * one axle at a time — so each is tracked and flagged as its own item rather
 * than one merged reading that can't say which end of the car it means.
 */
export const BRAKE_PAD_KEYS = ['brake_pads_front', 'brake_pads_rear']

/** Same split as BRAKE_PAD_KEYS, for the qualitative rotor verdict. */
export const BRAKE_ROTOR_KEYS = ['brake_rotors_front', 'brake_rotors_rear']

const MM_PER_32ND = 25.4 / 32 // 0.79375

/** Applies to both units: 40mm and 40/32" are each far past anything real. */
const MAX_PLAUSIBLE_READING = 40

/**
 * Normalises a measurement to the unit the item is stored in.
 *
 * Shops are inconsistent: tread turns up as "8/32", "6.4mm" or "0.25in", and
 * pad thickness as either millimetres or 32nds. Rather than asking the vision
 * model to do arithmetic — which is where models reliably slip — it reports the
 * number as printed plus which unit it read, and the conversion happens here.
 *
 * @returns {number|null} value in the item's canonical unit
 */
export function toCanonicalMeasurement(value, unit, itemKey) {
  const target = CANONICAL_UNITS[itemKey]
  const n = parseMeasurementValue(value)
  if (target == null || n == null) return null

  const from = normaliseUnit(unit) ?? target

  const inMillimetres =
    from === 'mm' ? n : from === 'in' ? n * 25.4 : from === '32nds' ? n * MM_PER_32ND : null

  if (inMillimetres == null) return null
  const out = target === 'mm' ? inMillimetres : inMillimetres / MM_PER_32ND

  // Guard against a misread. A negative reading is not a reading, and the upper
  // bound sits well above anything real in either unit: new pads are ~12mm, new
  // tread is ~11/32. Anything past this came from a mangled digit.
  if (!Number.isFinite(out) || out < 0 || out > MAX_PLAUSIBLE_READING) return null
  return Math.round(out * 100) / 100
}

function normaliseUnit(unit) {
  if (!unit) return null
  const u = String(unit).toLowerCase().trim()
  if (u.includes('32')) return '32nds'
  if (u.startsWith('mm') || u.includes('milli')) return 'mm'
  if (u === 'in' || u.includes('inch')) return 'in'
  return null
}

/** Accepts 8, "8", "8/32", "8.5 mm" — anything a receipt might read as. */
export function parseMeasurementValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null

  const fraction = /^\s*(\d+(?:\.\d+)?)\s*\/\s*32/.exec(value)
  if (fraction) return Number(fraction[1])

  const plain = /-?\d+(?:\.\d+)?/.exec(value)
  return plain ? Number(plain[0]) : null
}

export const VERDICTS = ['within_spec', 'near_minimum', 'below_minimum']
