import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MILES_PER_MONTH,
  STATUS,
  buildFlags,
  collectOdometerObservations,
  estimateCurrentMileage,
  estimateDrivingPace,
  formatMeasurement,
  resolveRule,
} from './flagging.js'
import { addMonths, formatDuration, toDate } from './dates.js'

const NOW = new Date(2026, 0, 15) // 15 Jan 2026, local

// Mirrors the seeded rows in supabase/schema.sql. Kept as a literal rather than
// imported so a change to the seed shows up here as a deliberate test edit.
const RULES = [
  {
    item_key: 'oil_change', display_name: 'Oil & Filter', type: 'interval', action_verb: 'changed',
    mileage_interval: 10000, time_interval_months: 12,
    yellow_mileage: 8000, yellow_months: 10, red_mileage: 10000, red_months: 12,
    unit: 'miles', sort_order: 10,
  },
  {
    item_key: 'brake_pads', display_name: 'Brake Pads', type: 'measurable',
    yellow_threshold: 5, red_threshold: 3, unit: 'mm', sort_order: 30,
  },
  {
    item_key: 'brake_rotors', display_name: 'Brake Rotors', type: 'qualitative',
    unit: 'verdict', sort_order: 40,
  },
  {
    item_key: 'tires_tread', display_name: 'Tire Tread', type: 'measurable',
    yellow_threshold: 4, red_threshold: 2, unit: '32nds of an inch', sort_order: 60,
  },
  {
    item_key: 'tires_age', display_name: 'Tire Age', type: 'interval', action_verb: 'fitted',
    mileage_interval: null, time_interval_months: 72,
    yellow_mileage: null, yellow_months: 60, red_mileage: null, red_months: 72,
    unit: 'months', sort_order: 70,
  },
  {
    item_key: 'engine_air_filter', display_name: 'Engine Air Filter', type: 'interval', action_verb: 'replaced',
    mileage_interval: 30000, time_interval_months: null,
    yellow_mileage: 25000, yellow_months: null, red_mileage: 30000, red_months: null,
    unit: 'miles', sort_order: 90,
  },
  {
    item_key: 'battery', display_name: 'Battery', type: 'interval', action_verb: 'replaced',
    mileage_interval: null, time_interval_months: 60,
    yellow_mileage: null, yellow_months: 48, red_mileage: null, red_months: 60,
    unit: 'months', sort_order: 120,
  },
  {
    item_key: 'other', display_name: 'Other Service', type: 'other', sort_order: 999,
  },
]

const ruleFor = (key) => RULES.filter((r) => r.item_key === key)

