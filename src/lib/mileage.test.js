import { describe, expect, it } from 'vitest'

import { detectMileageConflict } from './mileage.js'

const newest = { service_date: '2025-06-01', mileage_at_service: 88000 }

describe('mileage conflict detection', () => {
  it('says nothing when the odometer went up', () => {
    expect(
      detectMileageConflict({
        serviceDate: '2025-08-01',
        mileage: 91000,
        newestOnFile: newest,
        currentMileage: 88000,
      }),
    ).toBeNull()
  })

  it('does NOT flag an older receipt that reads lower — that is just history', () => {
    // The whole point: scanning a backlog means most receipts predate what is
    // on file, and a lower reading on an older one is correct, not suspicious.
    expect(
      detectMileageConflict({
        serviceDate: '2019-03-04',
        mileage: 40000,
        newestOnFile: newest,
        currentMileage: 88000,
      }),
    ).toBeNull()
  })

  it('flags a newer receipt that reads lower', () => {
    const conflict = detectMileageConflict({
      serviceDate: '2025-08-01',
      mileage: 40000,
      newestOnFile: newest,
      currentMileage: 88000,
    })
    expect(conflict).toMatchObject({ extracted: 40000, current: 88000 })
    expect(conflict.comparedWith).toEqual({ date: '2025-06-01', mileage: 88000 })
  })

  it('treats a same-day receipt as current, not older', () => {
    expect(
      detectMileageConflict({
        serviceDate: '2025-06-01',
        mileage: 40000,
        newestOnFile: newest,
        currentMileage: 88000,
      }),
    ).not.toBeNull()
  })

  it('stays quiet on an undated page — there is no way to place it in sequence', () => {
    // Continuation pages routinely have no date. Prompting on each one would
    // mean a dialog on most pages of a stack.
    expect(
      detectMileageConflict({
        serviceDate: null,
        mileage: 40000,
        newestOnFile: newest,
        currentMileage: 88000,
      }),
    ).toBeNull()
  })

  it('stays quiet when there is no dated record to compare against', () => {
    expect(
      detectMileageConflict({
        serviceDate: '2025-08-01',
        mileage: 40000,
        newestOnFile: null,
        currentMileage: 88000,
      }),
    ).toBeNull()
  })

  it('stays quiet when the page has no odometer at all', () => {
    expect(
      detectMileageConflict({
        serviceDate: '2025-08-01',
        mileage: null,
        newestOnFile: newest,
        currentMileage: 88000,
      }),
    ).toBeNull()
  })
})
