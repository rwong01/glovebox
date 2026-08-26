import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'

import { VehicleDialog } from '../components/VehicleDialog.jsx'
import { AppShell } from '../components/AppShell.jsx'
import { VehicleCard } from '../components/VehicleCard.jsx'
import { Button } from '../components/ui/Button.jsx'
import { EmptyState, ErrorNote, Skeleton } from '../components/ui/States.jsx'
import { useGarage } from '../hooks/useGarage.js'
import { buildFlags } from '../lib/flagging.js'

export default function Garage() {
  const { vehicles, records, rules, overrides, loading, error, refresh } = useGarage()
  const [adding, setAdding] = useState(false)

  // Computed from the same data the detail page uses, so a card can never
  // disagree with the list behind it.
  const summaries = useMemo(() => {
    if (loading || rules.length === 0) return {}
    const now = new Date()
    return Object.fromEntries(
      vehicles.map((vehicle) => [
        vehicle.id,
        buildFlags({
          vehicle,
          records: records.filter((r) => r.vehicle_id === vehicle.id),
          rules,
          overrides: overrides.filter((o) => o.vehicle_id === vehicle.id),
          now,
        }).summary,
      ]),
    )
  }, [vehicles, records, rules, overrides, loading])

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Garage</h1>
        {vehicles.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden="true" />
            Add
          </Button>
        ) : null}
      </div>

      <ErrorNote className="mb-4">{error}</ErrorNote>

      {loading ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
        </div>
      ) : vehicles.length === 0 ? (
        <EmptyState
          message="No vehicles yet."
          action={
            <Button size="lg" onClick={() => setAdding(true)}>
              Add your first vehicle
            </Button>
          }
        />
      ) : (
        /* A vertical stack, not a grid. This is a personal tool for one to
           three cars, not a fleet dashboard, and density would be the wrong
           thing to optimise for. */
        <ul className="flex flex-col gap-3">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} summary={summaries[vehicle.id]} />
          ))}
        </ul>
      )}

      <VehicleDialog open={adding} onOpenChange={setAdding} onSaved={refresh} />
    </AppShell>
  )
}
