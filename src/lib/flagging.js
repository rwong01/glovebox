/**
 * The flagging engine.
 *
 * Turns a vehicle's service history into a multi-point-inspection style list:
 * one row per tracked item, a colour, and one plain-English sentence saying why.
 *
 * The whole point is that it is calibrated to *your* driving pace rather than a
 * generic schedule. Two cars serviced on the same day at the same odometer will
 * get different projections if one does 300 miles a month and the other 2,000.
 *
 * Everything here is pure — `now` is injected — so the behaviour is testable
 * without freezing clocks. See `flagging.test.js`.
 */
import {
  AVG_DAYS_PER_MONTH,
  addDays,
  addMonths,
  formatDuration,
  formatDurationAdjective,
  formatMonthYear,
  monthsBetween,
  toDate,
} from './dates.js'

export const STATUS = {
  RED: 'red',
  YELLOW: 'yellow',
  GREEN: 'green',
  UNKNOWN: 'unknown',
}

// Sorting/severity order. `unknown` sits last rather than being treated as an
// alarm: a brand-new account has no history for anything, and rendering twelve
// red rows on day one would be both wrong and useless.
const STATUS_RANK = { red: 0, yellow: 1, green: 2, unknown: 3 }

/** Roughly 12,000 miles a year — used only until there is real history to measure. */
export const DEFAULT_MILES_PER_MONTH = 1000

/** Prefer recent history: how you drive now beats how you drove five years ago. */
export const PACE_WINDOW_MONTHS = 24

/**
 * Two odometer readings a fortnight apart say nothing useful about a yearly
 * pace, so require a real span before trusting the measurement.
 *
 * Note there is deliberately no *minimum mileage* guard. A car that covered 200
 * miles in eighteen months has a real and very low pace, and that is precisely
 * the case this app exists to handle — rejecting it as "too little data" and
 * falling back to 1,000 mi/month would produce exactly the wrong answer.
 */
export const MIN_PACE_SPAN_MONTHS = 3

/** Beyond this, an odometer reading is a mistyped digit rather than a commute. */
export const MAX_PLAUSIBLE_MILES_PER_MONTH = 10000

/**
 * How long a clean qualitative verdict stays trustworthy. A rotor inspection
 * that said "within spec" four years and 40,000 miles ago is not evidence that
 * the rotors are fine today, and showing it as green would be the exact failure
 * this app is meant to prevent.
 */
export const QUALITATIVE_STALE_MONTHS = 24
export const QUALITATIVE_STALE_MILES = 20000

/**
 * A jump this large in a measurable reading means the part was replaced, not
 * that it healed. Wear-rate maths restarts from that point. Sized to sit well
 * above inspection-to-inspection noise (±1/32", ±1mm) and well below a real
 * replacement (3mm pads to 11mm, 3/32" tread to 10/32").
 */
const REPLACEMENT_JUMP = 1.5

