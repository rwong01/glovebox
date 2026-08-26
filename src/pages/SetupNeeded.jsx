/**
 * Shown when `.env.local` still holds the placeholder values.
 *
 * A fresh clone would otherwise fail somewhere deep in the Supabase client with
 * a message that says nothing about what to do. This says what to do.
 */
export default function SetupNeeded() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 bg-bg px-5 py-12">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
          Glovebox needs its keys
        </h1>
        <p className="mt-2 text-muted">
          Three values, one file. Nothing else needs configuring.
        </p>
      </div>

      <ol className="flex flex-col gap-4 text-sm text-fg">
        <li className="flex gap-3">
          <Step n={1} />
          <div>
            <p className="font-medium">Copy the example file</p>
            <Code>cp .env.local.example .env.local</Code>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div>
            <p className="font-medium">Paste in your Supabase URL and anon key</p>
            <p className="mt-1 text-muted">
              Supabase dashboard → Project Settings → Data API, and → API Keys.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <div>
            <p className="font-medium">Paste in a Gemini API key</p>
            <p className="mt-1 text-muted">
              From{' '}
              <a
                className="text-accent underline underline-offset-4"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Google AI Studio
              </a>
              . Only needed for scanning receipts.
            </p>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={4} />
          <div>
            <p className="font-medium">Run the database schema</p>
            <p className="mt-1 text-muted">
              Paste <Code inline>supabase/schema.sql</Code> into the Supabase SQL Editor and run it
              once.
            </p>
          </div>
        </li>
      </ol>

      <p className="border-t border-line pt-5 text-sm text-muted">
        Then restart the dev server — Vite only reads <Code inline>.env.local</Code> at startup.
      </p>
    </main>
  )
}

function Step({ n }) {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
    >
      {n}
    </span>
  )
}

function Code({ children, inline }) {
  return (
    <code
      className={
        inline
          ? 'rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.85em] text-fg'
          : 'mt-1.5 block rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[0.85em] text-fg'
      }
    >
      {children}
    </code>
  )
}