/** `monthsAgo(6)` -> a YYYY-MM-DD string six calendar months before NOW. */
function monthsAgo(n) {
  const d = addMonths(NOW, -n)
  const pad = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function record(overrides = {}) {
  return {
    vehicle_id: 'v1',
    service_date: monthsAgo(6),
    mileage_at_service: 50000,
    service_type: 'oil_change',
    measured_value: null,
    verdict: null,
    raw_notes: null,
    source: 'manual',
    ...overrides,
  }
}

const vehicle = (overrides = {}) => ({
  id: 'v1', nickname: 'The Civic', current_mileage: 0, updated_at: null, ...overrides,
})

const flagFor = (result, key) => result.flags.find((f) => f.itemKey === key)

// ---------------------------------------------------------------------------

describe('date helpers', () => {
  it('parses a Postgres date as local midnight, not UTC', () => {
    const d = toDate('2024-03-03')
    expect(d.getFullYear()).toBe(2024)
    expect(d.getMonth()).toBe(2)
    // The bug this guards against renders March 3rd as March 2nd west of GMT.
    expect(d.getDate()).toBe(3)
  })

  it('clamps day overflow when adding months', () => {
    expect(toDate(addMonths('2024-01-31', 1)).getMonth()).toBe(1)
    expect(toDate(addMonths('2024-01-31', 1)).getDate()).toBe(29) // 2024 is a leap year
    expect(toDate(addMonths('2023-01-31', 1)).getDate()).toBe(28)
  })

  it('describes durations the way a person would', () => {
    expect(formatDuration(0.5)).toBe('under a month')
    expect(formatDuration(8)).toBe('8 months')
    expect(formatDuration(30)).toBe('2.5 years')
    expect(formatDuration(72)).toBe('6 years')
  })
})

describe('driving pace', () => {
  it('assumes a default when there is nothing to measure', () => {
    const pace = estimateDrivingPace([])
    expect(pace.confidence).toBe('assumed')
    expect(pace.milesPerMonth).toBe(DEFAULT_MILES_PER_MONTH)
  })

  it('measures miles per month from two dated readings', () => {
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(12), mileage_at_service: 40000 }),
      record({ service_date: monthsAgo(0), mileage_at_service: 52000 }),
    ])
    const pace = estimateDrivingPace(obs)
    expect(pace.confidence).toBe('measured')
    expect(pace.milesPerMonth).toBeCloseTo(1000, -1)
  })

  it('rejects a span too short to mean anything', () => {
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(1), mileage_at_service: 40000 }),
      record({ service_date: monthsAgo(0), mileage_at_service: 40800 }),
    ])
    expect(estimateDrivingPace(obs).confidence).toBe('assumed')
  })

  it('does not require a minimum mileage — a barely-driven car has a real pace', () => {
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(24), mileage_at_service: 40000 }),
      record({ service_date: monthsAgo(0), mileage_at_service: 40240 }),
    ])
    const pace = estimateDrivingPace(obs)
    expect(pace.confidence).toBe('measured')
    expect(pace.milesPerMonth).toBeCloseTo(10, 0)
  })

  it('reports a genuinely stationary car as zero rather than guessing', () => {
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(18), mileage_at_service: 40000 }),
      record({ service_date: monthsAgo(0), mileage_at_service: 40000 }),
    ])
    const pace = estimateDrivingPace(obs)
    expect(pace.confidence).toBe('measured')
    expect(pace.milesPerMonth).toBe(0)
  })

  it('falls back when the odometer runs backwards', () => {
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(12), mileage_at_service: 60000 }),
      record({ service_date: monthsAgo(0), mileage_at_service: 50000 }),
    ])
    expect(estimateDrivingPace(obs).confidence).toBe('assumed')
  })

  it('prefers the recent window over long-dead history', () => {
    // Heavy commuting years ago, barely driven since. The recent pace is what
    // should drive projections.
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(60), mileage_at_service: 10000 }),
      record({ service_date: monthsAgo(24), mileage_at_service: 90000 }),
      record({ service_date: monthsAgo(0), mileage_at_service: 93600 }),
    ])
    expect(estimateDrivingPace(obs).milesPerMonth).toBeCloseTo(150, 0)
  })

  it('collapses several line items from one visit into a single reading', () => {
    const obs = collectOdometerObservations(vehicle(), [
      record({ service_date: monthsAgo(6), mileage_at_service: 50000 }),
      record({ service_date: monthsAgo(6), mileage_at_service: 50000, service_type: 'tires_tread' }),
    ])
    expect(obs).toHaveLength(1)
  })

  it('folds in a manually raised odometer that is newer than any record', () => {
    const obs = collectOdometerObservations(
      vehicle({ current_mileage: 60000, updated_at: NOW.toISOString() }),
      [record({ service_date: monthsAgo(12), mileage_at_service: 48000 })],
    )
    expect(obs).toHaveLength(2)
    expect(obs[1].mileage).toBe(60000)
  })
})

describe('current mileage projection', () => {
  it('projects forward from the newest reading at the measured pace', () => {
    const records = [
      record({ service_date: monthsAgo(18), mileage_at_service: 30000 }),
      record({ service_date: monthsAgo(6), mileage_at_service: 42000 }),
    ]
    const observations = collectOdometerObservations(vehicle(), records)
    const pace = estimateDrivingPace(observations)
    const odo = estimateCurrentMileage({ vehicle: vehicle(), observations, pace, now: NOW })
    // 1,000 mi/month for the six months since the last record.
    expect(odo.miles).toBeGreaterThan(47500)
    expect(odo.miles).toBeLessThan(48500)
  })

  it('never projects backwards past a known reading', () => {
    const observations = collectOdometerObservations(vehicle({ current_mileage: 80000 }), [])
    const pace = estimateDrivingPace(observations)
    const odo = estimateCurrentMileage({ vehicle: vehicle({ current_mileage: 80000 }), observations, pace, now: NOW })
    expect(odo.miles).toBe(80000)
  })
})