const VERDICT_STATUS = {
  within_spec: STATUS.GREEN,
  near_minimum: STATUS.YELLOW,
  below_minimum: STATUS.RED,
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

const intFormat = new Intl.NumberFormat('en-US')

function fmtInt(n) {
  return Number.isFinite(n) ? intFormat.format(Math.round(n)) : null
}

/** One decimal at most, with a trailing `.0` stripped. */
function trimNum(n) {
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/** Renders a measurement in the unit a person would actually say out loud. */
export function formatMeasurement(value, unit) {
  if (!Number.isFinite(value)) return null
  if (unit === '32nds of an inch') return `${trimNum(value)}/32"`
  if (unit === 'mm') return `${trimNum(value)}mm`
  return unit ? `${trimNum(value)} ${unit}` : trimNum(value)
}

/** "around Feb 2026" / "now" / null when a zero pace means it never arrives. */
function whenPhrase(date, now) {
  if (!date) return null
  return date <= now ? 'now' : `around ${formatMonthYear(date)}`
}

function worstStatus(...candidates) {
  let worst = null
  for (const c of candidates) {
    if (!c) continue
    if (worst === null || STATUS_RANK[c] < STATUS_RANK[worst]) worst = c
  }
  return worst
}

// ---------------------------------------------------------------------------
// Driving pace
// ---------------------------------------------------------------------------

/**
 * Every dated odometer reading we know about, oldest first, one per date.
 *
 * Several line items from one visit share a single odometer reading, so same-day
 * records collapse to their highest value rather than counting repeatedly.
 */
export function collectOdometerObservations(vehicle, records = []) {
  const byDate = new Map()

  for (const record of records) {
    const mileage = Number(record?.mileage_at_service)
    const date = toDate(record?.service_date)
    if (!date || !Number.isFinite(mileage) || mileage <= 0) continue
    const key = date.getTime()
    const existing = byDate.get(key)
    if (!existing || mileage > existing.mileage) byDate.set(key, { date, mileage })
  }

  const observations = [...byDate.values()].sort((a, b) => a.date - b.date)

  // A manually-raised odometer is real information the service history does not
  // contain, so fold it in — but only when it is genuinely newer and higher,
  // since `updated_at` also moves when you merely rename the car.
  const manualMileage = Number(vehicle?.current_mileage)
  const manualDate = toDate(vehicle?.updated_at)
  const newest = observations[observations.length - 1]
  if (
    Number.isFinite(manualMileage) &&
    manualMileage > 0 &&
    manualDate &&
    (!newest || (manualMileage > newest.mileage && manualDate > newest.date))
  ) {
    observations.push({ date: manualDate, mileage: manualMileage })
  }

  return observations
}

function paceFrom(observations) {
  if (observations.length < 2) return null
  const first = observations[0]
  const last = observations[observations.length - 1]

  const spanMonths = monthsBetween(first.date, last.date)
  if (!Number.isFinite(spanMonths) || spanMonths < MIN_PACE_SPAN_MONTHS) return null

  const milesDelta = last.mileage - first.mileage
  // A backwards odometer is bad data, not a reversing car.
  if (!Number.isFinite(milesDelta) || milesDelta < 0) return null

  const milesPerMonth = milesDelta / spanMonths
  if (milesPerMonth > MAX_PLAUSIBLE_MILES_PER_MONTH) return null

  return {
    milesPerMonth,
    confidence: 'measured',
    spanMonths,
    sampleCount: observations.length,
  }
}

/**
 * Miles per month, measured from real history where possible.
 *
 * Tries the last two years first, then falls back to the full history, then to
 * a flat assumption. A pace of exactly 0 is a legitimate answer — a car in
 * storage — and downstream code treats mileage-based due dates as "never" in
 * that case while time-based ones still fire.
 */
export function estimateDrivingPace(observations = []) {
  if (observations.length >= 2) {
    const latest = observations[observations.length - 1]
    const windowStart = addMonths(latest.date, -PACE_WINDOW_MONTHS)
    const recent = observations.filter((o) => o.date >= windowStart)

    const measured = paceFrom(recent) || paceFrom(observations)
    if (measured) return measured
  }

  return {
    milesPerMonth: DEFAULT_MILES_PER_MONTH,
    confidence: 'assumed',
    spanMonths: null,
    sampleCount: observations.length,
  }
}

/**
 * Today's odometer, projected forward from the newest reading at the measured
 * pace. This is what makes "you're 8,400 miles into a 10,000-mile interval"
 * possible without the user typing in their odometer every week.
 */
export function estimateCurrentMileage({ vehicle, observations = [], pace, now }) {
  const known = Math.max(
    Number(vehicle?.current_mileage) || 0,
    ...observations.map((o) => o.mileage),
    0,
  )

  const anchor = observations[observations.length - 1]
  if (!anchor) {
    return { miles: known, anchorDate: null, anchorMileage: known, projectedMiles: 0 }
  }

  const elapsed = Math.max(0, monthsBetween(anchor.date, now) ?? 0)
  const projectedMiles = Math.round(elapsed * (pace?.milesPerMonth ?? 0))

  return {
    miles: known + projectedMiles,
    anchorDate: anchor.date,
    anchorMileage: known,
    projectedMiles,
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const OVERRIDABLE = [
  'mileage_interval',
  'time_interval_months',
  'yellow_mileage',
  'yellow_months',
  'red_mileage',
  'red_months',
  'yellow_threshold',
  'red_threshold',
]

/** Layers a per-vehicle override on top of a global rule, field by field. */
export function resolveRule(rule, override) {
  if (!override) return rule
  const merged = { ...rule }
  for (const key of OVERRIDABLE) {
    if (override[key] !== null && override[key] !== undefined) merged[key] = override[key]
  }
  if (override.notes) merged.notes = override.notes
  return merged
}

/**
 * Oldest first.
 *
 * Not every record has a date — a continuation page of a multi-page invoice
 * often carries line items and nothing else. Treating an undated record as
 * epoch zero would file a recent one at the very beginning of the history and
 * let a decade-old record win as "most recent". Odometers only move one way,
 * so mileage orders the undated ones instead.
 */
export function compareRecordsByRecency(a, b) {
  const aDate = toDate(a?.service_date)
  const bDate = toDate(b?.service_date)

  if (aDate && bDate) {
    const byDate = aDate.getTime() - bDate.getTime()
    if (byDate !== 0) return byDate
  }

  const aMiles = Number(a?.mileage_at_service)
  const bMiles = Number(b?.mileage_at_service)
  if (Number.isFinite(aMiles) && Number.isFinite(bMiles) && aMiles !== bMiles) {
    return aMiles - bMiles
  }

  // Nothing else separates them: prefer the dated record as the later one,
  // since it is the one we can actually say something about.
  if (aDate && !bDate) return 1
  if (!aDate && bDate) return -1
  return 0
}

function recordsForItem(records, itemKey) {
  return records.filter((r) => r?.service_type === itemKey).sort(compareRecordsByRecency)
}

/** Odometer reading at which a target will be reached, as a date. Null if never. */
function projectDateForOdometer(target, ctx) {
  const remaining = target - ctx.currentMileage
  if (remaining <= 0) {
    // Already past it. Work backwards to say roughly when it happened.
    if (!(ctx.pace.milesPerMonth > 0)) return ctx.now
    return addDays(ctx.now, (remaining / ctx.pace.milesPerMonth) * AVG_DAYS_PER_MONTH)
  }
  if (!(ctx.pace.milesPerMonth > 0)) return null // parked indefinitely
  return addDays(ctx.now, (remaining / ctx.pace.milesPerMonth) * AVG_DAYS_PER_MONTH)
}

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

function unknownFlag(rule, message) {
  return {
    status: STATUS.UNKNOWN,
    reason: message,
    detail: null,
    lastService: null,
    dueDate: null,
    dueOdometer: null,
    dueBasis: null,
    estimatedValue: null,
  }
}

function evaluateInterval(rule, records, ctx) {
  const last = records[records.length - 1]
  if (!last) {
    return unknownFlag(
      rule,
      `No ${rule.display_name.toLowerCase()} on record yet — scan a receipt or add one by hand to start tracking it.`,
    )
  }

  const lastDate = toDate(last.service_date)
  const lastMileage = Number.isFinite(Number(last.mileage_at_service))
    ? Number(last.mileage_at_service)
    : null

  // A record with neither a date nor an odometer anchors nothing — there is no
  // point to measure an interval from. Say so instead of producing a sentence
  // with holes in it.
  if (!lastDate && lastMileage == null) {
    return unknownFlag(
      rule,
      `There is a ${rule.display_name.toLowerCase()} record on file, but it has no date or mileage to measure from. Add either one from the service log.`,
    )
  }

  // A future-dated record is a typo; clamping keeps the arithmetic sane rather
  // than reporting a negative age.
  const monthsSince = Math.max(0, monthsBetween(lastDate, ctx.now) ?? 0)
  const milesSince = lastMileage != null ? Math.max(0, ctx.currentMileage - lastMileage) : null

  // --- time dimension ---
  let timeStatus = null
  const timeRedDate = rule.red_months != null ? addMonths(lastDate, rule.red_months) : null
  const timeYellowDate = rule.yellow_months != null ? addMonths(lastDate, rule.yellow_months) : null
  if (timeRedDate && ctx.now >= timeRedDate) timeStatus = STATUS.RED
  else if (timeYellowDate && ctx.now >= timeYellowDate) timeStatus = STATUS.YELLOW
  else if (timeRedDate || timeYellowDate) timeStatus = STATUS.GREEN

  // --- mileage dimension ---
  let mileStatus = null
  let redOdometer = null
  if (milesSince != null) {
    if (rule.red_mileage != null) redOdometer = lastMileage + rule.red_mileage
    if (rule.red_mileage != null && milesSince >= rule.red_mileage) mileStatus = STATUS.RED
    else if (rule.yellow_mileage != null && milesSince >= rule.yellow_mileage) mileStatus = STATUS.YELLOW
    else if (rule.red_mileage != null || rule.yellow_mileage != null) mileStatus = STATUS.GREEN
  }

  if (timeStatus === null && mileStatus === null) {
    return unknownFlag(
      rule,
      `Last done ${formatMonthYear(lastDate)}, but no interval is configured for this item.`,
    )
  }

  const status = worstStatus(timeStatus, mileStatus)
  const mileageRedDate = redOdometer != null ? projectDateForOdometer(redOdometer, ctx) : null

  // Whichever limit arrives first is the one that governs — that is how a
  // garaged car gets flagged on age while a commuter gets flagged on miles.
  let dueBasis = null
  let dueDate = null
  if (timeRedDate && mileageRedDate) {
    dueBasis = timeRedDate <= mileageRedDate ? 'time' : 'mileage'
    dueDate = timeRedDate <= mileageRedDate ? timeRedDate : mileageRedDate
  } else if (timeRedDate) {
    dueBasis = 'time'
    dueDate = timeRedDate
  } else if (redOdometer != null) {
    dueBasis = 'mileage'
    dueDate = mileageRedDate // may be null when the car isn't moving
  }

  // `lastAt` is null on an undated page, so every sentence below composes the
  // "when" and the "where on the odometer" separately rather than assuming both.
  const lastAt = formatMonthYear(lastDate)
  const at = lastAt ? ` ${lastAt}` : ''
  const atMileage = lastMileage != null ? ` at ${fmtInt(lastMileage)} mi` : ''
  // "Last done" is right for an oil change and wrong for tires, which are
  // fitted, or a battery, which is replaced. One optional column per rule
  // buys prose that does not read like a form letter.
  const lastVerb = `Last ${rule.action_verb || 'done'}`
  let reason
  let detail = null

  if (status === STATUS.RED) {
    if (timeStatus === STATUS.RED && (mileStatus !== STATUS.RED || dueBasis === 'time')) {
      reason = `${lastVerb}${at} — ${formatDuration(monthsSince)} ago, past the ${formatDurationAdjective(rule.red_months)} limit.`
      if (milesSince != null && mileStatus !== STATUS.RED) {
        detail = `Only ${fmtInt(milesSince)} miles since, but the clock got there first.`
      }
    } else {
      reason = `${fmtInt(milesSince)} miles since the last one${lastAt || atMileage ? ` (${[lastAt, atMileage.trim()].filter(Boolean).join(' ')})` : ''} — past the ${fmtInt(rule.red_mileage)}-mile limit.`
      if (timeStatus && timeStatus !== STATUS.RED) {
        detail = `Still inside the ${formatDurationAdjective(rule.red_months)} window, but the miles got there first.`
      }
    }
  } else if (status === STATUS.YELLOW) {
    const when = whenPhrase(dueDate, ctx.now)
    if (dueBasis === 'mileage' && redOdometer != null) {
      reason = `${fmtInt(milesSince)} miles in since${lastAt ? ` ${lastAt}` : ` ${fmtInt(lastMileage)} mi`}. Due at ${fmtInt(redOdometer)} mi${when ? `, ${when} at your pace` : ''}.`
    } else if (rule.red_months != null) {
      reason = `${lastVerb}${at}${atMileage}. The ${formatDurationAdjective(rule.red_months)} mark lands ${when ?? 'soon'}.`
    } else {
      reason = `${lastVerb}${at}${atMileage} — coming up on the recommended interval.`
    }
  } else {
    const when = whenPhrase(dueDate, ctx.now)
    const target = dueBasis === 'mileage' && redOdometer != null ? ` at about ${fmtInt(redOdometer)} mi` : ''
    if (when) {
      reason = `${lastVerb}${at}${atMileage}. Next due ${when}${target}.`
    } else if (dueBasis === 'mileage') {
      // Pace is zero: the odometer target exists but will never arrive.
      reason = `${lastVerb}${at}${atMileage}. Due at ${fmtInt(redOdometer)} mi — nothing owing while the car sits.`
    } else {
      reason = `${lastVerb}${at}${atMileage}. Nothing due yet.`
    }
  }

  return {
    status,
    reason,
    detail,
    lastService: { date: lastDate, mileage: lastMileage, record: last },
    dueDate,
    dueOdometer: redOdometer,
    dueBasis,
    estimatedValue: null,
  }
}

/**
 * Least-squares slope of value against mileage, in units lost per mile.
 * Positive means "wearing down", which is the normal direction for tread and pads.
 */
function wearRatePerMile(points) {
  const n = points.length
  if (n < 2) return null
  const meanX = points.reduce((s, p) => s + p.mileage, 0) / n
  const meanY = points.reduce((s, p) => s + p.value, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.mileage - meanX) * (p.value - meanY)
    den += (p.mileage - meanX) ** 2
  }
  if (den === 0) return null // every reading taken at the same odometer
  return -(num / den)
}

function evaluateMeasurable(rule, records, ctx) {
  let points = records
    .map((r) => ({
      value: Number(r.measured_value),
      mileage: Number(r.mileage_at_service),
      date: toDate(r.service_date),
      record: r,
    }))
    .filter((p) => Number.isFinite(p.value) && Number.isFinite(p.mileage))

  if (points.length === 0) {
    return unknownFlag(
      rule,
      `No measurement on record. Shops usually write this on the inspection sheet — worth asking for the number next time.`,
    )
  }

  // A big jump upward means new parts went on. Wear before that tells us nothing
  // about what is fitted now, so measure from the replacement forward.
  let start = 0
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].value - points[i - 1].value > REPLACEMENT_JUMP) start = i
  }
  const replaced = start > 0
  points = points.slice(start)

  const latest = points[points.length - 1]
  const ratePerMile = wearRatePerMile(points)
  const ratePer10k = ratePerMile != null && ratePerMile > 0 ? ratePerMile * 10000 : null

  const milesSinceMeasured = Math.max(0, ctx.currentMileage - latest.mileage)
  const estimate =
    ratePer10k != null
      ? Math.max(0, latest.value - (ratePer10k * milesSinceMeasured) / 10000)
      : latest.value

  const red = Number(rule.red_threshold)
  const yellow = Number(rule.yellow_threshold)
  let status = STATUS.GREEN
  if (Number.isFinite(red) && estimate <= red) status = STATUS.RED
  else if (Number.isFinite(yellow) && estimate <= yellow) status = STATUS.YELLOW

  // Project the crossing into red, in miles then in time at the current pace.
  let dueDate = null
  let dueOdometer = null
  if (ratePer10k != null && Number.isFinite(red)) {
    const milesToRed = ((estimate - red) / ratePer10k) * 10000
    dueOdometer = Math.round(ctx.currentMileage + milesToRed)
    dueDate = projectDateForOdometer(dueOdometer, ctx)
  }

  // "in Mar 2024" where the sheet was dated, "" where it was not.
  const measuredAt = formatMonthYear(latest.date)
  const measuredWhen = measuredAt ? ` in ${measuredAt}` : ''
  const shown = formatMeasurement(estimate, rule.unit)
  const redText = formatMeasurement(red, rule.unit)
  const yellowText = formatMeasurement(yellow, rule.unit)
  const wearText = ratePer10k != null ? `${formatMeasurement(ratePer10k, rule.unit)} per 10,000 miles` : null

  let reason
  let detail = null

  if (ratePer10k == null) {
    // One reading, or several taken at the same odometer: report it straight
    // rather than inventing a trend.
    const raw = formatMeasurement(latest.value, rule.unit)
    if (status === STATUS.RED) {
      reason = `Measured ${raw}${measuredWhen} — at or below the ${redText} replace line.`
    } else if (status === STATUS.YELLOW) {
      reason = `Measured ${raw}${measuredWhen} — under the ${yellowText} planning line.`
    } else {
      reason = `Measured ${raw}${measuredWhen}, comfortably above the ${yellowText} line.`
    }
    detail =
      points.length === 1
        ? 'Only one measurement on file, so there is no wear rate yet — a second one will start the projection.'
        : 'All readings were taken at the same odometer, so there is no wear rate yet.'
  } else if (status === STATUS.RED) {
    reason = `About ${shown} left — at or below the ${redText} replace line. Last measured ${formatMeasurement(latest.value, rule.unit)}${measuredWhen}.`
    detail = `Wearing about ${wearText}.`
  } else if (status === STATUS.YELLOW) {
    const when = whenPhrase(dueDate, ctx.now)
    reason = `About ${shown} left, wearing ~${wearText}. Reaches ${redText} ${when ?? 'only once you drive again'}.`
  } else {
    const when = whenPhrase(dueDate, ctx.now)
    reason = `About ${shown} left, wearing ~${wearText}. Not near the ${yellowText} line until ${when ?? 'you put miles on it'}.`
  }

  if (replaced) {
    detail = [detail, 'Wear measured from the most recent replacement onward.']
      .filter(Boolean)
      .join(' ')
  }

  return {
    status,
    reason,
    detail,
    lastService: { date: latest.date, mileage: latest.mileage, record: latest.record },
    dueDate,
    dueOdometer,
    dueBasis: 'measurement',
    estimatedValue: estimate,
  }
}

