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

import { detectMileageConflict } from '../src/lib/mileage.js'
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

    // Read the newest dated record BEFORE inserting, so the rows about to be
    // written are not their own point of comparison.
    const { data: newestOnFile } = await supabase
      .from('service_records')
      .select('service_date, mileage_at_service')
      .eq('vehicle_id', vehicle.id)
      .not('service_date', 'is', null)
      .not('mileage_at_service', 'is', null)
      .order('service_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    // No date is a normal outcome, not a defect: continuation pages of a
    // multi-page invoice carry line items and nothing else. Storing null beats
    // substituting today, which would date a 2019 oil change to this morning.
    const serviceDate = extraction.serviceDate || null
    const mileage = Number.isFinite(extraction.mileage) ? extraction.mileage : null

    // Pages of one document share a group, so the client may pass one in.
    const receiptGroup = isUuid(extraction.receiptGroup) ? extraction.receiptGroup : randomUUID()

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

    return res.status(201).json({
      records: inserted ?? [],
      receiptGroup,
      mileageConflict: detectMileageConflict({
        serviceDate,
        mileage,
        newestOnFile,
        currentMileage: vehicle.current_mileage,
      }),
    })
  } catch (err) {
    return sendError(res, err)
  }
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function bad(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

