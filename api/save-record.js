/**
 * POST /api/save-record
 *
 * Writes one scanned receipt to the log. A receipt usually describes several
 * services, so this inserts one `service_records` row per line item, sharing a
 * `receipt_group` so they can be shown and undone together.
 *
 * There is deliberately no review-before-save step: records land immediately
 * and stay editable from the service log. The one thing this route will not do
 * silently is lower a vehicle's odometer — see the mileage note below.
 *
 * Body: { vehicleId, extraction, source? }
 */
import { randomUUID } from 'node:crypto'

import { methodGuard, requireUser, sendError } from './_lib/supabase.js'

export default async function handler(req, res) {
  if (!methodGuard(req, res, 'POST')) return

  try {
    const { supabase } = await requireUser(req)
    const { vehicleId, extraction, source = 'ocr' } = req.body ?? {}

    if (!vehicleId) throw bad('No vehicle selected.')
    if (!extraction || !Array.isArray(extraction.lineItems) || extraction.lineItems.length === 0) {
      throw bad('Nothing to save — the scan produced no line items.')
    }

    // RLS scopes this to the caller's own vehicles: a mismatched id reads as
    // "not found" rather than leaking that someone else's vehicle exists.
    const { data: vehicle, error: vehicleError } = await supabase
      .from('vehicles')
      .select('id, current_mileage')
      .eq('id', vehicleId)
      .single()

    if (vehicleError || !vehicle) throw bad('That vehicle is not in your garage.', 404)

    const serviceDate = extraction.serviceDate || todayISO()
    const mileage = Number.isFinite(extraction.mileage) ? extraction.mileage : null
    const receiptGroup = randomUUID()

    const rows = extraction.lineItems.map((item) => ({
      vehicle_id: vehicle.id,
      service_date: serviceDate,
      mileage_at_service: mileage,
      service_type: item.item_key || 'other',
      service_type_raw: item.description || null,
      cost: numberOrNull(item.cost),
      measured_value: numberOrNull(item.measured_value),
      verdict: item.verdict || null,
      vendor: extraction.vendor || null,
      raw_notes: extraction.rawText || null,
      source: source === 'manual' ? 'manual' : 'ocr',
      receipt_group: receiptGroup,
    }))

    const { data: inserted, error: insertError } = await supabase
      .from('service_records')
      .insert(rows)
      .select()

    if (insertError) throw bad(insertError.message, 400)

    /*
     * Mileage handling.
     *
     * A reading HIGHER than what is on file is new information and the database
     * trigger has already applied it. A reading LOWER is ambiguous — it is
     * either an older receipt from the backlog being scanned out of order, or a
     * misread digit — so nothing is overwritten. We hand both numbers back and
     * let the user decide, which is the one place this flow deliberately stops
     * to ask.
     */
    const mileageConflict =
      mileage != null && mileage < vehicle.current_mileage
        ? { extracted: mileage, current: vehicle.current_mileage }
        : null

    return res.status(201).json({
      records: inserted ?? [],
      receiptGroup,
      mileageConflict,
    })
  } catch (err) {
    return sendError(res, err)
  }
}

function bad(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function todayISO() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
