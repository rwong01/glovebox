import { describe, expect, it } from 'vitest'

import { assignPage, isDocumentComplete } from './receiptGrouping.js'

const page = (overrides = {}) => ({
  serviceDate: null,
  mileage: null,
  vendor: null,
  documentRef: null,
  pageNumber: null,
  pageCount: null,
  lineItems: [],
  ...overrides,
})

const invoiceHeader = page({
  serviceDate: '2024-03-03',
  mileage: 84210,
  vendor: "Dave's Auto",
  documentRef: 'RO 12345',
  pageNumber: 1,
  pageCount: 3,
})

/** Feeds pages through in order, the way the scanning queue does. */
function scan(pages) {
  let open = null
  return pages.map((p) => {
    const result = assignPage(open, p)
    open = result.document
    return result
  })
}

describe('first page', () => {
  it('always starts a document', () => {
    const [first] = scan([invoiceHeader])
    expect(first.isNewDocument).toBe(true)
    expect(first.document.serviceDate).toBe('2024-03-03')
  })
})

describe('continuation pages', () => {
  it('inherits the header a bare page does not carry', () => {
    // This is the real case: page 2 of an invoice is just more line items.
    const [, second] = scan([invoiceHeader, page({ lineItems: [{ item_key: 'brake_pads' }] })])

    expect(second.isNewDocument).toBe(false)
    expect(second.page.serviceDate).toBe('2024-03-03')
    expect(second.page.mileage).toBe(84210)
    expect(second.page.vendor).toBe("Dave's Auto")
  })

  it('follows an explicit page marker even when the page is otherwise bare', () => {
    const [, second] = scan([invoiceHeader, page({ pageNumber: 2, pageCount: 3 })])
    expect(second.isNewDocument).toBe(false)
  })

  it('stays with the document when the same invoice number reappears', () => {
    const [, second] = scan([invoiceHeader, page({ documentRef: 'RO#12345' })])
    // Same number, punctuated differently by the printer.
    expect(second.isNewDocument).toBe(false)
  })

  it('counts pages so completeness can be checked', () => {
    const results = scan([invoiceHeader, page({ pageNumber: 2 }), page({ pageNumber: 3 })])
    const last = results[results.length - 1]
    expect(last.document.pagesSeen).toBe(3)
    expect(isDocumentComplete(last.document)).toBe(true)
  })

  it('fills a header field from a later page when the first one lost it', () => {
    const [, second] = scan([
      page({ documentRef: 'RO 999', mileage: 50000 }),
      page({ documentRef: 'RO 999', serviceDate: '2022-01-05' }),
    ])
    expect(second.document.serviceDate).toBe('2022-01-05')
    expect(second.document.mileage).toBe(50000)
  })
})

describe('document boundaries', () => {
  it('starts fresh on a different invoice number', () => {
    const [, second] = scan([invoiceHeader, page({ documentRef: 'RO 99999' })])
    expect(second.isNewDocument).toBe(true)
  })

  it('starts fresh on an explicit page 1', () => {
    const [, second] = scan([
      invoiceHeader,
      page({ pageNumber: 1, serviceDate: '2024-09-09' }),
    ])
    expect(second.isNewDocument).toBe(true)
  })

  it('starts fresh on a different date', () => {
    const [, second] = scan([invoiceHeader, page({ serviceDate: '2024-09-09' })])
    expect(second.isNewDocument).toBe(true)
  })

  it('starts fresh on a different odometer', () => {
    const [, second] = scan([invoiceHeader, page({ mileage: 91000 })])
    expect(second.isNewDocument).toBe(true)
  })

  it('keeps a page whose header matches exactly with the same document', () => {
    const [, second] = scan([
      invoiceHeader,
      page({ serviceDate: '2024-03-03', mileage: 84210 }),
    ])
    expect(second.isNewDocument).toBe(false)
  })

  it('treats a header appearing after a bare page as a new document', () => {
    const [, second] = scan([
      page({ lineItems: [{ item_key: 'other' }] }),
      page({ serviceDate: '2024-03-03', mileage: 84210 }),
    ])
    expect(second.isNewDocument).toBe(true)
  })

  it('ignores a scrap of noise as an invoice number', () => {
    // A bad scan can turn a stray mark into a one-character "ref"; that must
    // not split a document in two.
    const [, second] = scan([invoiceHeader, page({ documentRef: '#' })])
    expect(second.isNewDocument).toBe(false)
  })
})

describe('completeness', () => {
  it('is unknown without a page count', () => {
    expect(isDocumentComplete({ pagesSeen: 3 })).toBe(false)
    expect(isDocumentComplete(null)).toBe(false)
  })
})
