import { useState } from 'react'

import { Button } from '../components/ui/Button.jsx'
import { Field, Input } from '../components/ui/Field.jsx'
import { ErrorNote } from '../components/ui/States.jsx'
import { useAuth } from '../hooks/useAuth.js'

const MODES = {
  signin: { title: 'Sign in', submit: 'Sign in' },
  signup: { title: 'Create an account', submit: 'Create account' },
  magic: { title: 'Sign in', submit: 'Email me a link' },
}

export default function Login() {
  const { signIn, signUp, sendMagicLink } = useAuth()

  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const usesPassword = mode !== 'magic'

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)

    try {
      if (mode === 'magic') {
        const { error: err } = await sendMagicLink(email)
        if (err) throw err
        setNotice(`Check ${email} for a sign-in link.`)
      } else if (mode === 'signup') {
        const { data, error: err } = await signUp(email, password)
        if (err) throw err
        // With email confirmation on, there is no session yet — say so rather
        // than leaving the user staring at an unchanged form.
        if (!data?.session) setNotice(`Check ${email} to confirm your address.`)
      } else {
        const { error: err } = await signIn(email, password)
        if (err) throw err
      }
    } catch (err) {
      setError(err.message || 'That did not work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight text-fg">Glovebox</h1>
          <p className="mt-1.5 text-muted">
            Your car's service history, and what actually needs attention.
          </p>
        </header>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Email">
            {({ id }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            )}
          </Field>

          {usesPassword ? (
            <Field
              label="Password"
              hint={mode === 'signup' ? 'At least 6 characters.' : undefined}
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
          ) : null}

          <ErrorNote>{error}</ErrorNote>
          {notice ? (
            <p role="status" className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-muted">
              {notice}
            </p>
          ) : null}

          <Button type="submit" size="lg" loading={busy} className="mt-1 justify-center">
            {MODES[mode].submit}
          </Button>
        </form>

        <div className="mt-6 flex flex-col gap-2 text-sm">
          <button
            type="button"
            className="text-left text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
            onClick={() => {
              setMode(mode === 'magic' ? 'signin' : 'magic')
              setError(null)
              setNotice(null)
            }}
          >
            {mode === 'magic' ? 'Use a password instead' : 'Email me a sign-in link instead'}
          </button>

          {mode !== 'magic' ? (
            <button
              type="button"
              className="text-left text-muted underline-offset-4 transition-colors hover:text-fg hover:underline"
              onClick={() => {
                setMode(mode === 'signup' ? 'signin' : 'signup')
                setError(null)
                setNotice(null)
              }}
            >
              {mode === 'signup' ? 'I already have an account' : "I don't have an account yet"}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  )
}
