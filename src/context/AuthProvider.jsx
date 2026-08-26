import { useCallback, useEffect, useMemo, useState } from 'react'

import { supabase } from '../lib/supabaseClient.js'
import { AuthContext } from './authContext.js'

/**
 * Holds the Supabase session.
 *
 * Real auth is here from day one even though there is one user. Because the
 * schema already scopes every row by `owner_id` and RLS already enforces it,
 * adding family sharing later is an invite flow and nothing else — no schema
 * migration, no change to any query in this app.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data?.session ?? null)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => {
      active = false
      subscription?.subscription?.unsubscribe()
    }
  }, [])

  const signIn = useCallback(
    (email, password) => supabase.auth.signInWithPassword({ email, password }),
    [],
  )

  const signUp = useCallback(
    (email, password) =>
      supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      }),
    [],
  )

  const sendMagicLink = useCallback(
    (email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      }),
    [],
  )

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const value = useMemo(
    () => ({ session, user: session?.user ?? null, loading, signIn, signUp, sendMagicLink, signOut }),
    [session, loading, signIn, signUp, sendMagicLink, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
