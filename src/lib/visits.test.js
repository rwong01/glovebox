import { describe, expect, it } from 'vitest'

import { groupIntoVisits } from './visits.js'

const record = (overrides = {}) => ({
  id: Math.random().toString(16).slice(2),
  service_date: '2024-03-03',
  mileage_at_service: 84210,
  vendor: "Dave's Auto",
  service_type: 'oil_change',
  cost: null,
  receipt_group: null,
  ...overrides,
})

describe('grouping records into visits', () => {
  it('collapses one trip to the shop into a single visit', () => {
    // The complaint this fixes: two hundred line items reading as two hundred
    // visits, when there were a dozen.
    const visits = groupIntoVisits([
      record({ service_type: 'oil_change', cost: 89.5 }),
      record({ service_type: 'tires_tread' }),
      record({ service_type: 'brake_rotors' }),
      record({ service_type: 'other', cost: 25 }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].records).toHaveLength(4)
    expect(visits[0].cost).toBe(114.5)
    expect(visits[0].vendor).toBe("Dave's Auto")
  })

  it('keeps separate trips separate', () => {
    const visits = groupIntoVisits([
      record({ service_date: '2024-03-03', mileage_at_service: 84210 }),
      record({ service_date: '2025-01-09', mileage_at_service: 91000 }),
    ])
    expect(visits).toHaveLength(2)
  })

  it('uses receipt_group over the natural key, so a multi-page invoice is one visit', () => {
    // Page 2 of an invoice may carry no date or odometer of its own; the group
    // id is what keeps it attached.
    const visits = groupIntoVisits([
      record({ receipt_group: 'abc', service_date: '2024-03-03', mileage_at_service: 84210 }),
      record({ receipt_group: 'abc', service_date: null, mileage_at_service: null, vendor: null }),
    ])

    expect(visits).toHaveLength(1)
    expect(visits[0].date).toBe('2024-03-03')
    expect(visits[0].mileage).toBe(84210)
    expect(visits[0].vendor).toBe("Dave's Auto")
  })

  it('separates same-day visits to different shops', () => {
    const visits = groupIntoVisits([
      record({ vendor: "Dave's Auto" }),
      record({ vendor: 'Tire Barn', mileage_at_service: 84215 }),
    ])
    expect(visits).toHaveLength(2)
  })

  it('sorts newest first', () => {
    const visits = groupIntoVisits([
      record({ service_date: '2019-05-01', mileage_at_service: 40000 }),
      record({ service_date: '2025-01-09', mileage_at_service: 91000 }),
      record({ service_date: '2022-06-06', mileage_at_service: 70000 }),
    ])
    expect(visits.map((v) => v.date)).toEqual(['2025-01-09', '2022-06-06', '2019-05-01'])
  })

  it('puts undated visits last rather than pretending they are from 1970', () => {
    const visits = groupIntoVisits([
      record({ service_date: null, mileage_at_service: null, receipt_group: 'x' }),
      record({ service_date: '2019-05-01', mileage_at_service: 40000 }),
    ])
    expect(visits[0].date).toBe('2019-05-01')
    expect(visits[1].date).toBeNull()
  })

  it('leaves cost null when no line item had a price', () => {
    expect(groupIntoVisits([record({ cost: null })])[0].cost).toBeNull()
  })

  it('handles an empty history', () => {
    expect(groupIntoVisits([])).toEqual([])
  })
})
