import { useCallback, useEffect, useMemo, useState } from 'react'

import { THEME_STORAGE_KEY, ThemeContext } from './themeContext.js'

function readStored() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    return saved === 'dark' || saved === 'light' ? saved : null
  } catch {
    return null // private browsing, or storage disabled
  }
}

function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Light/dark with a system default.
 *
 * `index.html` applies the class before first paint so there is no white flash;
 * this provider takes over from there and keeps the choice in localStorage.
 */
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => readStored() ?? (systemPrefersDark() ? 'dark' : 'light'))
  const [explicit, setExplicit] = useState(() => readStored() != null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Follow the OS until the user states a preference of their own.
  useEffect(() => {
    if (explicit) return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event) => setTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [explicit])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // Not being able to remember the choice is not worth failing over.
      }
      return next
    })
    setExplicit(true)
  }, [])

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