function evaluateQualitative(rule, records, ctx) {
  const withVerdict = records.filter((r) => r.verdict && VERDICT_STATUS[r.verdict])
  const last = withVerdict[withVerdict.length - 1]

  if (!last) {
    return unknownFlag(
      rule,
      `No inspection verdict on record. ${rule.display_name} has no universal spec — what matters is the shop's written call at the last inspection.`,
    )
  }

  const lastDate = toDate(last.service_date)
  const lastMileage = Number.isFinite(Number(last.mileage_at_service))
    ? Number(last.mileage_at_service)
    : null
  const monthsSince = Math.max(0, monthsBetween(lastDate, ctx.now) ?? 0)
  const milesSince = lastMileage != null ? Math.max(0, ctx.currentMileage - lastMileage) : null

  let status = VERDICT_STATUS[last.verdict]
  const at = formatMonthYear(lastDate)
  // An undated inspection sheet still carries a verdict worth reporting.
  const inspected = at ? `Inspected ${at}` : 'Inspected (no date on the record)'
  let reason
  let detail = null

  if (status === STATUS.RED) {
    reason = `${inspected}: at or below the stamped minimum thickness. This is the replace-now call.`
  } else if (status === STATUS.YELLOW) {
    reason = `${inspected}: measuring near the stamped minimum. Worth pricing before the next brake job.`
  } else {
    const stale =
      monthsSince >= QUALITATIVE_STALE_MONTHS ||
      (milesSince != null && milesSince >= QUALITATIVE_STALE_MILES)
    if (stale) {
      // Downgrade rather than keep showing green. A clean verdict has a
      // shelf life, and this is exactly the case a static log would miss.
      status = STATUS.YELLOW
      const since = milesSince != null ? ` and ${fmtInt(milesSince)} miles` : ''
      const elapsed = at ? `${formatDuration(monthsSince)}${since}` : `${fmtInt(milesSince)} miles`
      reason = `Last inspected${at ? ` ${at}` : ''} and within spec then — but that was ${elapsed} ago. Worth a fresh look.`
    } else {
      reason = `${inspected}: within spec.`
    }
  }

  if (last.raw_notes && status !== STATUS.GREEN) {
    detail = `Shop note: ${String(last.raw_notes).slice(0, 140)}`
  }

  return {
    status,
    reason,
    detail,
    lastService: { date: lastDate, mileage: lastMileage, record: last },
    dueDate: null,
    dueOdometer: null,
    dueBasis: 'inspection',
    estimatedValue: null,
  }
}

