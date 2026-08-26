import { useMemo, useState } from 'react'
import { ChevronDown, Pencil, Search } from 'lucide-react'

import { formatDay } from '../lib/dates.js'
import { formatCurrency, formatMiles } from '../lib/format.js'
import { formatMeasurement } from '../lib/flagging.js'
import { groupIntoVisits } from '../lib/visits.js'
import { cn } from '../lib/cn.js'
import { Card } from './ui/Card.jsx'
import { Input, Select } from './ui/Field.jsx'

const COLLAPSED_VISITS = 5

/**
 * The service history, grouped into visits.
 *
 * Records are stored one row per line item, because that is what the flagging
 * engine needs. But six years of history is a couple of hundred of those and
 * only a dozen or so actual trips to a shop, and a flat list of two hundred
 * rows hides that entirely. So each visit is one row here — date, shop,
 * odometer, total — and expands to show what was done.
 */
export function ServiceLogTable({ records, rules, onEdit, onEditVisit }) {
  const [query, setQuery] = useState('')
  const [item, setItem] = useState('all')
  const [expanded, setExpanded] = useState(false)
  const [openVisits, setOpenVisits] = useState(() => new Set())

  const names = useMemo(
    () => Object.fromEntries(rules.map((r) => [r.item_key, r.display_name])),
    [rules],
  )

  // A bare "6" against Tire Tread is unreadable; it needs to say 6/32".
  const units = useMemo(
    () => Object.fromEntries(rules.map((r) => [r.item_key, r.unit])),
    [rules],
  )

  // Only offer filters for items this vehicle actually has records for — a
  // dropdown of twelve options where nine match nothing is just noise.
  const presentItems = useMemo(() => {
    const keys = [...new Set(records.map((r) => r.service_type))]
    return keys
      .map((key) => ({ key, name: names[key] ?? key }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [records, names])

  // Filtering happens on records, then visits are rebuilt from what survives,
  // so searching "brakes" shows the visits where brakes were touched with just
  // those lines under them.
  const visits = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matching = records.filter((record) => {
      if (item !== 'all' && record.service_type !== item) return false
      if (!q) return true
      return [
        names[record.service_type],
        record.service_type_raw,
        record.vendor,
        record.raw_notes,
        record.service_date,
        record.mileage_at_service,
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(q))
    })
    return groupIntoVisits(matching)
  }, [records, query, item, names])

  const filtering = query.trim() !== '' || item !== 'all'
  const visible = expanded || filtering ? visits : visits.slice(0, COLLAPSED_VISITS)
  const hidden = visits.length - visible.length

  function toggleVisit(key) {
    setOpenVisits((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (records.length === 0) return null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-line p-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search records"
            aria-label="Search service records"
            className="py-2 pl-9 text-sm"
          />
        </div>

        {presentItems.length > 1 ? (
          <Select
            value={item}
            onChange={(e) => setItem(e.target.value)}
            aria-label="Filter by service"
            className="py-2 text-sm sm:w-44"
          >
            <option value="all">All services</option>
            {presentItems.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {visits.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Nothing matches that search.</p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((visit) => (
            <VisitRow
              key={visit.key}
              visit={visit}
              names={names}
              units={units}
              open={openVisits.has(visit.key) || filtering}
              onToggle={() => toggleVisit(visit.key)}
              onEdit={onEdit}
              onEditVisit={onEditVisit}
            />
          ))}
        </ul>
      )}

      {hidden > 0 || (expanded && !filtering) ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-line px-4 py-3 text-left text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg"
        >
          {expanded ? 'Show fewer' : `View all ${visits.length} visits`}
        </button>
      ) : null}
    </Card>
  )
}

function VisitRow({ visit, names, units, open, onToggle, onEdit, onEditVisit }) {
  const count = visit.records.length

  return (
    <li>
      <div className="group flex items-start transition-colors hover:bg-surface-raised">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-w-0 flex-1 items-start gap-3 py-3 pr-2 pl-4 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium text-fg">
              {visit.date ? formatDay(visit.date) : 'Undated'}
            </span>
            {visit.vendor ? <span className="truncate text-muted">{visit.vendor}</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-muted tnum">
            {[
              `${count} ${count === 1 ? 'item' : 'items'}`,
              visit.mileage != null ? `${formatMiles(visit.mileage)} mi` : null,
              visit.cost != null ? formatCurrency(visit.cost) : null,
              // Rows the same visit stated twice across its pages, hidden here
              // but worth saying so the count is not a mystery.
              visit.duplicates?.length
                ? `${visit.duplicates.length} repeated ${visit.duplicates.length === 1 ? 'row' : 'rows'} hidden`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <ChevronDown
          size={16}
          aria-hidden="true"
          className={cn('mt-1 shrink-0 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>

      <button
        type="button"
        onClick={() => onEditVisit?.(visit)}
        aria-label={`Edit this visit${visit.date ? ` on ${formatDay(visit.date)}` : ''}`}
        className="mt-2 mr-2 shrink-0 rounded-lg p-2 text-muted transition-colors hover:text-fg"
      >
        <Pencil size={15} aria-hidden="true" />
      </button>
      </div>

      {open ? (
        <ul className="border-t border-line bg-surface-raised/40">
          {visit.records.map((record) => {
            const name = names[record.service_type] ?? record.service_type
            const subtitle =
              record.service_type_raw && record.service_type_raw !== name
                ? record.service_type_raw
                : null

            return (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => onEdit?.(record)}
                  className="flex w-full items-baseline gap-3 py-2 pr-4 pl-8 text-left text-sm transition-colors hover:bg-surface-raised"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-fg">{name}</span>
                    {subtitle ? (
                      <span className="block truncate text-xs text-muted">{subtitle}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted tnum">
                    {[
                      record.measured_value != null
                        ? formatMeasurement(Number(record.measured_value), units[record.service_type])
                        : null,
                      record.cost != null ? formatCurrency(record.cost) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}
