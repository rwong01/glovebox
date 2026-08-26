/**
 * POST /api/extract-receipt
 *
 * Takes one receipt image and returns structured line items. Does not write
 * anything — saving is a separate call, so the client can react to a mileage
 * discrepancy without the extraction having to be repeated.
 *
 * Body: { image, mimeType?, itemKeys? }
 */
import { extractReceipt } from '../src/lib/vision.js'
import { methodGuard, requireUser, sendError } from './_lib/supabase.js'

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return

  try {
    // Requiring a session here also keeps the Gemini quota from being spent by
    // anyone who finds the endpoint.
    await requireUser(req)

    const { image, mimeType, itemKeys } = req.body ?? {}
    const extraction = await extractReceipt({ image, mimeType, itemKeys })

    if (!extraction.isServiceRecord) {
      return res.status(422).json({
        error: "That doesn't look like a service record. Try another photo.",
        extraction,
      })
    }

    return res.status(200).json({ extraction })
  } catch (err) {
    return sendError(res, err)
  }
}
