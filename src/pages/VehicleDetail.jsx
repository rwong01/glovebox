import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarClock, Camera, Plus, SlidersHorizontal } from 'lucide-react'

import { AppShell } from '../components/AppShell.jsx'
import { EditRecordDialog } from '../components/EditRecordDialog.jsx'
import { RepairDatesDialog } from '../components/RepairDatesDialog.jsx'
import { FlagList } from '../components/FlagList.jsx'
import { ServiceLogTable } from '../components/ServiceLogTable.jsx'
import { VehicleDialog } from '../components/VehicleDialog.jsx'
import { Button } from '../components/ui/Button.jsx'
import { SectionTitle } from '../components/ui/Card.jsx'
import { EmptyState, ErrorNote, Skeleton } from '../components/ui/States.jsx'
import { useGarage } from '../hooks/useGarage.js'
import { buildFlags } from '../lib/flagging.js'
import { proposeDateRepairs } from '../lib/repairDates.js'
import { formatOdometer } from '../lib/format.js'

export default function VehicleDetail() {
  const { vehicleId } = useParams()
  const { vehicles, records, rules, overrides, loading, error, refresh } = useGarage()

  const [editingRecord, setEditingRecord] = useState(null)
  const [recordOpen, setRecordOpen] = useState(false)
  const [vehicleOpen, setVehicleOpen] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)

  const vehicle = vehicles.find((v) => v.id === vehicleId)
  const vehicleRecords = useMemo(
    () => records.filter((r) => r.vehicle_id === vehicleId),
    [records, vehicleId],
  )

  const repairable = useMemo(
    () => proposeDateRepairs(vehicleRecords).length,
    [vehicleRecords],
  )

  const result = useMemo(() => {
    if (!vehicle || rules.length === 0) return null
    return buildFlags({
      vehicle,
      records: vehicleRecords,
      rules,
      overrides: overrides.filter((o) => o.vehicle_id === vehicleId),
      now: new Date(),
    })
  }, [vehicle, vehicleRecords, rules, overrides, vehicleId])

  if (loading) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64" />
        </div>
      </AppShell>
    )
  }

  if (error) {
    return (
      <AppShell>
        <ErrorNote>{error}</ErrorNote>
      </AppShell>
    )
  }

  // Deleted, or a stale bookmark.
  if (!vehicle) return <Navigate to="/" replace />

  const subtitle = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')

  function openRecord(record) {
    setEditingRecord(record)
    setRecordOpen(true)
  }

  return (
    <AppShell>
      <Link
        to="/"
        className="mb-4 -ml-1 inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Garage
      </Link>

      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg">
            {vehicle.nickname}
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {[subtitle, formatOdometer(vehicle.current_mileage)].filter(Boolean).join(' · ')}
          </p>
        </div>

        <Button
          size="icon"
          variant="ghost"
          aria-label="Edit vehicle"
          onClick={() => setVehicleOpen(true)}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
        </Button>
      </header>

      {repairable > 0 ? (
        <button
          type="button"
          onClick={() => setRepairOpen(true)}
          className="mb-4 flex w-full items-center gap-3 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2.5 text-left transition-opacity hover:opacity-80"
        >
          <CalendarClock size={16} aria-hidden="true" className="shrink-0 text-warn-text" />
          <span className="min-w-0 flex-1 text-sm text-warn-text">
            {repairable} scanned {repairable === 1 ? 'record has' : 'records have'} a date that
            looks wrong. The real dates are recoverable from the scans — no re-scanning.
          </span>
        </button>
      ) : null}

      {vehicleRecords.length === 0 ? (
        <EmptyState
          message="No service records yet."
          action={
            <Button as={Link} to={`/vehicle/${vehicle.id}/scan`} size="lg">
              Start scanning your records
            </Button>
          }
        />
      ) : result ? (
        <FlagList result={result} />
      ) : (
        <ErrorNote>
          The service rules table is empty. Run supabase/schema.sql to seed it.
        </ErrorNote>
      )}

      <div className="mt-6 flex gap-2">
        <Button as={Link} to={`/vehicle/${vehicle.id}/scan`} className="flex-1 justify-center">
          <Camera size={16} aria-hidden="true" />
          Scan records
        </Button>
        <Button variant="secondary" onClick={() => openRecord(null)}>
          <Plus size={16} aria-hidden="true" />
          Add by hand
        </Button>
      </div>

      {vehicleRecords.length > 0 ? (
        <section className="mt-10">
          <SectionTitle>Service log</SectionTitle>
          <ServiceLogTable records={vehicleRecords} rules={rules} onEdit={openRecord} />
        </section>
      ) : null}

      <EditRecordDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        record={editingRecord}
        vehicleId={vehicle.id}
        rules={rules}
        onSaved={refresh}
      />

      <RepairDatesDialog
        open={repairOpen}
        onOpenChange={setRepairOpen}
        records={vehicleRecords}
        onRepaired={refresh}
      />

      <VehicleDialog
        open={vehicleOpen}
        onOpenChange={setVehicleOpen}
        vehicle={vehicle}
        onSaved={refresh}
        onDeleted={refresh}
      />
    </AppShell>
  )
}
