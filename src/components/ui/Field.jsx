import { useId } from 'react'

import { cn } from '../../lib/cn.js'

const CONTROL = cn(
  'w-full rounded-lg bg-surface text-fg border border-line-strong',
  'px-3 py-2.5 text-base placeholder:text-muted/70',
  'transition-colors focus:border-accent focus:outline-none',
  'disabled:opacity-60',
)

/** Label + control + hint/error, wired up with the right ids for screen readers. */
export function Field({ label, hint, error, children, className, htmlFor }) {
  const generated = useId()
  const id = htmlFor ?? generated
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
      ) : null}

      {typeof children === 'function' ? children({ id, describedBy }) : children}

      {error ? (
        <p id={`${id}-error`} className="text-sm text-bad-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, invalid, ...props }) {
  return (
    <input
      className={cn(CONTROL, invalid && 'border-bad', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

export function Textarea({ className, rows = 3, ...props }) {
  return <textarea rows={rows} className={cn(CONTROL, 'resize-y', className)} {...props} />
}

/**
 * A plain native select on purpose: on a phone this opens the OS picker, which
 * beats any custom dropdown for one-handed use.
 */
export function Select({ className, children, ...props }) {
  return (
    <select className={cn(CONTROL, 'appearance-none pr-8', className)} {...props}>
      {children}
    </select>
  )
}
