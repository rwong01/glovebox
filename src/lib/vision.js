/**
 * The vision/OCR boundary — the ONLY module that talks to a vision provider.
 *
 * Swapping Gemini for something else means rewriting this file and nothing
 * else: callers get the same normalised shape either way.
 *
 * SERVER ONLY. This reads `GEMINI_API_KEY`, which deliberately has no VITE_
 * prefix so Vite will refuse to bundle it into client code. It is imported by
 * `api/extract-receipt.js` and must never be imported from `src/components`
 * or `src/pages`.
 */
import { resolveServiceDate } from './receiptDate.js'
import {
  BRAKE_ROTOR_KEYS,
  DEFAULT_ITEM_KEYS,
  VERDICTS,
  toCanonicalMeasurement,
} from './serviceItems.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Flash-Lite, because this workload is exactly what it is for: high-volume,
 * low-latency document parsing where the job is transcription rather than
 * reasoning. It also carries a far larger free-tier daily allowance than the
 * general-purpose Flash models, which matters when the first thing you do with
 * this app is scan a shoebox.
 *
 * Override with GEMINI_MODEL. `gemini-3.5-flash-lite` is the newer sibling and
 * is explicitly tuned for document parsing; run `npm run models` to see what
 * your key can actually reach.
 */
const DEFAULT_MODEL = 'gemini-3.1-flash-lite'

/** Leaves headroom under the function's 60s ceiling to still return an error. */
const REQUEST_TIMEOUT_MS = 50_000

/** Roughly 10MB of decoded image. The client downscales well below this. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const PROMPT = `You are reading a photograph of a vehicle service record: a repair-shop invoice, a quick-lube receipt, a dealer service sheet, or a multi-point inspection report.

Extract only what is actually printed on the document. Do not infer, estimate, or fill in typical values. If something is illegible or absent, omit the field entirely rather than guessing.

Field guidance:

- service_date: the date the work was PERFORMED, as YYYY-MM-DD.
  A service invoice usually carries several dates. Take the one next to labels like "Date", "Service Date", "Invoice Date", "Date In", "Closed", or "Completed". Where both an opened and a closed date appear, use the closed one.
  Ignore dates that are not when the work happened: "Next service due", "Return by", warranty expiry, a printed-on timestamp in a footer, the customer's date of birth, and any date attached to a recommendation for future work.
  If only a two-digit year is printed, expand it to the obvious century.
- service_date_raw: that same date copied EXACTLY as printed, character for character — "03/04/24", "MAR 4 2024", whatever is on the page. Do not reformat it. This is a safety net for when the conversion above goes wrong, so it matters even when service_date looks fine.
- mileage: the odometer reading at the time of service, as a plain integer with no separators. Receipts label this "Odometer", "Mileage", "Miles", "ODO", or "In/Out". If both an in and an out reading appear, use the higher one.
- vendor: the shop or dealership name.
- total_cost: the invoice total, if printed.

- line_items: one entry per distinct service PERFORMED or INSPECTED. A single visit usually produces several. Map each to the closest item_key from the allowed list.
  - Use "other" for anything with no matching key — wiper blades, alignment, diagnostics, labour-only lines, shop supplies, tire rotation — and keep the printed wording in "description".
  - "description" must always be the wording as printed, not your paraphrase.
  - cost: the price for that line alone, if itemised. Omit it when the line is part of a bundled price.

- Inspection sheets record measurements even where no work was done. Capture these; they are the most valuable thing on the page.
  - measured_value and measured_unit: report the number EXACTLY AS PRINTED and name the unit you read it in — "32nds" for a reading like 8/32 or 8-32nds, "mm" for millimetres, "in" for decimal inches. Do NOT convert between units; the caller handles that.
  - Tire tread is normally in 32nds, brake pad thickness normally in millimetres, but honour whatever the sheet actually uses.
  - Front and rear wear at different rates — for tires and for brakes alike — and either axle can be serviced on its own, so never merge the two into one worst-of-the-car reading. Split every axle-based item this way:
    - Tread depth: item_key "tires_tread_front" / "tires_tread_rear". New tires being fitted: item_key "tires_age_front" / "tires_age_rear".
    - Pad thickness: item_key "brake_pads_front" / "brake_pads_rear". Rotor verdict: item_key "brake_rotors_front" / "brake_rotors_rear".
    - Within one axle, if left and right are both printed (two tires, or two pads), report the lower of the two — the worst corner on that axle is the one that governs.
    - If a reading is printed with no axle stated anywhere on the page and you truly cannot tell which one it is, tag that line "other" and keep the wording in "description" — do not guess an axle.

- verdict: only for item_key "brake_rotors_front" or "brake_rotors_rear". Rotors have no universal thickness spec, so what matters is the shop's written call. Map it to within_spec, near_minimum, or below_minimum. Omit if the sheet says nothing about rotors.

- raw_text: a faithful transcription of every legible line on the document, preserving the order it appears in.
- is_service_record: false if this is not a vehicle service document at all — a blurry surface, a grocery receipt, a photo of a person.
- confidence: 0 to 1, how legible the document was overall.

Multi-page documents. One invoice often runs to several pages, and only the first carries the header:

- document_ref: the invoice, repair order, work order or RO number exactly as printed. This is what identifies one document across its pages, so capture it even when it appears only in a small header or footer.
- page_number and page_count: if the page carries a marker like "Page 2 of 3", report both numbers. Omit both if there is no such marker.
- A continuation page frequently has NO date, NO odometer and NO shop name. That is normal and expected — omit those fields rather than guessing or carrying over a value you cannot actually see on this page. The caller reassembles the document from the pages.`

function responseSchema(itemKeys) {
  return {
    type: 'object',
    properties: {
      is_service_record: { type: 'boolean' },
      service_date: { type: 'string', description: 'YYYY-MM-DD' },
      service_date_raw: { type: 'string', description: 'the date exactly as printed on the page' },
      mileage: { type: 'integer' },
      vendor: { type: 'string' },
      total_cost: { type: 'number' },
      document_ref: { type: 'string', description: 'invoice / RO / work order number as printed' },
      page_number: { type: 'integer' },
      page_count: { type: 'integer' },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item_key: { type: 'string', enum: itemKeys },
            description: { type: 'string' },
            cost: { type: 'number' },
            measured_value: { type: 'number' },
            measured_unit: { type: 'string', enum: ['32nds', 'mm', 'in'] },
            verdict: { type: 'string', enum: VERDICTS },
          },
          required: ['item_key', 'description'],
          propertyOrdering: ['item_key', 'description', 'cost', 'measured_value', 'measured_unit', 'verdict'],
        },
      },
      raw_text: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['is_service_record', 'line_items', 'raw_text'],
    propertyOrdering: [
      'is_service_record',
      'service_date',
      'service_date_raw',
      'mileage',
      'vendor',
      'total_cost',
      'document_ref',
      'page_number',
      'page_count',
      'line_items',
      'raw_text',
      'confidence',
    ],
  }
}

/** Accepts a bare base64 string or a full `data:image/jpeg;base64,...` URL. */
export function parseImageInput(image) {
  if (typeof image !== 'string' || !image) {
    throw badRequest('No image supplied.')
  }
  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(image)
  const mimeType = dataUrl ? dataUrl[1] : null
  const data = dataUrl ? dataUrl[2] : image.replace(/\s/g, '')

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw badRequest('Image is not valid base64.')
  }
  if ((data.length * 3) / 4 > MAX_IMAGE_BYTES) {
    throw badRequest('Image is too large. Try a smaller capture.')
  }
  return { data, mimeType }
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

