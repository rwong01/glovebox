/**
 * Client-side wrappers for the two serverless routes.
 *
 * Everything else the app does goes straight to Supabase through the browser
 * SDK, where row-level security already scopes reads and writes. These two
 * exist because one needs a key that must never reach the browser, and the
 * other writes several rows as a single receipt.
 */
import { supabase } from './supabaseClient.js'

async function authHeader() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Your session has expired. Sign in again.')
  return { Authorization: `Bearer ${token}` }
}

async function post(path, body) {
  const headers = { 'content-type': 'application/json', ...(await authHeader()) }
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    // A non-JSON body means something upstream failed before the handler ran.
  }

  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed (${response.status})`)
    error.status = response.status
    error.payload = payload
    // Carried up so the upload queue can pause rather than fail the batch.
    if (Number.isFinite(payload?.retryAfter)) error.retryAfter = payload.retryAfter
    if (payload?.quotaScope) error.quotaScope = payload.quotaScope
    throw error
  }
  return payload
}

/** Runs one image through the vision model. Writes nothing. */
export function extractReceipt({ image, mimeType, itemKeys }) {
  return post('/api/extract-receipt', { image, mimeType, itemKeys })
}

/**
 * Saves an extraction as one or more service records.
 * Resolves with `{ records, receiptGroup, mileageConflict }`.
 */
export function saveRecord({ vehicleId, extraction, source }) {
  return post('/api/save-record', { vehicleId, extraction, source })
}
