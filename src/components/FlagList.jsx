import { useState } from 'react'

import { STATUS } from '../lib/flagging.js'
import { formatMiles } from '../lib/format.js'
import { Card } from './ui/Card.jsx'
import { FlagItem } from './FlagItem.jsx'

/**
 * The vehicle page's hero: everything that needs attention, in one list.
 *
 * Green and unknown rows are collapsed behind a toggle by default. The page's
 * job is to answer "what needs attention", and eight rows of "fine" pushes that
 * answer below the fold.
 */
export function FlagList({ result }) {
  const [showAll, setShowAll] = useState(false)
  const { flags, pace, odometer } = result

  const attention = flags.filter(
    (f) => f.status === STATUS.RED || f.status === STATUS.YELLOW,
  )
  const rest = flags.filter((f) => f.status === STATUS.GREEN || f.status === STATUS.UNKNOWN)
  const visible = showAll ? flags : attention

  return (
    <section aria-label="Inspection">
      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((flag) => (
              <FlagItem key={flag.itemKey} flag={flag} />
            ))}
          </ul>
        )}

        {rest.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full border-t border-line px-4 py-3 text-left text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg"
          >
            {showAll
              ? 'Hide items that are fine'
              : `Show ${rest.length} more ${rest.length === 1 ? 'item' : 'items'} that are fine or untracked`}
          </button>
        ) : null}
      </Card>

      <PaceNote pace={pace} odometer={odometer} />
    </section>
  )
}

/**
 * Says out loud what the projections rest on. Every date above is derived from
 * this number, so hiding it would make the list feel like an oracle.
 */
function PaceNote({ pace, odometer }) {
  const perMonth = Math.round(pace.milesPerMonth)

  const text =
    pace.confidence === 'assumed'
      ? `Projections assume ${formatMiles(perMonth)} miles a month — log two dated records to measure your real pace.`
      : perMonth === 0
        ? 'Your records show no miles added lately, so only time-based items are counted.'
        : `Based on your pace of about ${formatMiles(perMonth)} miles a month${
            odometer.projectedMiles > 0
              ? `, putting you near ${formatMiles(odometer.miles)} mi today`
              : ''
          }.`

  return <p className="mt-3 px-1 text-xs leading-relaxed text-muted">{text}</p>
}