/**
 * Reads a rate-limit rejection.
 *
 * The two kinds are worth telling apart, because only one of them is worth
 * waiting for. A per-minute limit clears in seconds and the caller can simply
 * pause the queue; a per-day limit does not clear until the quota window
 * resets, so backing off just burns the afternoon.
 *
 * Gemini attaches a RetryInfo detail with a delay like "38s"; when it is
 * absent, a minute is a reasonable stand-in for a per-minute limit.
 */
export function describeQuota(parsedBody, fallbackMessage) {
  const details = parsedBody?.error?.details
  let retryAfter = null

  if (Array.isArray(details)) {
    for (const detail of details) {
      const match = /^([\d.]+)s$/.exec(detail?.retryDelay ?? '')
      if (match) retryAfter = Math.ceil(Number(match[1]))
    }
  }

  const text = `${fallbackMessage} ${JSON.stringify(details ?? '')}`
  const daily = /per\s*day|PerDay|daily/i.test(text)

  return {
    scope: daily ? 'daily' : 'per-minute',
    retryAfter: daily ? null : (retryAfter ?? 60),
    message: daily
      ? "You've used up today's Gemini quota. It resets on Google's daily schedule — the rest of your pages will have to wait until then."
      : 'Gemini is rate limiting — too many pages too quickly. Waiting a moment and carrying on.',
  }
}

/**
 * Runs one receipt image through the vision model.
 *
 * @param {object} input
 * @param {string} input.image      base64 or data URL
 * @param {string} [input.mimeType] defaults to the data URL's type, then jpeg
 * @param {string[]} [input.itemKeys] valid keys, normally passed through from
 *                                    the `service_rules` the client loaded
 * @returns {Promise<object>} normalised extraction
 */
