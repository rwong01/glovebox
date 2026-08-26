/**
 * Reassembles a multi-page document from pages scanned in order.
 *
 * One invoice commonly runs to several pages and only the first carries the
 * header: the date, the odometer and the shop name appear once, and pages two
 * and three are just more line items. Treating each page as its own visit
 * produces undated, mileage-less records and turns a dozen visits into fifty.
 *
 * People scan a stack front to back, so the previous page is the context for
 * the current one — the same assumption a person makes turning the pile over.
 * Everything here is pure so the rules can be tested directly.
 */

/** Fields a continuation page inherits from the first page of its document. */
const INHERITED = ['serviceDate', 'mileage', 'vendor', 'documentRef']

/**
 * Decides whether `extraction` starts a new document or continues the previous
 * one, and fills in any header fields it inherited.
 *
 * The signals, strongest first:
 *
 *   1. A printed invoice / RO number. Two pages carrying different refs are
 *      different documents no matter what else matches; the same ref means the
 *      same document even if the pages were scanned out of order.
 *   2. A "Page 1 of N" marker — an explicit statement that a document begins.
 *   3. A date or odometer that disagrees with the open document.
 *   4. Nothing at all. A page with no ref, no date and no odometer is a
 *      continuation, because a first page essentially always has a header.
 *
 * @param {object|null} open   the document accumulated so far, or null
 * @param {object} extraction  normalised output for the page just read
 * @returns {{isNewDocument: boolean, page: object, document: object}}
 */
export function assignPage(open, extraction) {
  const isNew = startsNewDocument(open, extraction)

  if (isNew || !open) {
    const page = { ...extraction }
    return {
      isNewDocument: true,
      page,
      document: {
        serviceDate: page.serviceDate ?? null,
        mileage: page.mileage ?? null,
        vendor: page.vendor ?? null,
        documentRef: page.documentRef ?? null,
        pageCount: page.pageCount ?? null,
        pagesSeen: 1,
      },
    }
  }

  // Continuation: take what this page is missing from the document.
  const page = { ...extraction }
  for (const field of INHERITED) {
    if (page[field] == null) page[field] = open[field] ?? null
  }

  return {
    isNewDocument: false,
    page,
    document: {
      ...open,
      // A later page can supply a header field the first one had cropped off.
      serviceDate: open.serviceDate ?? extraction.serviceDate ?? null,
      mileage: open.mileage ?? extraction.mileage ?? null,
      vendor: open.vendor ?? extraction.vendor ?? null,
      documentRef: open.documentRef ?? extraction.documentRef ?? null,
      pageCount: open.pageCount ?? extraction.pageCount ?? null,
      pagesSeen: (open.pagesSeen ?? 1) + 1,
    },
  }
}

function startsNewDocument(open, extraction) {
  if (!open) return true

  const ref = normaliseRef(extraction.documentRef)
  const openRef = normaliseRef(open.documentRef)

  // (1) Explicit identity wins outright, in both directions.
  if (ref && openRef) return ref !== openRef
  if (ref && !openRef) return true

  // (2) An explicit "page 1" says a document begins here.
  if (extraction.pageNumber === 1) return true
  // ...and any later page number says it does not, provided the open document
  // has not already run past that count.
  if (extraction.pageNumber > 1) return false

  // (3) Header fields that disagree with the open document.
  if (extraction.serviceDate && open.serviceDate && extraction.serviceDate !== open.serviceDate) {
    return true
  }
  if (extraction.mileage != null && open.mileage != null && extraction.mileage !== open.mileage) {
    return true
  }

  // A page carrying a header of its own, where the open document had none to
  // compare against, is most likely a fresh document rather than a continuation.
  if (!open.serviceDate && !open.mileage && (extraction.serviceDate || extraction.mileage != null)) {
    return true
  }

  // (4) No identifying marks at all — a continuation.
  if (!extraction.serviceDate && extraction.mileage == null && !ref) return false

  // Header matches the open document exactly: same visit.
  return false
}

function normaliseRef(ref) {
  if (typeof ref !== 'string') return null
  // Shops print the same number as "RO 12345", "RO#12345", "ro-12345".
  const cleaned = ref.replace(/[^a-z0-9]/gi, '').toLowerCase()
  // Two or fewer characters is not an identifier, it is noise off a bad scan.
  return cleaned.length > 2 ? cleaned : null
}

/** True once every page a document claims to have has been seen. */
export function isDocumentComplete(document) {
  if (!document) return false
  if (!document.pageCount) return false
  return document.pagesSeen >= document.pageCount
}
