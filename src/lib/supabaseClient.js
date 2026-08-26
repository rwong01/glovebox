import { createClient } from '@supabase/supabase-js'

import { normaliseSupabaseKey, normaliseSupabaseUrl } from './supabaseUrl.js'

// Normalised rather than used raw: a project URL copied with `/rest/v1` on the
// end sends every auth call to `/rest/v1/auth/v1/...`, and a key copied with a
// trailing newline reads as invalid. Both are silent traps otherwise.
const url = normaliseSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const anonKey = normaliseSupabaseKey(import.meta.env.VITE_SUPABASE_ANON_KEY)

/**
 * Whether real credentials have been pasted in yet.
 *
 * The placeholder values from `.env.local.example` count as unconfigured, so a
 * fresh clone shows a setup screen explaining what to do rather than a white
 * page and a console error.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Needed for the magic-link callback, which lands back on the app with
        // the session in the URL fragment.
        detectSessionInUrl: true,
      },
    })
  : null