export async function extractReceipt({ image, mimeType, itemKeys } = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw Object.assign(
      new Error('GEMINI_API_KEY is not set. Add it to .env.local (see .env.local.example).'),
      { statusCode: 503 },
    )
  }

  const keys = Array.isArray(itemKeys) && itemKeys.length ? itemKeys : DEFAULT_ITEM_KEYS
  const parsed = parseImageInput(image)
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response
  try {
    response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: PROMPT },
              {
                inlineData: {
                  mimeType: mimeType || parsed.mimeType || 'image/jpeg',
                  data: parsed.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          // Reading a document is transcription, not creative writing. Some
          // Flash-Lite models ignore temperature/top-K/top-P and use their own
          // defaults; sending it is harmless there and matters on models that
          // do honour it.
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: responseSchema(keys),
        },
      }),
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('The vision service took too long to respond.'), {
        statusCode: 504,
      })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    let message = `Vision request failed (${response.status})`
    let parsedBody = null
    try {
      parsedBody = JSON.parse(body)
      if (parsedBody?.error?.message) message = parsedBody.error.message
    } catch {
      if (body) message = body.slice(0, 300)
    }

    if (response.status === 429) {
      const quota = describeQuota(parsedBody, message)
      throw Object.assign(new Error(quota.message), {
        statusCode: 429,
        retryAfter: quota.retryAfter,
        quotaScope: quota.scope,
      })
    }

    // 5xx is worth retrying; 400/403 is not.
    throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : 400 })
  }

  const payload = await response.json()

  const blockReason = payload?.promptFeedback?.blockReason
  if (blockReason) {
    throw Object.assign(new Error(`The vision service refused this image (${blockReason}).`), {
      statusCode: 422,
    })
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('')
  if (!text) {
    throw Object.assign(new Error('The vision service returned no readable result.'), {
      statusCode: 502,
    })
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw Object.assign(new Error('The vision service returned malformed JSON.'), {
      statusCode: 502,
    })
  }

  return normaliseExtraction(raw, keys)
}

/**
 * Shapes the model's output into exactly what the rest of the app expects, and
 * drops anything that cannot be trusted. Everything downstream — including the
 * database insert — assumes this normalisation has happened.
 */
export function normaliseExtraction(raw, itemKeys = DEFAULT_ITEM_KEYS) {
  const allowed = new Set(itemKeys)

  // Three chances at the date, most trusted first. The old code accepted only a
  // perfectly zero-padded YYYY-MM-DD and dropped everything else on the floor,
  // which is why so many records came back undated.
  const resolved = resolveServiceDate({
    isoValue: raw?.service_date,
    rawValue: raw?.service_date_raw,
    fullText: raw?.raw_text,
  })

  const lineItems = []
  for (const item of Array.isArray(raw?.line_items) ? raw.line_items : []) {
    const key = allowed.has(item?.item_key) ? item.item_key : 'other'
    const description = typeof item?.description === 'string' ? item.description.trim() : null

    lineItems.push({
      item_key: key,
      description: description || null,
      cost: positiveNumber(item?.cost),
      measured_value: toCanonicalMeasurement(item?.measured_value, item?.measured_unit, key),
      measured_raw:
        item?.measured_value != null
          ? `${item.measured_value}${item.measured_unit ? ` ${item.measured_unit}` : ''}`
          : null,
      verdict: BRAKE_ROTOR_KEYS.includes(key) && VERDICTS.includes(item?.verdict) ? item.verdict : null,
    })
  }

  return {
    isServiceRecord: raw?.is_service_record !== false,
    serviceDate: resolved.date,
    serviceDateSource: resolved.source,
    mileage: positiveInteger(raw?.mileage),
    vendor: typeof raw?.vendor === 'string' ? raw.vendor.trim() || null : null,
    totalCost: positiveNumber(raw?.total_cost),
    // What ties the pages of one invoice together.
    documentRef: typeof raw?.document_ref === 'string' ? raw.document_ref.trim() || null : null,
    pageNumber: positiveInteger(raw?.page_number),
    pageCount: positiveInteger(raw?.page_count),
    lineItems,
    rawText: typeof raw?.raw_text === 'string' ? raw.raw_text.trim() : '',
    confidence: typeof raw?.confidence === 'number' ? clamp(raw.confidence, 0, 1) : null,
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function positiveNumber(value) {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function positiveInteger(value) {
  const n = typeof value === 'string' ? Number(value.replace(/[^0-9]/g, '')) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  // Past this an odometer reading is a misread, not a mileage.
  return n > 2_000_000 ? null : Math.round(n)
}

