import { cn } from '../../lib/cn.js'

export function Card({ className, as: Component = 'div', ...props }) {
  return (
    <Component
      className={cn('rounded-xl border border-line bg-surface', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }) {
  return <div className={cn('px-4 pt-4 pb-3 sm:px-5', className)} {...props} />
}

export function CardBody({ className, ...props }) {
  return <div className={cn('px-4 pb-4 sm:px-5', className)} {...props} />
}

export function SectionTitle({ className, children, action }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className={cn('font-display text-lg font-semibold tracking-tight text-fg', className)}>
        {children}
      </h2>
      {action}
    </div>
  )
}
