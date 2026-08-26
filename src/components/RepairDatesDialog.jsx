import { useMemo, useState } from 'react'
import { ArrowRight } from 'lucide-react'

import { updateServiceRecord } from '../lib/db.js'
import { formatDay } from '../lib/dates.js'
import { formatMiles } from '../lib/format.js'
import { REPAIR_REASONS, proposeDateRepairs, summariseRepairs } from '../lib/repairDates.js'
import { Button } from './ui/Button.jsx'
import { Dialog } from './ui/Dialog.jsx'
import { ErrorNote } from './ui/States.jsx'

/**
 * Re-reads service dates out of transcriptions already in the database.
 *
 * Records scanned before the date parsing was fixed either lost their date to
 * a validator that accepted only zero-padded ISO, or had the day of the scan
 * substituted because the column was NOT NULL. Both are recoverable without
 * re-scanning anything: `raw_notes` holds the full text of every page, so the
 * date is already stored — it just was not read correctly.
 *
 * Shows exactly what it would change before changing it. A wrong date is worse
 * than a missing one, so this is not a thing to apply blind.
 */
export function RepairDatesDialog({ open, onOpenChange, records, onRepaired }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const proposals = useMemo(() => proposeDateRepairs(records), [records])
  const summary = useMemo(() => summariseRepairs(proposals), [proposals])

  async function apply() {
    setBusy(true)
    setError(null)
    let applied = 0
    try {
      // Sequential rather than parallel: a couple of hundred small updates is
      // not worth hammering the connection pool for, and a partial failure
      // leaves a clear count of what did land.
      for (const proposal of proposals) {
        await updateServiceRecord(proposal.id, { service_date: proposal.to })
        applied += 1
      }
      onRepaired?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        `${err.message || 'Something went wrong.'} ${applied} of ${proposals.length} records were updated before it stopped.`,
      )
    } finally {
      setBusy(false)
    }
  }

  const substituted = proposals.filter((p) => p.reason === REPAIR_REASONS.SUBSTITUTED).length
  const missing = proposals.length - substituted

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title="Recover dates from your scans"
      description="Read back out of the text already saved with each record. Nothing is re-scanned."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={apply} loading={busy} disabled={proposals.length === 0}>
            {proposals.length > 0 ? `Update ${proposals.length} records` : 'Nothing to fix'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        {proposals.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted">
            Nothing to recover. Either the dates are already right, or the transcriptions do not
            contain a date to read — in which case the service log is the place to fill them in by
            hand.
          </p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-muted">
              {substituted > 0 ? (
                <>
                  <strong className="font-medium text-fg">{substituted}</strong> records are dated
                  the day you scanned them, which is the old fallback rather than a real date.{' '}
                </>
              ) : null}
              {missing > 0 ? (
                <>
                  <strong className="font-medium text-fg">{missing}</strong>{' '}
                  {missing === 1 ? 'has no date but has' : 'have no date but have'} one in the
                  scanned text.{' '}
                </>
              ) : null}
              Here is what would change:
            </p>

            <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-line">
              {summary.map((entry) => (
                <li
                  key={`${entry.from}-${entry.to}`}
                  className="flex items-center gap-3 bg-surface px-3 py-2.5 text-sm"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 tnum">
                    <span className={entry.from ? 'text-muted line-through' : 'text-muted'}>
                      {entry.from ? formatDay(entry.from) : 'no date'}
                    </span>
                    <ArrowRight size={13} aria-hidden="true" className="shrink-0 text-muted" />
                    <span className="font-medium text-fg">{formatDay(entry.to)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted tnum">
                    {[
                      entry.mileage != null ? `${formatMiles(entry.mileage)} mi` : null,
                      `${entry.count} ${entry.count === 1 ? 'item' : 'items'}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>

            <p className="text-xs leading-relaxed text-muted">
              Dates are taken from the first one printed on each page, which on a service invoice is
              the invoice date. Anything that still looks wrong afterwards is editable from the
              service log.
            </p>
          </>
        )}

        <ErrorNote>{error}</ErrorNote>
      </div>
    </Dialog>
  )
}
