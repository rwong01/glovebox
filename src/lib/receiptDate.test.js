import { describe, expect, it } from 'vitest'

import { findDatesInText, parseReceiptDate, resolveServiceDate } from './receiptDate.js'

const today = new Date(2026, 7, 26) // 26 Aug 2026
const parse = (value) => parseReceiptDate(value, { today })

describe('formats the old strict validator threw away', () => {
  it('accepts ISO without zero padding', () => {
    // `2024-3-4` failed a /^\d{4}-\d{2}-\d{2}$/ test and became null.
    expect(parse('2024-3-4')).toBe('2024-03-04')
    expect(parse('2024-03-04')).toBe('2024-03-04')
  })

  it('accepts US slash dates', () => {
    expect(parse('03/04/2024')).toBe('2024-03-04')
    expect(parse('3/4/2024')).toBe('2024-03-04')
  })

  it('accepts two-digit years', () => {
    expect(parse('03/04/24')).toBe('2024-03-04')
    expect(parse('3-4-24')).toBe('2024-03-04')
  })

  it('accepts month names in either order', () => {
    expect(parse('Mar 4, 2024')).toBe('2024-03-04')
    expect(parse('March 4th 2024')).toBe('2024-03-04')
    expect(parse('MAR 04 2024')).toBe('2024-03-04')
    expect(parse('4 Mar 2024')).toBe('2024-03-04')
    expect(parse('4th March, 2024')).toBe('2024-03-04')
  })

  it('accepts dots and dashes as separators', () => {
    expect(parse('03.04.2024')).toBe('2024-03-04')
    expect(parse('03-04-2024')).toBe('2024-03-04')
  })
})

describe('ambiguous numeric dates', () => {
  it('reads an unambiguous day-first date correctly', () => {
    // 25 cannot be a month, so the order is settled by the value itself.
    expect(parse('25/12/2023')).toBe('2023-12-25')
  })

  it('defaults to month-first when nothing settles it', () => {
    // US ordering, matching the odometers-in-miles assumption elsewhere.
    expect(parse('03/04/2024')).toBe('2024-03-04')
  })
})

describe('two-digit year expansion', () => {
  it('reads a recent year as this century', () => {
    expect(parse('01/15/24')).toBe('2024-01-15')
  })

  it('reads an old year as the last century', () => {
    expect(parse('06/01/98')).toBe('1998-06-01')
  })

  it('allows next year, since an invoice can be dated slightly ahead', () => {
    expect(parse('01/15/27')).toBe('2027-01-15')
  })
})

describe('rejections', () => {
  it('rejects impossible calendar dates', () => {
    expect(parse('2024-02-31')).toBeNull()
    expect(parse('13/45/2024')).toBeNull()
  })

  it('rejects dates too far in the future to be a service record', () => {
    expect(parse('2030-01-01')).toBeNull()
  })

  it('rejects dates before cars had service histories worth keeping', () => {
    expect(parse('1823-01-01')).toBeNull()
  })

  it('rejects things that are not dates', () => {
    expect(parse('n/a')).toBeNull()
    expect(parse('')).toBeNull()
    expect(parse(null)).toBeNull()
    expect(parse('84210')).toBeNull()
  })
})

describe('finding a date in a transcription', () => {
  const invoice = `
    DAVE'S AUTO SERVICE
    Invoice #12345      Date: 03/04/2024
    Odometer: 84,210
    Full synthetic oil & filter      89.50
    Next service due: 09/04/2024
  `

  it('returns dates in the order they appear', () => {
    // The invoice date is printed first; the "next due" date follows.
    expect(findDatesInText(invoice)).toEqual(['2024-03-04', '2024-09-04'])
  })

  it('returns nothing for text without dates', () => {
    expect(findDatesInText('no dates here at all')).toEqual([])
    expect(findDatesInText(null)).toEqual([])
  })
})

describe('resolving a service date from all available sources', () => {
  it('prefers what the model resolved', () => {
    expect(
      resolveServiceDate(
        { isoValue: '2024-03-04', rawValue: '03/04/24', fullText: 'Date 01/01/2020' },
        { today },
      ),
    ).toEqual({ date: '2024-03-04', source: 'model' })
  })

  it('falls back to the date as printed when the model returned nothing usable', () => {
    expect(
      resolveServiceDate({ isoValue: null, rawValue: 'MAR 4 2024', fullText: '' }, { today }),
    ).toEqual({ date: '2024-03-04', source: 'raw' })
  })

  it('falls back to the transcription as a last resort', () => {
    expect(
      resolveServiceDate(
        { isoValue: '', rawValue: '', fullText: 'Invoice #9 Date: 03/04/2024 total 89.50' },
        { today },
      ),
    ).toEqual({ date: '2024-03-04', source: 'text' })
  })

  it('reports no date rather than inventing one', () => {
    expect(
      resolveServiceDate({ isoValue: null, rawValue: null, fullText: 'page 2 of 3' }, { today }),
    ).toEqual({ date: null, source: null })
  })
})
