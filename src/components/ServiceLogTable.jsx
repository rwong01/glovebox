import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

import { formatDay } from '../lib/dates.js'
import { formatCurrency, formatMiles } from '../lib/format.js'
import { Card } from './ui/Card.jsx'
import { Input, Select } from './ui/Field.jsx'

const COLLAPSED_COUNT = 5

/**
 * The full service history, searchable and filterable.
 *
 * Collapsed to the most recent handful by default. This sits below the flag
 * list because it is the reference material, not the answer — you come here to
 * check what a shop actually wrote, or to fix something OCR misread.
 */
export function ServiceLogTable({ records, rules, onEdit }) {
  const [query, setQuery] = useState('')
  const [item, setItem] = useState('all')
  const [expanded, setExpanded] = useState(false)

  const names = useMemo(
    () => Object.fromEntries(rules.map((r) => [r.item_key, r.display_name])),
    [rules],
  )

  // Only offer filters for items this vehicle actually has records for — a
  // dropdown of twelve options where nine match nothing is just noise.
  const presentItems = useMemo(() => {
    const keys = [...new Set(records.map((r) => r.service_type))]
    return keys.map((key) => ({ key, name: names[key] ?? key })).sort((a, b) => a.name.localeCompare(b.name))
  }, [records, names])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return records.filter((record) => {
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
  }, [records, query, item, names])

  const visible = expanded ? filtered : filtered.slice(0, COLLAPSED_COUNT)
  const hidden = filtered.length - visible.length

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

      {filtered.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Nothing matches that search.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-2 py-2 font-medium">Service</th>
                <th scope="col" className="py-2 pl-2 pr-3 text-right font-medium sm:pr-2">Mileage</th>
                {/* Four columns do not fit a phone. Below `sm` the cost moves
                    under the service name rather than being clipped. */}
                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {visible.map((record) => {
                const name = names[record.service_type] ?? record.service_type
                const subtitle =
                  record.service_type_raw && record.service_type_raw !== name
                    ? record.service_type_raw
                    : null
                const cost = record.cost != null ? formatCurrency(record.cost) : null

                return (
                  <tr
                    key={record.id}
                    onClick={() => onEdit?.(record)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onEdit?.(record)
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Edit ${name}, ${formatDay(record.service_date)}`}
                    className="cursor-pointer transition-colors hover:bg-surface-raised"
                  >
                    <td className="px-3 py-3 whitespace-nowrap text-muted">
                      {formatDay(record.service_date)}
                    </td>
                    <td className="px-2 py-3">
                      <span className="text-fg">{name}</span>
                      {subtitle ? (
                        <span className="block truncate text-xs text-muted">{subtitle}</span>
                      ) : null}
                      {cost ? (
                        <span className="block text-xs text-muted sm:hidden">{cost}</span>
                      ) : null}
                    </td>
                    <td className="py-3 pl-2 pr-3 text-right whitespace-nowrap text-muted sm:pr-2">
                      {record.mileage_at_service != null
                        ? formatMiles(record.mileage_at_service)
                        : '—'}
                    </td>
                    <td className="hidden px-3 py-3 text-right whitespace-nowrap text-muted sm:table-cell">
                      {cost ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-line px-4 py-3 text-left text-sm text-muted transition-colors hover:bg-surface-raised hover:text-fg"
        >
          {expanded ? 'Show fewer' : `View all ${filtered.length} records`}
        </button>
      ) : null}
    </Card>
  )
}
