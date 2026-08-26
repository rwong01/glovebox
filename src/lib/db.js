/**
 * Every Supabase query the browser makes, in one place.
 *
 * No query filters by owner. It does not need to: row-level security scopes
 * each of these tables to the signed-in user in the database itself, so
 * `select * from vehicles` returns exactly this user's garage. Adding a
 * client-side owner filter would imply the security lives here, which it
 * does not.
 */
import { supabase } from './supabaseClient.js'

function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// --- rules -----------------------------------------------------------------

export async function listServiceRules() {
  return unwrap(await supabase.from('service_rules').select('*').order('sort_order'))
}

export async function listRuleOverrides(vehicleId) {
  const query = supabase.from('vehicle_service_rules').select('*')
  return unwrap(await (vehicleId ? query.eq('vehicle_id', vehicleId) : query))
}

// --- vehicles --------------------------------------------------------------

export async function listVehicles() {
  return unwrap(await supabase.from('vehicles').select('*').order('created_at'))
}

export async function createVehicle(vehicle, ownerId) {
  return unwrap(
    await supabase
      .from('vehicles')
      .insert({ ...vehicle, owner_id: ownerId })
      .select()
      .single(),
  )
}

export async function updateVehicle(id, patch) {
  return unwrap(await supabase.from('vehicles').update(patch).eq('id', id).select().single())
}

export async function deleteVehicle(id) {
  return unwrap(await supabase.from('vehicles').delete().eq('id', id))
}

// --- records ---------------------------------------------------------------

export async function listServiceRecords(vehicleId) {
  const query = supabase
    .from('service_records')
    .select('*')
    .order('service_date', { ascending: false })
  return unwrap(await (vehicleId ? query.eq('vehicle_id', vehicleId) : query))
}

export async function createServiceRecord(row) {
  return unwrap(await supabase.from('service_records').insert(row).select().single())
}

export async function updateServiceRecord(id, patch) {
  return unwrap(await supabase.from('service_records').update(patch).eq('id', id).select().single())
}

export async function deleteServiceRecord(id) {
  return unwrap(await supabase.from('service_records').delete().eq('id', id))
}

/**
 * Applies the same change to every record in one visit, in a single statement.
 *
 * A visit's date, odometer and shop belong to the visit, not to each line item
 * under it — one trip where four things were done has one date. Editing them
 * row by row is both tedious and a way to split a visit in half by fixing three
 * of its four rows.
 */
export async function updateServiceRecords(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  return unwrap(await supabase.from('service_records').update(patch).in('id', ids).select())
}

export async function deleteServiceRecords(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  return unwrap(await supabase.from('service_records').delete().in('id', ids))
}
