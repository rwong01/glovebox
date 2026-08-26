import { describe, expect, it } from 'vitest'

import { normaliseExtraction, parseImageInput } from './vision.js'
import { parseMeasurementValue, toCanonicalMeasurement } from './serviceItems.js'

describe('measurement conversion', () => {
  it('keeps a reading already in the canonical unit', () => {
    expect(toCanonicalMeasurement(8, '32nds', 'tires_tread')).toBe(8)
    expect(toCanonicalMeasurement(5.5, 'mm', 'brake_pads')).toBe(5.5)
  })

  it('converts a metric tread reading into 32nds', () => {
    // 6.35mm is exactly 8/32".
    expect(toCanonicalMeasurement(6.35, 'mm', 'tires_tread')).toBe(8)
  })

  it('converts 32nds pad thickness into millimetres', () => {
    expect(toCanonicalMeasurement(8, '32nds', 'brake_pads')).toBeCloseTo(6.35, 2)
  })

  it('converts decimal inches', () => {
    expect(toCanonicalMeasurement(0.25, 'in', 'tires_tread')).toBe(8)
  })

  it('assumes the canonical unit when the model does not say', () => {
    expect(toCanonicalMeasurement(6, null, 'tires_tread')).toBe(6)
  })

  it('rejects a reading no pad or tyre could have', () => {
    expect(toCanonicalMeasurement(400, 'mm', 'brake_pads')).toBeNull()
    expect(toCanonicalMeasurement(-3, 'mm', 'brake_pads')).toBeNull()
  })

  it('ignores measurements on items that are not measurable', () => {
    expect(toCanonicalMeasurement(5, 'mm', 'oil_change')).toBeNull()
  })

  it('reads the shapes a receipt actually prints', () => {
    expect(parseMeasurementValue('8/32')).toBe(8)
    expect(parseMeasurementValue('5.5 mm')).toBe(5.5)
    expect(parseMeasurementValue(7)).toBe(7)
    expect(parseMeasurementValue('n/a')).toBeNull()
  })
})

describe('extraction normalisation', () => {
  const base = {
    is_service_record: true,
    service_date: '2024-03-03',
    mileage: 84210,
    vendor: '  Dave’s Auto  ',
    line_items: [{ item_key: 'oil_change', description: 'Full synthetic oil & filter', cost: 89.5 }],
    raw_text: 'INVOICE ...',
    confidence: 0.92,
  }

  it('passes a clean extraction through', () => {
    const out = normaliseExtraction(base)
    expect(out.serviceDate).toBe('2024-03-03')
    expect(out.mileage).toBe(84210)
    expect(out.vendor).toBe('Dave’s Auto')
    expect(out.lineItems[0].cost).toBe(89.5)
  })

  it('maps an unrecognised key onto the catch-all instead of dropping the line', () => {
    const out = normaliseExtraction({ ...base, line_items: [{ item_key: 'flux_capacitor', description: 'Wiper blades' }] })
    expect(out.lineItems).toHaveLength(1)
    expect(out.lineItems[0].item_key).toBe('other')
    expect(out.lineItems[0].description).toBe('Wiper blades')
  })

  it('converts a line item measurement and keeps the raw reading for reference', () => {
    const out = normaliseExtraction({
      ...base,
      line_items: [{ item_key: 'tires_tread', description: 'Tread depth LF', measured_value: 6.35, measured_unit: 'mm' }],
    })
    expect(out.lineItems[0].measured_value).toBe(8)
    expect(out.lineItems[0].measured_raw).toBe('6.35 mm')
  })

  it('only accepts a verdict on the item that has one', () => {
    const out = normaliseExtraction({
      ...base,
      line_items: [
        { item_key: 'brake_rotors', description: 'Rotors', verdict: 'near_minimum' },
        { item_key: 'oil_change', description: 'Oil', verdict: 'below_minimum' },
      ],
    })
    expect(out.lineItems[0].verdict).toBe('near_minimum')
    expect(out.lineItems[1].verdict).toBeNull()
  })

  it('rejects an impossible date rather than storing it', () => {
    expect(normaliseExtraction({ ...base, service_date: '2024-02-31' }).serviceDate).toBeNull()
    expect(normaliseExtraction({ ...base, service_date: '03/03/2024' }).serviceDate).toBeNull()
    expect(normaliseExtraction({ ...base, service_date: '1823-01-01' }).serviceDate).toBeNull()
  })

  it('rejects an odometer reading that is a misread rather than a mileage', () => {
    expect(normaliseExtraction({ ...base, mileage: 99999999 }).mileage).toBeNull()
    expect(normaliseExtraction({ ...base, mileage: -5 }).mileage).toBeNull()
  })

  it('survives a response missing everything optional', () => {
    const out = normaliseExtraction({ is_service_record: true, line_items: [], raw_text: '' })
    expect(out.lineItems).toEqual([])
    expect(out.mileage).toBeNull()
    expect(out.vendor).toBeNull()
  })

  it('flags a photo that is not a service record at all', () => {
    expect(normaliseExtraction({ ...base, is_service_record: false }).isServiceRecord).toBe(false)
  })
})

describe('image input parsing', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUg=='

  it('accepts a data URL and picks up its mime type', () => {
    const out = parseImageInput(`data:image/png;base64,${png}`)
    expect(out.mimeType).toBe('image/png')
    expect(out.data).toBe(png)
  })

  it('accepts a bare base64 string', () => {
    expect(parseImageInput(png).data).toBe(png)
  })

  it('rejects anything that is not base64', () => {
    expect(() => parseImageInput('not an image!')).toThrow(/base64/)
    expect(() => parseImageInput('')).toThrow(/No image/)
  })
})
