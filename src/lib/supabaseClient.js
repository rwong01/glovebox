import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Whether real credentials have been pasted in yet.
 *
 * The placeholder values from `.env.local.example` count as unconfigured, so a
 * fresh clone shows a setup screen explaining what to do rather than a white
 * page and a console error.
 */
export const isSupabaseConfigured = Boolean(
  url && anonKey && !url.startsWith('your-') && !anonKey.startsWith('your-'),
)

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
