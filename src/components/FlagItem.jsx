import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

import { STATUS } from '../lib/flagging.js'
import { cn } from '../lib/cn.js'

/**
 * One row of the inspection list — the thing this app exists to produce.
 *
 * The mark is a colour bar down the left edge rather than a filled badge:
 * quieter, and it reads like a real multi-point inspection sheet instead of a
 * marketing dashboard.
 *
 * Colour is never the only signal. The sentence itself says why ("past the
 * 12-month limit" against "next due around Feb 2028"), red rows sort to the
 * top, and the status word is announced to screen readers. Someone who cannot
 * distinguish the bar colours loses nothing.
 */

const BAR = {
  [STATUS.RED]: 'bg-bad',
  [STATUS.YELLOW]: 'bg-warn',
  [STATUS.GREEN]: 'bg-ok',
  [STATUS.UNKNOWN]: 'bg-line-strong',
}

const SPOKEN = {
  [STATUS.RED]: 'Needs attention',
  [STATUS.YELLOW]: 'Coming up',
  [STATUS.GREEN]: 'Fine',
  [STATUS.UNKNOWN]: 'No record',
}

export function FlagItem({ flag }) {
  const [open, setOpen] = useState(false)
  const extra = [flag.detail, flag.ruleNotes].filter(Boolean)
  const expandable = extra.length > 0

  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="font-medium text-fg">{flag.displayName}</span>
          <span className="sr-only">— {SPOKEN[flag.status]}.</span>
          {flag.isCustomised ? (
            <span
              title="Using a custom interval for this vehicle"
              className="rounded border border-line px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted"
            >
              custom
            </span>
          ) : null}
        </span>

        <span className="text-sm leading-snug text-muted">{flag.reason}</span>

        {open
          ? extra.map((line) => (
              <span key={line} className="mt-1.5 text-sm leading-snug text-muted/85">
                {line}
              </span>
            ))
          : null}
      </span>

      {expandable ? (
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('mt-1 shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      ) : null}
    </>
  )

  const inner = 'flex w-full items-start gap-3 py-3 pl-4 pr-3 text-left'

  return (
    <li className="relative">
      {/* Absolutely positioned, so it stays visible over the row's hover fill. */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px]', BAR[flag.status] ?? BAR.unknown)}
      />

      {expandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(inner, 'transition-colors hover:bg-surface-raised')}
        >
          {content}
        </button>
      ) : (
        <div className={inner}>{content}</div>
      )}
    </li>
  )
}
