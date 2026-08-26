import { useMemo, useState } from 'react'

import { createServiceRecord, deleteServiceRecord, updateServiceRecord } from '../lib/db.js'
import { toISODate } from '../lib/dates.js'
import { VERDICTS } from '../lib/serviceItems.js'
import { Button } from './ui/Button.jsx'
import { Dialog } from './ui/Dialog.jsx'
import { Field, Input, Select, Textarea } from './ui/Field.jsx'
import { ErrorNote } from './ui/States.jsx'

const VERDICT_LABELS = {
  within_spec: 'Within spec',
  near_minimum: 'Near minimum',
  below_minimum: 'At or below minimum',
}

function blankForm() {
  return {
    service_date: toISODate(new Date()),
    service_type: 'oil_change',
    mileage_at_service: '',
    cost: '',
    measured_value: '',
    verdict: '',
    vendor: '',
    raw_notes: '',
  }
}

function toForm(record) {
  return {
    service_date: record.service_date ?? '',
    service_type: record.service_type ?? 'oil_change',
    mileage_at_service: record.mileage_at_service ?? '',
    cost: record.cost ?? '',
    measured_value: record.measured_value ?? '',
    verdict: record.verdict ?? '',
    vendor: record.vendor ?? '',
    raw_notes: record.raw_notes ?? '',
  }
}

/**
 * Add or correct a single service record.
 *
 * Scanned records save without review, so this is where a misread date or
 * odometer gets fixed. It doubles as the manual-entry form for anything that
 * never had a receipt.
 */
export function EditRecordDialog(props) {
  // Keyed by the record being edited, so opening a different row starts from
  // that row's values rather than needing an effect to overwrite them.
  return (
    <EditRecordForm key={props.open ? (props.record?.id ?? 'new') : 'closed'} {...props} />
  )
}

function EditRecordForm({ open, onOpenChange, record, vehicleId, rules, onSaved }) {
  const [form, setForm] = useState(() => (record ? toForm(record) : blankForm()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const trackable = useMemo(() => rules.filter((r) => r.item_key !== 'other'), [rules])
  const selected = rules.find((r) => r.item_key === form.service_type)
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }))

  async function onSubmit(event) {
    event.preventDefault()
    setError(null)
    setBusy(true)

    const payload = {
      service_date: form.service_date,
      service_type: form.service_type,
      mileage_at_service: numberOrNull(form.mileage_at_service),
      cost: numberOrNull(form.cost),
      // Only persist a measurement or verdict where the item has one, so
      // switching an item's type never leaves an orphaned value behind.
      measured_value: selected?.type === 'measurable' ? numberOrNull(form.measured_value) : null,
      verdict: selected?.type === 'qualitative' && form.verdict ? form.verdict : null,
      vendor: form.vendor.trim() || null,
      raw_notes: form.raw_notes.trim() || null,
    }

    try {
      if (record) {
        await updateServiceRecord(record.id, payload)
      } else {
        await createServiceRecord({ ...payload, vehicle_id: vehicleId, source: 'manual' })
      }
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not save that record.')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    setBusy(true)
    setError(null)
    try {
      await deleteServiceRecord(record.id)
      onOpenChange(false)
      onSaved?.()
    } catch (err) {
      setError(err.message || 'Could not delete that record.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={record ? 'Edit record' : 'Add a record'}
      description={record?.source === 'ocr' ? 'Scanned from a receipt. Correct anything OCR got wrong.' : undefined}
      footer={
        <>
          {record ? (
            <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button form="edit-record" type="submit" loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-record" onSubmit={onSubmit} className="flex flex-col gap-4 pb-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            {({ id }) => (
              <Input id={id} type="date" required value={form.service_date} onChange={set('service_date')} />
            )}
          </Field>
          <Field label="Mileage">
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

        <Field label="Service">
          {({ id }) => (
            <Select id={id} value={form.service_type} onChange={set('service_type')}>
              {trackable.map((rule) => (
                <option key={rule.item_key} value={rule.item_key}>
                  {rule.display_name}
                </option>
              ))}
              <option value="other">Other</option>
            </Select>
          )}
        </Field>

        {selected?.type === 'measurable' ? (
          <Field
            label={`Measurement (${selected.unit})`}
            hint="From the shop's inspection sheet. Use the lowest reading if several are listed."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                value={form.measured_value}
                onChange={set('measured_value')}
              />
            )}
          </Field>
        ) : null}

        {selected?.type === 'qualitative' ? (
          <Field label="Inspection verdict" hint="What the shop wrote, not a measurement.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={form.verdict} onChange={set('verdict')}>
                <option value="">Not stated</option>
                {VERDICTS.map((verdict) => (
                  <option key={verdict} value={verdict}>
                    {VERDICT_LABELS[verdict]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost">
            {({ id }) => (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={form.cost}
                onChange={set('cost')}
                placeholder="89.50"
              />
            )}
          </Field>
          <Field label="Shop">
            {({ id }) => <Input id={id} value={form.vendor} onChange={set('vendor')} placeholder="Dave's Auto" />}
          </Field>
        </div>

        <Field label="Notes">
          {({ id }) => (
            <Textarea
              id={id}
              value={form.raw_notes}
              onChange={set('raw_notes')}
              placeholder="Anything worth remembering — or the full receipt text from a scan."
            />
          )}
        </Field>

        <ErrorNote>{error}</ErrorNote>
      </form>
    </Dialog>
  )
}

function numberOrNull(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
