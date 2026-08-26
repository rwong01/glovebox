/**
 * Server-side Supabase access for the serverless functions.
 *
 * The `_` prefix keeps this out of Vercel's route table — it is a helper, not
 * an endpoint.
 *
 * There is deliberately no service_role key anywhere in this project. Each
 * request builds a client carrying the caller's own JWT, so every query runs
 * under the same row-level security policies as the browser. A bug here cannot
 * leak another user's data, because the database itself will not return it.
 */
import { createClient } from '@supabase/supabase-js'

/**
 * Vite exposes VITE_-prefixed vars to the browser; Vercel exposes every var to
 * functions. Reading the VITE_ names here is what keeps the setup promise
 * honest: three values in one file, no duplicates under a second name.
 */
function config() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw Object.assign(
      new Error('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.'),
      { statusCode: 503 },
    )
  }
  return { url, anonKey }
}

export function bearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

/**
 * Returns `{ supabase, user }` for the caller, or throws 401.
 *
 * Authenticating on every route matters for more than data access: it is also
 * what stops an unauthenticated caller from spending the project's Gemini quota.
 */
export async function requireUser(req) {
  const token = bearerToken(req)
  if (!token) {
    throw Object.assign(new Error('Not signed in.'), { statusCode: 401 })
  }

  const { url, anonKey } = config()
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data?.user) {
    throw Object.assign(new Error('Session expired. Sign in again.'), { statusCode: 401 })
  }

  return { supabase, user: data.user }
}

/** Uniform error shape, so the client can render `error` without unwrapping. */
export function sendError(res, err) {
  const status = err?.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
  if (status >= 500) console.error(err)
  return res.status(status).json({ error: err?.message || 'Something went wrong.' })
}

export function methodGuard(req, res, allowed = 'POST') {
  if (req.method === allowed) return true
  res.setHeader('Allow', allowed)
  res.status(405).json({ error: `Use ${allowed}.` })
  return false
}
