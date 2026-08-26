import { useState } from 'react'

import { updateVehicle } from '../lib/db.js'
import { formatMiles } from '../lib/format.js'
import { Button } from './ui/Button.jsx'
import { Dialog } from './ui/Dialog.jsx'
import { Field, Input } from './ui/Field.jsx'
import { ErrorNote } from './ui/States.jsx'

/**
 * Shown when a scan reads an odometer LOWER than what is on file.
 *
 * This is the one point in the scanning flow that stops to ask. Everywhere else
 * records save without review, because a wrong line item is easy to spot and
 * fix later. A wrong odometer is different: it silently distorts the driving
 * pace, and the pace is what every projection in the app is built on.
 *
 * The record itself has already been saved by this point — only the vehicle's
 * current mileage is in question.
 */
export function MileageConflictDialog(props) {
  if (!props.conflict) return null
  // Remount per conflict so the input starts from the right reading without an
  // effect writing state back on open.
  return <MileageConflictForm key={props.open ? 'open' : 'closed'} {...props} />
}

function MileageConflictForm({ open, onOpenChange, conflict, vehicle, onResolved }) {
  const [value, setValue] = useState(() => String(conflict.current))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function accept(mileage) {
    setBusy(true)
    setError(null)
    try {
      await updateVehicle(vehicle.id, { current_mileage: mileage })
      onOpenChange(false)
      onResolved?.()
    } catch (err) {
      setError(err.message || 'Could not update the odometer.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title="That mileage looks off"
      description="The record was saved either way — this is only about the odometer on file."
      footer={
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              onOpenChange(false)
              onResolved?.()
            }}
          >
            Leave it alone
          </Button>
          <Button loading={busy} onClick={() => accept(Number(value))}>
            Update odometer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Reading label="On file" value={conflict.current} />
          <Reading label="Just scanned" value={conflict.extracted} muted />
        </div>

        <p className="text-sm leading-relaxed text-muted">
          A lower reading usually means one of two things: an older receipt being scanned out of
          order, which is fine and needs nothing from you, or a misread digit. Nothing has been
          overwritten.
        </p>

        <Field
          label="Correct odometer reading"
          hint="Only change this if the number on file is genuinely wrong."
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="number"
              inputMode="numeric"
              min={0}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>

        <ErrorNote>{error}</ErrorNote>
      </div>
    </Dialog>
  )
}

function Reading({ label, value, muted }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised px-3 py-2.5">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 tnum text-lg font-semibold ${muted ? 'text-muted' : 'text-fg'}`}>
        {formatMiles(value)}
      </p>
    </div>
  )
}
