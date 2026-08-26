import { describe, expect, it } from 'vitest'

import { dedupeRecords, findVisitFor, groupIntoVisits } from './visits.js'

let seq = 0
const record = (overrides = {}) => ({
  id: `r${++seq}`,
  service_date: '2024-03-03',
  mileage_at_service: 84210,
  vendor: "Dave's Auto",
  service_type: 'oil_change',
  service_type_raw: null,
  cost: null,
  measured_value: null,
  verdict: null,
  receipt_group: null,
  source: 'ocr',
  ...overrides,
})

describe('grouping records into visits', () => {
  it('collapses the line items of one trip into a single visit', () => {
    const visits = groupIntoVisits([
      record({ service_type: 'oil_change', cost: 89.5 }),
      record({ service_type: 'brake_fluid', cost: 129 }),
      record({ service_type: 'cabin_air_filter', cost: 45 }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].records).toHaveLength(3)
    expect(visits[0].cost).toBe(263.5)
  })

  it('keeps separate trips separate', () => {
    expect(
      groupIntoVisits([
        record({ service_date: '2024-03-03' }),
        record({ service_date: '2025-01-09', service_type: 'brake_fluid' }),
      ]),
    ).toHaveLength(2)
  })

  it('separates same-day visits to different shops', () => {
    expect(
      groupIntoVisits([
        record({ vendor: "Dave's Auto" }),
        record({ vendor: 'Tire Barn', service_type: 'tires_age_front' }),
      ]),
    ).toHaveLength(2)
  })

  it('merges pages that disagree on the odometer by a misread digit', () => {
    // Same day, same shop — it cannot be two visits. The higher reading wins.
    const visits = groupIntoVisits([
      record({ mileage_at_service: 84210 }),
      record({ mileage_at_service: 84270, service_type: 'brake_fluid' }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].mileage).toBe(84270)
  })

  it('attaches a page with no date of its own via its receipt group', () => {
    const visits = groupIntoVisits([
      record({ receipt_group: 'abc' }),
      record({
        receipt_group: 'abc',
        service_date: null,
        mileage_at_service: null,
        vendor: null,
        service_type: 'brake_fluid',
      }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].date).toBe('2024-03-03')
  })

  it('merges pages scanned before grouping existed, without a migration', () => {
    // Each page got its own receipt_group back then.
    const visits = groupIntoVisits([
      record({ receipt_group: 'one', service_type: 'oil_change' }),
      record({ receipt_group: 'two', service_type: 'brake_fluid' }),
      record({ receipt_group: 'three', service_type: 'coolant' }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].records).toHaveLength(3)
  })

  it('folds a page whose shop name was cropped into that day\'s named visit', () => {
    const visits = groupIntoVisits([
      record({ vendor: "Dave's Auto" }),
      record({ vendor: null, service_type: 'brake_fluid' }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].vendor).toBe("Dave's Auto")
  })

  it('leaves a nameless page alone when two shops were visited that day', () => {
    // No way to tell which one it belongs to, so guessing would be wrong.
    const visits = groupIntoVisits([
      record({ vendor: "Dave's Auto" }),
      record({ vendor: 'Tire Barn', service_type: 'tires_age_front' }),
      record({ vendor: null, service_type: 'brake_fluid' }),
    ])

    expect(visits).toHaveLength(3)
  })

  it('sorts newest first, with undated visits last', () => {
    const visits = groupIntoVisits([
      record({ service_date: '2024-03-03' }),
      record({ service_date: null, receipt_group: null, service_type: 'coolant' }),
      record({ service_date: '2025-01-09', service_type: 'brake_fluid' }),
    ])
    expect(visits.map((v) => v.date)).toEqual(['2025-01-09', '2024-03-03', null])
  })
})

describe('de-duplicating repeated line items', () => {
  it('keeps one row when a summary page repeats a detail page', () => {
    const visits = groupIntoVisits([
      record({ service_type: 'oil_change', cost: 89.5 }),
      record({ service_type: 'oil_change' }), // same work, restated
    ])

    expect(visits[0].records).toHaveLength(1)
    expect(visits[0].duplicates).toHaveLength(1)
    // And the total is not double counted.
    expect(visits[0].cost).toBe(89.5)
  })

  it('keeps whichever copy carries more information', () => {
    const visits = groupIntoVisits([
      record({ service_type: 'tires_tread_front' }),
      record({ service_type: 'tires_tread_front', measured_value: 6, cost: 20 }),
    ])

    expect(visits[0].records).toHaveLength(1)
    expect(visits[0].records[0].measured_value).toBe(6)
  })

  it('does not merge different tracked items', () => {
    const visits = groupIntoVisits([
      record({ service_type: 'brake_pads_front', measured_value: 6 }),
      record({ service_type: 'brake_pads_rear', measured_value: 8 }),
    ])
    expect(visits[0].records).toHaveLength(2)
  })

  it('compares catch-all rows on their wording, since a visit can have several', () => {
    const visits = groupIntoVisits([
      record({ service_type: 'other', service_type_raw: 'Wiper blades', cost: 24 }),
      record({ service_type: 'other', service_type_raw: 'Tire rotation', cost: 25 }),
      record({ service_type: 'other', service_type_raw: 'wiper blades' }), // restated
    ])

    expect(visits[0].records).toHaveLength(2)
    expect(visits[0].cost).toBe(49)
  })

  it('keeps two identically-worded rows that carry different prices', () => {
    // Two real labour lines, not one printed twice.
    const visits = groupIntoVisits([
      record({ service_type: 'other', service_type_raw: 'Labor', cost: 120 }),
      record({ service_type: 'other', service_type_raw: 'Labor', cost: 60 }),
    ])

    expect(visits[0].records).toHaveLength(2)
    expect(visits[0].cost).toBe(180)
  })

  it('is available on its own for reuse', () => {
    const { kept, duplicates } = dedupeRecords([
      record({ service_type: 'coolant' }),
      record({ service_type: 'coolant' }),
    ])
    expect(kept).toHaveLength(1)
    expect(duplicates).toHaveLength(1)
  })
})

describe('finding the visit a record belongs to', () => {
  it('returns the visit and all of its siblings', () => {
    const target = record({ service_type: 'brake_fluid' })
    const visit = findVisitFor([record({ service_type: 'oil_change' }), target], target.id)

    expect(visit.records).toHaveLength(2)
    expect(visit.date).toBe('2024-03-03')
  })

  it('finds a record even when it was de-duplicated out of view', () => {
    const dupe = record({ service_type: 'oil_change' })
    const visit = findVisitFor([record({ service_type: 'oil_change', cost: 89.5 }), dupe], dupe.id)
    expect(visit).not.toBeNull()
  })

  it('returns null for an unknown record', () => {
    expect(findVisitFor([record()], 'nope')).toBeNull()
  })
})
