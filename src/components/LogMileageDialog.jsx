import { useState } from 'react'

import { createServiceRecord } from '../lib/db.js'
import { toISODate } from '../lib/dates.js'
import { Button } from './ui/Button.jsx'
import { Dialog } from './ui/Dialog.jsx'
import { Field, Input } from './ui/Field.jsx'
import { ErrorNote } from './ui/States.jsx'

/**
 * Logs a bare odometer reading — no receipt, no service performed.
 *
 * This is the only way current mileage moves by hand. There is no "set
 * current mileage" field to edit directly: a number with no date can't say
 * anything about driving pace, while a dated reading slots right in next to
 * every scanned record and lets the flag list work out what a service item
 * last done months ago likely needs now, assuming nothing else happened
 * in between (if it had, that visit would show up as its own record).
 *
 * The vehicle's `current_mileage` still ratchets up automatically — the same
 * database trigger that reacts to a scanned receipt fires for this record.
 */
export function LogMileageDialog(props) {
  // Remounting on open resets the fields to a fresh today/blank pair, same
  // reasoning as the other dialogs in this app.
  return <LogMileageForm key={props.open ? 'open' : 'closed'} {...props} />
}

function LogMileageForm({ open, onOpenChange, vehicleId, onSaved }) {
  const [date, setDate] = useState(() => toISODate(new Date()))
  const [mileage, setMileage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)

    const value = Number(mileage)
    if (!mileage || !Number.isFinite(value) || value <= 0) {
      setError('Enter a valid odometer reading.')
      return
    }

    setBusy(true)
    try {
      await createServiceRecord({
        vehicle_id: vehicleId,
        service_date: date || null,
        service_type: 'odometer_reading',
        mileage_at_service: value,
        source: 'manual',
      })
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not save that reading.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title="Log a mileage reading"
      description="Just the odometer — this calibrates your driving pace so the flag list can tell what's likely due since your last service."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button form="log-mileage" type="submit" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="log-mileage" onSubmit={onSubmit} className="flex flex-col gap-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            {({ id }) => (
              <Input
                id={id}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label="Odometer">
            {({ id }) => (
              <Input
                id={id}
                autoFocus
                type="number"
                inputMode="numeric"
                min={0}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="84210"
                required
              />
            )}
          </Field>
        </div>

        <ErrorNote>{error}</ErrorNote>
      </form>
    </Dialog>
  )
}
