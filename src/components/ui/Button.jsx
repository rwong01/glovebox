import { cn } from '../../lib/cn.js'

const VARIANTS = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-hover',
  secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-raised',
  ghost: 'text-muted hover:text-fg hover:bg-surface-raised',
  danger: 'bg-transparent text-bad-text border border-bad/40 hover:bg-bad-soft',
}

// Every size clears the 44px touch target on the smallest screens; this is a
// phone-first app and the buttons sit near the bottom of the viewport.
const SIZES = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
  icon: 'h-10 w-10 justify-center',
}

/**
 * `as` lets a router <Link> wear the button styling without a Slot dependency
 * and without nesting an <a> inside a <button>.
 */
export function Button({
  as: Component = 'button',
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  disabled,
  loading,
  children,
  ...props
}) {
  const isButton = Component === 'button'
  return (
    <Component
      type={isButton ? type : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-disabled={!isButton && (disabled || loading) ? true : undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center rounded-lg font-medium transition-colors select-none',
        'disabled:opacity-50 disabled:pointer-events-none',
        VARIANTS[variant] ?? VARIANTS.primary,
        SIZES[size] ?? SIZES.md,
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </Component>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  )
}