describe('interval items', () => {
  const build = (records, opts = {}) =>
    buildFlags({ vehicle: vehicle(), records, rules: RULES, now: NOW, ...opts })

  it('is green well inside both limits', () => {
    const flags = build([
      record({ service_date: monthsAgo(15), mileage_at_service: 40000 }),
      record({ service_date: monthsAgo(3), mileage_at_service: 43000 }),
    ])
    const oil = flagFor(flags, 'oil_change')
    expect(oil.status).toBe(STATUS.GREEN)
    expect(oil.reason).toMatch(/Next due/)
  })

  it('goes red on time even when the mileage is nowhere near', () => {
    const flags = build([
      record({ service_date: monthsAgo(36), mileage_at_service: 40000 }),
      record({ service_date: monthsAgo(14), mileage_at_service: 41000 }),
    ])
    const oil = flagFor(flags, 'oil_change')
    expect(oil.status).toBe(STATUS.RED)
    expect(oil.reason).toMatch(/past the .* limit/)
    // The counterpoint is the interesting half: barely driven, still overdue.
    expect(oil.detail).toMatch(/the clock got there first/)
  })

  it('goes red on mileage while still inside the time window', () => {
    // ~1,480 mi/month. Nine months since the last change puts roughly 13,000
    // miles on it — past the 10,000 limit, with the 12-month clock still running.
    const flags = build([
      record({ service_date: monthsAgo(36), mileage_at_service: 10000 }),
      record({ service_date: monthsAgo(9), mileage_at_service: 50000 }),
    ])
    const oil = flagFor(flags, 'oil_change')
    expect(oil.status).toBe(STATUS.RED)
    expect(oil.reason).toMatch(/miles since the last one/)
    expect(oil.detail).toMatch(/the miles got there first/)
  })

  it('goes yellow approaching the mileage limit and names the odometer target', () => {
    // ~1,065 mi/month over eight months lands about 8,500 miles in: past the
    // 8,000 planning line, short of the 10,000 limit.
    const flags = build([
      record({ service_date: monthsAgo(24), mileage_at_service: 28000 }),
      record({ service_date: monthsAgo(8), mileage_at_service: 45000 }),
    ])
    const oil = flagFor(flags, 'oil_change')
    expect(oil.status).toBe(STATUS.YELLOW)
    expect(oil.dueOdometer).toBe(55000)
    expect(oil.reason).toMatch(/55,000 mi/)
  })

  it('flags old tires on a barely-driven car — the case a mileage-only tracker misses', () => {
    const flags = build([
      record({ service_type: 'tires_age', service_date: monthsAgo(78), mileage_at_service: 30000 }),
      record({ service_date: monthsAgo(3), mileage_at_service: 34000 }),
    ])
    const tires = flagFor(flags, 'tires_age')
    expect(tires.status).toBe(STATUS.RED)
    expect(tires.reason).toMatch(/past the 6-year limit/)
    expect(tires.reason).toMatch(/^Last fitted/) // not "Last done"
  })

  it('treats a time-only item with no mileage relationship correctly', () => {
    const flags = build([
      record({ service_type: 'battery', service_date: monthsAgo(50), mileage_at_service: 30000 }),
    ])
    const battery = flagFor(flags, 'battery')
    expect(battery.status).toBe(STATUS.YELLOW) // past 48 months, not yet 60
    expect(battery.dueBasis).toBe('time')
  })

  it('handles a mileage-only item with no time component', () => {
    const flags = build([
      record({ service_type: 'engine_air_filter', service_date: monthsAgo(40), mileage_at_service: 20000 }),
      record({ service_date: monthsAgo(2), mileage_at_service: 52000 }),
    ])
    const filter = flagFor(flags, 'engine_air_filter')
    expect(filter.status).toBe(STATUS.RED)
    expect(filter.dueBasis).toBe('mileage')
  })

  it('reports unknown rather than red when nothing has been logged', () => {
    const flags = build([])
    const oil = flagFor(flags, 'oil_change')
    expect(oil.status).toBe(STATUS.UNKNOWN)
    expect(oil.reason).toMatch(/No oil & filter on record yet/i)
  })

  it('does not treat a future-dated typo as negative age', () => {
    const flags = build([record({ service_date: '2030-01-01', mileage_at_service: 50000 })])
    expect(flagFor(flags, 'oil_change').status).toBe(STATUS.GREEN)
  })

  it('says nothing is owing on a stationary car for a mileage-only item', () => {
    const flags = build([
      record({ service_type: 'engine_air_filter', service_date: monthsAgo(18), mileage_at_service: 40000 }),
      record({ service_type: 'engine_air_filter', service_date: monthsAgo(0), mileage_at_service: 40000 }),
    ])
    const filter = flagFor(flags, 'engine_air_filter')
    expect(filter.status).toBe(STATUS.GREEN)
    expect(filter.reason).toMatch(/while the car sits/)
  })
})

