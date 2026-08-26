import { useCallback, useEffect, useState } from 'react'

import {
  listRuleOverrides,
  listServiceRecords,
  listServiceRules,
  listVehicles,
} from '../lib/db.js'

/**
 * Loads the whole garage in one pass: vehicles, every service record, the rule
 * table and any per-vehicle overrides.
 *
 * Fetching everything at once rather than per page is a deliberate call for
 * this app's scale — one to three cars and a few hundred records. It makes
 * navigation between the garage and a vehicle instant, and it means the flag
 * summary on each card is computed from the same data the detail page shows,
 * so the two can never disagree.
 */
export function useGarage() {
  const [state, setState] = useState({
    vehicles: [],
    records: [],
    rules: [],
    overrides: [],
    loading: true,
    error: null,
  })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, error: null }))
    try {
      const [vehicles, records, rules, overrides] = await Promise.all([
        listVehicles(),
        listServiceRecords(),
        listServiceRules(),
        listRuleOverrides(),
      ])
      setState({ vehicles, records, rules, overrides, loading: false, error: null })
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || 'Could not load your garage.' }))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, refresh: load }
}
