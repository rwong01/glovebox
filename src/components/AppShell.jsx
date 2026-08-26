import { Link } from 'react-router-dom'
import { LogOut, Moon, Sun } from 'lucide-react'

import { useAuth } from '../hooks/useAuth.js'
import { useTheme } from '../hooks/useTheme.js'
import { cn } from '../lib/cn.js'

/**
 * The frame around every signed-in page.
 *
 * Kept deliberately quiet. The flag rows are what this app should be
 * remembered for, so the chrome around them stays out of the way: a wordmark,
 * two icon buttons, no navigation bar to speak of.
 */
export function AppShell({ children, className }) {
  const { theme, toggle } = useTheme()
  const { signOut } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="rounded-md font-display text-lg font-bold tracking-tight text-fg"
          >
            Glovebox
          </Link>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              className="rounded-lg p-2.5 text-muted transition-colors hover:bg-surface-raised hover:text-fg"
            >
              {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="rounded-lg p-2.5 text-muted transition-colors hover:bg-surface-raised hover:text-fg"
            >
              <LogOut size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className={cn('mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-16 sm:px-6', className)}>
        {children}
      </main>
    </div>
  )
}