describe('measurable items', () => {
  const build = (records) =>
    buildFlags({ vehicle: vehicle(), records, rules: RULES, now: NOW })

  it('extrapolates wear forward from two readings', () => {
    // 10/32 -> 8/32 over 20,000 miles = 1/32 per 10,000 miles.
    const flags = build([
      record({ service_type: 'tires_tread', service_date: monthsAgo(30), mileage_at_service: 20000, measured_value: 10 }),
      record({ service_type: 'tires_tread', service_date: monthsAgo(6), mileage_at_service: 40000, measured_value: 8 }),
    ])
    const tread = flagFor(flags, 'tires_tread')
    expect(tread.status).toBe(STATUS.GREEN)
    // ~833 mi/month over the six months since -> roughly 5,000 more miles -> ~7.5/32
    expect(tread.estimatedValue).toBeGreaterThan(7)
    expect(tread.estimatedValue).toBeLessThan(8)
    expect(tread.reason).toMatch(/per 10,000 miles/)
  })

  it('goes red once the extrapolated value crosses the replace line', () => {
    const flags = build([
      record({ service_type: 'tires_tread', service_date: monthsAgo(36), mileage_at_service: 20000, measured_value: 6 }),
      record({ service_type: 'tires_tread', service_date: monthsAgo(6), mileage_at_service: 50000, measured_value: 2.5 }),
    ])
    const tread = flagFor(flags, 'tires_tread')
    expect(tread.status).toBe(STATUS.RED)
    expect(tread.reason).toMatch(/replace line/)
  })

  it('uses a single reading as-is instead of inventing a trend', () => {
    const flags = build([
      record({ service_type: 'brake_pads', service_date: monthsAgo(4), mileage_at_service: 50000, measured_value: 2.5 }),
    ])
    const pads = flagFor(flags, 'brake_pads')
    expect(pads.status).toBe(STATUS.RED)
    expect(pads.estimatedValue).toBe(2.5)
    expect(pads.detail).toMatch(/Only one measurement/)
  })

  it('restarts the wear rate after a replacement rather than averaging through it', () => {
    const flags = build([
      record({ service_type: 'brake_pads', service_date: monthsAgo(48), mileage_at_service: 10000, measured_value: 10 }),
      record({ service_type: 'brake_pads', service_date: monthsAgo(36), mileage_at_service: 30000, measured_value: 4 }),
      // New pads fitted.
      record({ service_type: 'brake_pads', service_date: monthsAgo(24), mileage_at_service: 40000, measured_value: 11 }),
      record({ service_type: 'brake_pads', service_date: monthsAgo(6), mileage_at_service: 55000, measured_value: 9 }),
    ])
    const pads = flagFor(flags, 'brake_pads')
    expect(pads.status).toBe(STATUS.GREEN)
    // Averaging across the replacement would have produced a nonsense rate.
    expect(pads.estimatedValue).toBeGreaterThan(7)
    expect(pads.detail).toMatch(/most recent replacement/)
  })

  it('reports unknown when nothing was ever measured', () => {
    expect(flagFor(build([]), 'tires_tread').status).toBe(STATUS.UNKNOWN)
  })

  it('formats measurements in the unit a person would say', () => {
    expect(formatMeasurement(4, '32nds of an inch')).toBe('4/32"')
    expect(formatMeasurement(5.5, 'mm')).toBe('5.5mm')
  })
})

