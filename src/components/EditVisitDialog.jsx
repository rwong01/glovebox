import { useState } from 'react'

import { deleteServiceRecords, updateServiceRecords } from '../lib/db.js'
import { Button } from './ui/Button.jsx'
import { Dialog } from './ui/Dialog.jsx'
import { Field, Input } from './ui/Field.jsx'
import { ErrorNote } from './ui/States.jsx'

/**
 * Edits the things a whole visit shares.
 *
 * A trip to the shop has one date, one odometer reading and one shop name, no
 * matter how many line items came out of it. Storing those on each record is
 * right for the flagging engine — it needs to ask "when was the oil last
 * done" — but editing them per record would be both tedious and a way to
 * accidentally split one visit into several by correcting three rows of four.
 *
 * So this writes to every record in the visit at once. What stays per-record
 * is what genuinely differs between line items: the service type, its cost,
 * its measurement.
 */
export function EditVisitDialog(props) {
  if (!props.visit) return null
  // Remount per visit so the fields start from that visit's values.
  return <EditVisitForm key={props.open ? props.visit.key : 'closed'} {...props} />
}

function EditVisitForm({ open, onOpenChange, visit, names, onSaved }) {
  const [form, setForm] = useState(() => ({
    service_date: visit.date ?? '',
    mileage_at_service: visit.mileage ?? '',
    vendor: visit.vendor ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState(null)

  // Every record in the visit, INCLUDING the repeated rows hidden from the log.
  // Skipping those would leave them behind on the old date, which would split
  // them off into a visit of their own — the exact thing this dialog prevents.
  const duplicates = visit.duplicates ?? []
  const ids = visit.records.concat(duplicates).map((r) => r.id)
  const count = visit.records.length
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await updateServiceRecords(ids, {
        service_date: form.service_date || null,
        mileage_at_service: form.mileage_at_service === '' ? null : Number(form.mileage_at_service),
        vendor: form.vendor.trim() || null,
      })
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not update this visit.')
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveDuplicates() {
    setBusy(true)
    setError(null)
    try {
      await deleteServiceRecords(duplicates.map((r) => r.id))
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not remove the repeated rows.')
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteServiceRecords(ids)
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not delete this visit.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title="Edit visit"
      description={
        `Applies to all ${count} ${count === 1 ? 'item' : 'items'} from this visit` +
        (duplicates.length
          ? `, and to the ${duplicates.length} repeated ${duplicates.length === 1 ? 'row' : 'rows'} behind them.`
          : '.')
      }
      footer={
        <>
          <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">
            {confirmingDelete ? `Delete all ${ids.length}?` : 'Delete visit'}
          </Button>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button form="edit-visit" type="submit" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-visit" onSubmit={onSubmit} className="flex flex-col gap-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Date"
            hint={visit.date ? undefined : 'This visit has no date yet.'}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="date"
                autoFocus
                value={form.service_date}
                onChange={set('service_date')}
              />
            )}
          </Field>
          <Field label="Odometer">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={0}
                value={form.mileage_at_service}
                onChange={set('mileage_at_service')}
                placeholder="84210"
              />
            )}
          </Field>
        </div>

        <Field label="Shop">
          {({ id }) => (
            <Input id={id} value={form.vendor} onChange={set('vendor')} placeholder="Dave's Auto" />
          )}
        </Field>

        <div>
          <p className="mb-1.5 text-sm font-medium text-fg">
            What this visit covers
          </p>
          <ul className="overflow-hidden rounded-lg border border-line text-sm">
            {visit.records.map((record) => (
              <li
                key={record.id}
                className="border-b border-line bg-surface px-3 py-2 text-muted last:border-b-0"
              >
                {names?.[record.service_type] ?? record.service_type}
                {record.service_type_raw ? (
                  <span className="block truncate text-xs text-muted/80">
                    {record.service_type_raw}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted">
            Costs and measurements stay per item — tap one in the log to change those.
          </p>

          {duplicates.length > 0 ? (
            <div className="mt-3 rounded-lg border border-line bg-surface-raised/60 px-3 py-2.5">
              <p className="text-sm text-fg">
                {duplicates.length} repeated {duplicates.length === 1 ? 'row' : 'rows'} hidden
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                The same work stated more than once across the pages of this invoice. They are
                already left out of the list and the total; this deletes them for good.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                disabled={busy}
                onClick={onRemoveDuplicates}
              >
                Remove repeated rows
              </Button>
            </div>
          ) : null}
        </div>

        {confirmingDelete ? (
          <p className="rounded-lg border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad-text">
            This removes all {ids.length} records from this visit. Press delete again to confirm.
          </p>
        ) : null}

        <ErrorNote>{error}</ErrorNote>
      </form>
    </Dialog>
  )
}
