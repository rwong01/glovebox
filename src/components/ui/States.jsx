import { cn } from '../../lib/cn.js'

/**
 * Empty states are one line and one button, deliberately.
 *
 * No placeholder illustrations and no filler copy: an empty garage should look
 * like a thing waiting for input, not a marketing page.
 */
export function EmptyState({ message, action, className }) {
  return (
    <div className={cn('flex flex-col items-center gap-4 px-6 py-14 text-center', className)}>
      <p className="max-w-xs text-balance text-muted">{message}</p>
      {action}
    </div>
  )
}

export function ErrorNote({ children, className }) {
  if (!children) return null
  return (
    <p
      role="alert"
      className={cn(
        'rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad-text',
        className,
      )}
    >
      {children}
    </p>
  )
}

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-flex', className)}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
    </span>
  )
}

/** Placeholder block used while a page's first fetch is in flight. */
export function Skeleton({ className }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-raised', className)} />
}