describe('qualitative items', () => {
  const build = (records) =>
    buildFlags({ vehicle: vehicle(), records, rules: RULES, now: NOW })

  it('maps the shop verdict straight through', () => {
    const flags = build([
      record({ service_type: 'brake_rotors', service_date: monthsAgo(3), mileage_at_service: 50000, verdict: 'below_minimum' }),
    ])
    expect(flagFor(flags, 'brake_rotors').status).toBe(STATUS.RED)
  })

  it('is green on a recent clean verdict', () => {
    const flags = build([
      record({ service_type: 'brake_rotors', service_date: monthsAgo(4), mileage_at_service: 50000, verdict: 'within_spec' }),
    ])
    expect(flagFor(flags, 'brake_rotors').status).toBe(STATUS.GREEN)
  })

  it('stops trusting a clean verdict once it is stale', () => {
    const flags = build([
      record({ service_type: 'brake_rotors', service_date: monthsAgo(40), mileage_at_service: 50000, verdict: 'within_spec' }),
    ])
    const rotors = flagFor(flags, 'brake_rotors')
    expect(rotors.status).toBe(STATUS.YELLOW)
    expect(rotors.reason).toMatch(/within spec then/)
  })

  it('reports unknown with no verdict on file', () => {
    expect(flagFor(build([]), 'brake_rotors').status).toBe(STATUS.UNKNOWN)
  })
})

describe('per-vehicle overrides', () => {
  it('applies a shorter interval without touching the shared rule', () => {
    const base = ruleFor('oil_change')[0]
    const merged = resolveRule(base, { item_key: 'oil_change', red_mileage: 5000, yellow_mileage: 4000 })
    expect(merged.red_mileage).toBe(5000)
    expect(merged.red_months).toBe(12) // untouched
    expect(base.red_mileage).toBe(10000) // the shared rule is not mutated
  })

  it('changes the verdict for a conventional-oil car', () => {
    // ~6,000 miles since the last change: fine on a 10,000-mile synthetic
    // interval, overdue on the 5,000-mile one conventional oil calls for.
    const records = [
      record({ service_date: monthsAgo(33), mileage_at_service: 28000 }),
      record({ service_date: monthsAgo(9), mileage_at_service: 44000 }),
    ]
    const args = { vehicle: vehicle(), records, rules: RULES, now: NOW }

    expect(flagFor(buildFlags(args), 'oil_change').status).toBe(STATUS.GREEN)

    const stricter = buildFlags({
      ...args,
      overrides: [{ item_key: 'oil_change', yellow_mileage: 4000, red_mileage: 5000 }],
    })
    expect(flagFor(stricter, 'oil_change').status).toBe(STATUS.RED)
  })

  it('removes a disabled item from the list entirely', () => {
    const result = buildFlags({
      vehicle: vehicle(), records: [], rules: RULES, now: NOW,
      overrides: [{ item_key: 'battery', enabled: false }],
    })
    expect(flagFor(result, 'battery')).toBeUndefined()
  })
})

describe('the list as a whole', () => {
  const result = () =>
    buildFlags({
      vehicle: vehicle(),
      rules: RULES,
      now: NOW,
      records: [
        record({ service_date: monthsAgo(30), mileage_at_service: 20000 }),
        record({ service_date: monthsAgo(14), mileage_at_service: 50000 }), // oil: red
        record({ service_type: 'battery', service_date: monthsAgo(50), mileage_at_service: 40000 }), // yellow
        record({ service_type: 'brake_rotors', service_date: monthsAgo(2), mileage_at_service: 51000, verdict: 'within_spec' }), // green
      ],
    })

  it('sorts red, then yellow, then green, then unknown', () => {
    const order = result().flags.map((f) => f.status)
    const rank = { red: 0, yellow: 1, green: 2, unknown: 3 }
    const ranks = order.map((s) => rank[s])
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('never flags the catch-all "other" bucket', () => {
    expect(flagFor(result(), 'other')).toBeUndefined()
  })

  it('summarises the counts for the garage view', () => {
    const { summary } = result()
    expect(summary.red).toBeGreaterThanOrEqual(1)
    expect(summary.red + summary.yellow + summary.green + summary.unknown).toBe(
      RULES.filter((r) => r.type !== 'other').length,
    )
  })

  it('warns when a projection rests on an assumed pace', () => {
    const single = buildFlags({
      vehicle: vehicle(),
      rules: RULES,
      now: NOW,
      records: [record({ service_date: monthsAgo(2), mileage_at_service: 50000 })],
    })
    expect(single.pace.confidence).toBe('assumed')
    expect(flagFor(single, 'oil_change').detail).toMatch(/Assumes 1,000 mi\/month/)
  })
})
