/**
 * Reduces a Supabase project URL to its bare origin.
 *
 * Worth its own module because the failure it prevents is genuinely baffling.
 * The dashboard shows the project URL next to REST endpoint examples like
 * `https://<ref>.supabase.co/rest/v1/`, and copying the latter is an easy
 * mistake. supabase-js derives every other endpoint by appending to whatever it
 * is handed, so auth calls then go to `/rest/v1/auth/v1/otp` and fail with
 * "Invalid path specified in request URL" — an error that points at the path
 * and says nothing about the setting that caused it.
 *
 * Trailing slashes, paths, query strings and fragments are all discarded.
 * Returns null for anything unusable, which callers treat as "not configured"
 * and surface as the setup screen.
 */
export function normaliseSupabaseUrl(raw) {
  if (typeof raw !== 'string') return null

  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('your-')) return null

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null // not a URL at all
  }
}

/** Trims a pasted key. Copying from a dashboard often brings a newline along. */
export function normaliseSupabaseKey(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('your-')) return null
  return trimmed
}
