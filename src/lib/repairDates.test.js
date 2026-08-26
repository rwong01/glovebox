import { describe, expect, it } from 'vitest'

import { REPAIR_REASONS, proposeDateRepairs, summariseRepairs } from './repairDates.js'

const INVOICE_TEXT = "DAVE'S AUTO  Invoice #12345  Date: 03/04/2024  Odometer 84,210  Oil & filter"

const record = (overrides = {}) => ({
  id: Math.random().toString(16).slice(2),
  source: 'ocr',
  service_date: null,
  created_at: '2026-08-26T14:00:00Z',
  raw_notes: INVOICE_TEXT,
  mileage_at_service: 84210,
  vendor: "Dave's Auto",
  ...overrides,
})

describe('proposing date repairs', () => {
  it('recovers a date that was dropped entirely', () => {
    const [proposal] = proposeDateRepairs([record({ service_date: null })])
    expect(proposal.to).toBe('2024-03-04')
    expect(proposal.reason).toBe(REPAIR_REASONS.MISSING)
  })

  it('replaces the day-of-scan date the old NOT NULL fallback wrote', () => {
    // This is the damaging case: a 2024 invoice recorded as scanned-today,
    // which quietly wrecks the driving-pace estimate.
    const [proposal] = proposeDateRepairs([
      record({ service_date: '2026-08-26', created_at: '2026-08-26T14:00:00Z' }),
    ])
    expect(proposal.from).toBe('2026-08-26')
    expect(proposal.to).toBe('2024-03-04')
    expect(proposal.reason).toBe(REPAIR_REASONS.SUBSTITUTED)
  })

  it('tolerates the scan crossing midnight in another timezone', () => {
    expect(
      proposeDateRepairs([record({ service_date: '2026-08-25', created_at: '2026-08-26T02:00:00Z' })]),
    ).toHaveLength(1)
  })

  it('leaves a real date alone', () => {
    // Scanned in 2026, dated 2024 — that is a correctly read backlog receipt.
    expect(
      proposeDateRepairs([record({ service_date: '2024-03-04' })]),
    ).toHaveLength(0)
  })

  it('never second-guesses a date typed in by hand', () => {
    expect(
      proposeDateRepairs([
        record({ source: 'manual', service_date: '2026-08-26', created_at: '2026-08-26T14:00:00Z' }),
      ]),
    ).toHaveLength(0)
  })

  it('leaves a record alone when its text contains no date to recover', () => {
    expect(
      proposeDateRepairs([record({ service_date: null, raw_notes: 'page 2 of 3 — brake pads' })]),
    ).toHaveLength(0)
  })

  it('does not propose a change that changes nothing', () => {
    expect(
      proposeDateRepairs([record({ service_date: '2024-03-04', created_at: '2024-03-04T10:00:00Z' })]),
    ).toHaveLength(0)
  })

  it('handles a missing transcription', () => {
    expect(proposeDateRepairs([record({ raw_notes: null })])).toHaveLength(0)
    expect(proposeDateRepairs([])).toHaveLength(0)
  })
})

describe('summarising for display', () => {
  it('rolls the line items of one visit into a single row', () => {
    // Four records off one invoice are one date change, not four.
    const proposals = proposeDateRepairs([
      record({ service_date: null }),
      record({ service_date: null }),
      record({ service_date: null }),
    ])
    const summary = summariseRepairs(proposals)

    expect(summary).toHaveLength(1)
    expect(summary[0]).toMatchObject({ to: '2024-03-04', count: 3 })
  })

  it('sorts newest change first', () => {
    const summary = summariseRepairs([
      { from: null, to: '2019-01-01', reason: 'missing', record: {} },
      { from: null, to: '2024-03-04', reason: 'missing', record: {} },
    ])
    expect(summary.map((s) => s.to)).toEqual(['2024-03-04', '2019-01-01'])
  })
})
