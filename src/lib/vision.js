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
import { BRAKE_ROTOR_KEYS, DEFAULT_ITEM_KEYS, VERDICTS, toCanonicalMeasurement } from './serviceItems.js'

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-2.5-flash'

/** Leaves headroom under the function's 60s ceiling to still return an error. */
const REQUEST_TIMEOUT_MS = 50_000

/** Roughly 10MB of decoded image. The client downscales well below this. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const PROMPT = `You are reading a photograph of a vehicle service record: a repair-shop invoice, a quick-lube receipt, a dealer service sheet, or a multi-point inspection report.

Extract only what is actually printed on the document. Do not infer, estimate, or fill in typical values. If something is illegible or absent, omit the field entirely rather than guessing.

Field guidance:

- service_date: the date the work was performed, as YYYY-MM-DD. Fall back to the invoice date if that is all there is. Beware of two-digit years and of dates printed in DD/MM/YYYY order — use surrounding context to decide.
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
- confidence: 0 to 1, how legible the document was overall.`

function responseSchema(itemKeys) {
  return {
    type: 'object',
    properties: {
      is_service_record: { type: 'boolean' },
      service_date: { type: 'string', description: 'YYYY-MM-DD' },
      mileage: { type: 'integer' },
      vendor: { type: 'string' },
      total_cost: { type: 'number' },
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
      'mileage',
      'vendor',
      'total_cost',
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
          // Reading a document is transcription, not creative writing.
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
    try {
      const parsedBody = JSON.parse(body)
      if (parsedBody?.error?.message) message = parsedBody.error.message
    } catch {
      if (body) message = body.slice(0, 300)
    }
    // 429 and 5xx are worth retrying; 400/403 are not.
    throw Object.assign(new Error(message), {
      statusCode: response.status === 429 ? 429 : response.status >= 500 ? 502 : 400,
    })
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
    serviceDate: isoDate(raw?.service_date),
    mileage: positiveInteger(raw?.mileage),
    vendor: typeof raw?.vendor === 'string' ? raw.vendor.trim() || null : null,
    totalCost: positiveNumber(raw?.total_cost),
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

/** Only accepts a real YYYY-MM-DD that is not absurdly far from the present. */
function isoDate(value) {
  if (typeof value !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null

  const [, y, mo, d] = m.map(Number)
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  if (y < 1950 || y > new Date().getFullYear() + 1) return null

  return value.trim()
}
