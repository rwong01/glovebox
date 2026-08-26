import { useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { AppShell } from '../components/AppShell.jsx'
import { MileageConflictDialog } from '../components/MileageConflictDialog.jsx'
import { ReceiptUploader } from '../components/ReceiptUploader.jsx'
import { Button } from '../components/ui/Button.jsx'
import { ErrorNote, Skeleton } from '../components/ui/States.jsx'
import { useGarage } from '../hooks/useGarage.js'

export default function Upload() {
  const { vehicleId } = useParams()
  const { vehicles, rules, loading, error, refresh } = useGarage()

  const [savedCount, setSavedCount] = useState(0)
  const [conflict, setConflict] = useState(null)

  const vehicle = vehicles.find((v) => v.id === vehicleId)

  // Memoised so the uploader's background pipeline effect is not restarted on
  // every render of this page.
  const itemKeys = useMemo(() => rules.map((r) => r.item_key), [rules])

  const onSaved = useCallback((result) => {
    setSavedCount((n) => n + 1)
    if (result.mileageConflict) setConflict(result.mileageConflict)
  }, [])

  if (loading) {
    return (
      <AppShell>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-4 h-72" />
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

  if (!vehicle) return <Navigate to="/" replace />

  return (
    <AppShell>
      <Link
        to={`/vehicle/${vehicleId}`}
        className="mb-4 -ml-1 inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {vehicle.nickname}
      </Link>

      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg">Scan records</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          One tap per receipt. Each one is checked for focus as you take it, then read and saved in
          the background — keep shooting while it catches up.
        </p>
      </header>

      <ReceiptUploader vehicleId={vehicle.id} itemKeys={itemKeys} onSaved={onSaved} />

      {savedCount > 0 ? (
        <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-sm text-muted">
            {savedCount} {savedCount === 1 ? 'receipt' : 'receipts'} added.
          </p>
          <Button as={Link} to={`/vehicle/${vehicleId}`} variant="secondary">
            Back to {vehicle.nickname}
          </Button>
        </div>
      ) : null}

      <MileageConflictDialog
        open={Boolean(conflict)}
        onOpenChange={(next) => {
          if (!next) setConflict(null)
        }}
        conflict={conflict}
        vehicle={vehicle}
        onResolved={refresh}
      />
    </AppShell>
  )
}
