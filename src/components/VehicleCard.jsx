import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { STATUS } from '../lib/flagging.js'
import { formatOdometer } from '../lib/format.js'
import { cn } from '../lib/cn.js'

const DOT = {
  [STATUS.RED]: 'bg-bad',
  [STATUS.YELLOW]: 'bg-warn',
  [STATUS.GREEN]: 'bg-ok',
}

export function VehicleCard({ vehicle, summary }) {
  const subtitle = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')

  return (
    <li>
      <Link
        to={`/vehicle/${vehicle.id}`}
        className="flex items-center gap-4 rounded-xl border border-line bg-surface px-4 py-4 transition-colors hover:bg-surface-raised"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-semibold tracking-tight text-fg">
            {vehicle.nickname}
          </p>
          <p className="mt-0.5 truncate text-sm text-muted">
            {subtitle || 'No details yet'}
            {vehicle.current_mileage > 0 ? ` · ${formatOdometer(vehicle.current_mileage)}` : ''}
          </p>
          <StatusLine summary={summary} />
        </div>

        <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
      </Link>
    </li>
  )
}

function StatusLine({ summary }) {
  if (!summary) return null

  const { red, yellow } = summary
  if (red === 0 && yellow === 0) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', DOT.green)} />
        Nothing needs attention
      </p>
    )
  }

  const parts = []
  if (red > 0) parts.push(`${red} overdue`)
  if (yellow > 0) parts.push(`${yellow} coming up`)

  return (
    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', red > 0 ? DOT.red : DOT.yellow)}
      />
      {parts.join(', ')}
    </p>
  )
}