function evaluateRule(rule, records, ctx) {
  if (rule.type === 'measurable') return evaluateMeasurable(rule, records, ctx)
  if (rule.type === 'qualitative') return evaluateQualitative(rule, records, ctx)
  return evaluateInterval(rule, records, ctx)
}

function compareFlags(a, b) {
  const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status]
  if (rank !== 0) return rank

  // Within a colour, soonest-due first — which for red rows means most overdue.
  const at = a.dueDate ? a.dueDate.getTime() : null
  const bt = b.dueDate ? b.dueDate.getTime() : null
  if (at !== null && bt !== null && at !== bt) return at - bt
  if (at !== null && bt === null) return -1
  if (at === null && bt !== null) return 1

  return (a.sortOrder ?? 100) - (b.sortOrder ?? 100)
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Builds the full flag list for one vehicle.
 *
 * @param {object}   input
 * @param {object}   input.vehicle    Row from `vehicles`.
 * @param {object[]} input.records    Rows from `service_records` for that vehicle.
 * @param {object[]} input.rules      Rows from `service_rules`.
 * @param {object[]} input.overrides  Rows from `vehicle_service_rules`.
 * @param {Date}     [input.now]      Injected for testability.
 */
export function buildFlags({ vehicle, records = [], rules = [], overrides = [], now = new Date() }) {
  const scoped = vehicle?.id ? records.filter((r) => !r.vehicle_id || r.vehicle_id === vehicle.id) : records

  const observations = collectOdometerObservations(vehicle, scoped)
  const pace = estimateDrivingPace(observations)
  const odometer = estimateCurrentMileage({ vehicle, observations, pace, now })
  const ctx = { now, pace, currentMileage: odometer.miles }

  const overrideMap = new Map(overrides.map((o) => [o.item_key, o]))

  const flags = []
  for (const base of rules) {
    if (base.type === 'other') continue // catch-all bucket, never flagged

    const override = overrideMap.get(base.item_key)
    if (override?.enabled === false) continue

    const rule = resolveRule(base, override)
    const evaluated = evaluateRule(rule, recordsForItem(scoped, rule.item_key), ctx)

    // Projections built on a guessed pace deserve a visible caveat rather than
    // false confidence — but only where a projection is actually being shown.
    let detail = evaluated.detail
    if (
      pace.confidence === 'assumed' &&
      evaluated.status !== STATUS.UNKNOWN &&
      evaluated.dueBasis === 'mileage'
    ) {
      detail = [detail, `Assumes ${fmtInt(DEFAULT_MILES_PER_MONTH)} mi/month — log another dated record to calibrate.`]
        .filter(Boolean)
        .join(' ')
    }

    flags.push({
      itemKey: rule.item_key,
      displayName: rule.display_name,
      type: rule.type,
      unit: rule.unit,
      ruleNotes: rule.notes,
      sortOrder: rule.sort_order ?? 100,
      isCustomised: Boolean(override),
      ...evaluated,
      detail,
    })
  }

  flags.sort(compareFlags)

  const summary = flags.reduce(
    (acc, f) => ({ ...acc, [f.status]: (acc[f.status] ?? 0) + 1 }),
    { red: 0, yellow: 0, green: 0, unknown: 0 },
  )

  return { flags, pace, odometer, summary }
}
