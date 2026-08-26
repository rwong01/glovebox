import { useState } from 'react'

import { createVehicle, deleteVehicle, updateVehicle } from '../lib/db.js'
import { useAuth } from '../hooks/useAuth.js'
import { Button } from './ui/Button.jsx'
import { Dialog } from './ui/Dialog.jsx'
import { Field, Input } from './ui/Field.jsx'
import { ErrorNote } from './ui/States.jsx'

const BLANK = { nickname: '', make: '', model: '', year: '' }

const toForm = (vehicle) => ({
  nickname: vehicle.nickname ?? '',
  make: vehicle.make ?? '',
  model: vehicle.model ?? '',
  year: vehicle.year ?? '',
})

/** Add or edit a vehicle. Pass `vehicle` to edit, omit it to create. */
export function VehicleDialog(props) {
  // Remounting on open is what resets the fields to the current vehicle. The
  // alternative — an effect that calls setState when `open` flips — causes a
  // cascading render and is exactly what React's own guidance warns against.
  return <VehicleDialogForm key={props.open ? 'open' : 'closed'} {...props} />
}

function VehicleDialogForm({ open, onOpenChange, vehicle, onSaved, onDeleted }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => (vehicle ? toForm(vehicle) : BLANK))
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState(null)

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const payload = {
      nickname: form.nickname.trim(),
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      year: form.year ? Number(form.year) : null,
    }

    try {
      const saved = vehicle
        ? await updateVehicle(vehicle.id, payload)
        : await createVehicle(payload, user.id)
      onOpenChange(false)
      onSaved?.(saved)
    } catch (err) {
      setError(err.message || 'Could not save that vehicle.')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    // Deleting a vehicle cascades to its whole service history, so it asks once.
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteVehicle(vehicle.id)
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      setError(err.message || 'Could not delete that vehicle.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={vehicle ? 'Edit vehicle' : 'Add a vehicle'}
      description={vehicle ? undefined : 'Only the nickname is required — the rest can wait.'}
      footer={
        <>
          {vehicle ? (
            <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">
              {confirmingDelete ? 'Delete everything?' : 'Delete'}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button form="vehicle-form" type="submit" loading={busy}>
            {vehicle ? 'Save' : 'Add vehicle'}
          </Button>
        </>
      }
    >
      <form id="vehicle-form" onSubmit={onSubmit} className="flex flex-col gap-4 pb-4">
        <Field label="Nickname">
          {({ id }) => (
            <Input
              id={id}
              required
              autoFocus={!vehicle}
              value={form.nickname}
              onChange={set('nickname')}
              placeholder="The Civic"
            />
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Make">
            {({ id }) => <Input id={id} value={form.make} onChange={set('make')} placeholder="Honda" />}
          </Field>
          <Field label="Model">
            {({ id }) => <Input id={id} value={form.model} onChange={set('model')} placeholder="Civic" />}
          </Field>
        </div>

        <Field label="Year">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={1900}
              max={2100}
              value={form.year}
              onChange={set('year')}
              placeholder="2016"
            />
          )}
        </Field>

        {confirmingDelete ? (
          <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad-text">
            This removes the vehicle and every service record attached to it. Press delete again to
            confirm.
          </p>
        ) : null}

        <ErrorNote>{error}</ErrorNote>
      </form>
    </Dialog>
  )
}
