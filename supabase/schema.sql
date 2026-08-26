-- ===========================================================================
-- Glovebox — full database schema
-- ===========================================================================
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- It is idempotent: re-running it will not destroy your data.
--
-- Everything is scoped by `vehicles.owner_id`, which is a Supabase auth user.
-- That is the whole reason multi-user sharing later needs no schema change —
-- the row-level security policies below already enforce per-owner isolation
-- today, while the app happens to have exactly one user.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- service_rules — seeded reference data
-- ---------------------------------------------------------------------------
-- Shared across all users. Per-vehicle deviations (a manual that specifies a
-- different oil interval, say) go in `vehicle_service_rules` below rather than
-- being edited here, so one user's tweak can never move another user's numbers.
--
-- Note on threshold columns: the spec sketched a single yellow/red pair, but
-- interval items genuinely need four numbers — an item can go yellow on either
-- mileage or elapsed time, whichever arrives first, and that is exactly how a
-- low-mileage car ends up with six-year-old tires. So interval items use
-- yellow_mileage / yellow_months / red_mileage / red_months, and measurable
-- items use yellow_threshold / red_threshold with `unit`. A null threshold
-- means "this dimension does not apply" and is skipped, not treated as zero.
create table if not exists public.service_rules (
  item_key              text primary key,
  display_name          text        not null,
  type                  text        not null
                          check (type in ('interval', 'measurable', 'qualitative', 'other')),

  -- Nominal manufacturer-ish interval, used for the plain-English notes.
  mileage_interval      integer,
  time_interval_months  integer,

  -- Interval-type thresholds.
  yellow_mileage        integer,
  yellow_months         integer,
  red_mileage           integer,
  red_months            integer,

  -- Measurable-type thresholds (tread depth, pad thickness).
  yellow_threshold      numeric,
  red_threshold         numeric,

  unit                  text,
  sort_order            integer     not null default 100,

  -- Past-tense verb used in the flag list: "Last {done|fitted|replaced} Mar 2024".
  -- Null means "done". Tires are fitted and batteries are replaced, and the flag
  -- rows are the one thing this app should read well, so it is worth a column.
  action_verb           text,

  notes                 text,
  created_at            timestamptz not null default now()
);

-- Columns added after the first release go here as well, so that re-running
-- this file against an existing database picks them up. `create table if not
-- exists` alone would silently skip them.
alter table public.service_rules add column if not exists action_verb text;

-- ---------------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------------
create table if not exists public.vehicles (
  id               uuid        primary key default gen_random_uuid(),
  owner_id         uuid        not null references auth.users (id) on delete cascade,
  nickname         text        not null,
  make             text,
  model            text,
  year             integer     check (year is null or (year between 1900 and 2100)),
  -- Best known odometer reading. Ratcheted upward automatically by the trigger
  -- below whenever a newer, higher record lands; only ever lowered by an
  -- explicit user correction (the app asks first — a lower OCR reading is far
  -- more often a misread digit than a real number).
  current_mileage  integer     not null default 0 check (current_mileage >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists vehicles_owner_id_idx on public.vehicles (owner_id);

-- ---------------------------------------------------------------------------
-- service_records
-- ---------------------------------------------------------------------------
-- One row per line item, not per receipt: a single visit that changed the oil
-- and measured the tyres produces two rows sharing a `receipt_group`. That is
-- what lets the flag list answer "when was the oil last done" without having to
-- re-parse free text.
create table if not exists public.service_records (
  id                  uuid        primary key default gen_random_uuid(),
  vehicle_id          uuid        not null references public.vehicles (id) on delete cascade,
  service_date        date        not null,
  mileage_at_service  integer     check (mileage_at_service is null or mileage_at_service >= 0),

  -- Canonical key. Anything the shop wrote that does not map to a known item
  -- lands on 'other' with the original wording preserved in service_type_raw,
  -- so the record is still searchable and nothing is silently dropped.
  service_type        text        not null references public.service_rules (item_key),
  service_type_raw    text,

  cost                numeric(10, 2) check (cost is null or cost >= 0),

  -- Measurable items: tread in 32nds, pad thickness in mm, etc.
  measured_value      numeric,

  -- Qualitative items (brake rotors): the shop's stated verdict. There is no
  -- universal millimetre spec for a rotor — each one carries its own stamped
  -- minimum — so the useful signal is the inspector's conclusion, not a number.
  verdict             text        check (verdict is null or verdict in
                          ('within_spec', 'near_minimum', 'below_minimum')),

  vendor              text,
  raw_notes           text,
  source              text        not null default 'manual' check (source in ('ocr', 'manual')),

  -- Groups the line items extracted from one scanned receipt.
  receipt_group       uuid,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists service_records_vehicle_idx
  on public.service_records (vehicle_id, service_date desc);

-- The flagging engine's hottest query: "most recent record of item X for car Y".
create index if not exists service_records_lookup_idx
  on public.service_records (vehicle_id, service_type, service_date desc);

create index if not exists service_records_group_idx
  on public.service_records (receipt_group) where receipt_group is not null;

-- ---------------------------------------------------------------------------
-- vehicle_service_rules — per-vehicle overrides
-- ---------------------------------------------------------------------------
-- Every column is nullable and overrides the matching `service_rules` column
-- only when set. This is what makes the defaults "not gospel": if your manual
-- says 5,000-mile oil changes because you run conventional oil, you set one
-- number here and the app logic never changes.
--
-- `enabled = false` removes an item from the vehicle's flag list entirely —
-- for a manual transmission, or an item the car simply does not have.
create table if not exists public.vehicle_service_rules (
  vehicle_id            uuid    not null references public.vehicles (id) on delete cascade,
  item_key              text    not null references public.service_rules (item_key) on delete cascade,
  enabled               boolean not null default true,

  mileage_interval      integer,
  time_interval_months  integer,
  yellow_mileage        integer,
  yellow_months         integer,
  red_mileage           integer,
  red_months            integer,
  yellow_threshold      numeric,
  red_threshold         numeric,
  notes                 text,

  updated_at            timestamptz not null default now(),
  primary key (vehicle_id, item_key)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vehicles_touch_updated_at on public.vehicles;
create trigger vehicles_touch_updated_at
  before update on public.vehicles
  for each row execute function public.touch_updated_at();

drop trigger if exists service_records_touch_updated_at on public.service_records;
create trigger service_records_touch_updated_at
  before update on public.service_records
  for each row execute function public.touch_updated_at();

-- Ratchet the odometer forward, never backward.
--
-- Deliberately one-directional. A scanned receipt showing *more* miles than we
-- have on file is just new information and is applied silently. A receipt
-- showing *fewer* is ambiguous — it is either an older record from the backlog
-- being scanned out of order, or a misread digit — so this trigger leaves it
-- alone and the app surfaces the discrepancy for the user to confirm.
create or replace function public.sync_vehicle_mileage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mileage_at_service is not null then
    update public.vehicles
       set current_mileage = new.mileage_at_service
     where id = new.vehicle_id
       and current_mileage < new.mileage_at_service;
  end if;
  return new;
end;
$$;

drop trigger if exists service_records_sync_mileage on public.service_records;
create trigger service_records_sync_mileage
  after insert or update of mileage_at_service on public.service_records
  for each row execute function public.sync_vehicle_mileage();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Two independent gates stand between a request and a row, and both must pass:
--
--   GRANT  may this role touch the table at all? Failing it raises
--          "permission denied for table vehicles".
--   RLS    which rows within it? Failing it returns nothing on a read, or
--          "new row violates row-level security policy" on a write.
--
-- Supabase usually applies default privileges to new tables in `public`, but
-- that depends on which role created them and is not something to rely on, so
-- these are explicit. GRANT is idempotent, so re-running this file is safe.
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.vehicles              to authenticated;
grant select, insert, update, delete on public.service_records       to authenticated;
grant select, insert, update, delete on public.vehicle_service_rules to authenticated;

-- Reference data is read-only: there is no policy permitting writes either way,
-- but the grant says so too rather than leaving it to the policy alone.
grant select on public.service_rules to authenticated;

-- No grants to `anon`. Every table here requires a signed-in user, and the
-- policies below are all scoped `to authenticated`.

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Turned on from day one even though there is one user. The multi-user future
-- is then an invite flow and nothing else.
alter table public.vehicles              enable row level security;
alter table public.service_records       enable row level security;
alter table public.vehicle_service_rules enable row level security;
alter table public.service_rules         enable row level security;

drop policy if exists "own vehicles" on public.vehicles;
create policy "own vehicles" on public.vehicles
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "records for own vehicles" on public.service_records;
create policy "records for own vehicles" on public.service_records
  for all
  to authenticated
  using (
    exists (
      select 1 from public.vehicles v
       where v.id = service_records.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = service_records.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  );

drop policy if exists "overrides for own vehicles" on public.vehicle_service_rules;
create policy "overrides for own vehicles" on public.vehicle_service_rules
  for all
  to authenticated
  using (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_service_rules.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.vehicles v
       where v.id = vehicle_service_rules.vehicle_id
         and v.owner_id = (select auth.uid())
    )
  );

-- Reference data: readable by any signed-in user, writable by none. Changing a
-- global default is a deliberate act done here in the SQL editor; day-to-day
-- customisation belongs in vehicle_service_rules.
drop policy if exists "rules are readable" on public.service_rules;
create policy "rules are readable" on public.service_rules
  for select
  to authenticated
  using (true);

-- ===========================================================================
-- Migration: axle items split into front/rear
-- ===========================================================================
-- A single "Brake Pads" (or "Tire Tread") flag could not say which axle
-- needed the work, which is exactly the number a person acting on it needs.
-- Front and rear now track — and flag — separately: brake_pads_front/rear,
-- brake_rotors_front/rear, tires_tread_front/rear, tires_age_front/rear,
-- seeded below.
--
-- The old rows are dropped here, but only when nothing still references them
-- — the foreign key on service_records.service_type would reject the delete
-- otherwise. If you already have history logged under an old key, this is a
-- no-op and that row keeps working exactly as before; it just does not get
-- the front/rear split until re-logged (or backfilled by hand) under the new
-- item_keys.
delete from public.service_rules
 where item_key in ('brake_pads', 'brake_rotors', 'tires_tread', 'tires_age')
   and not exists (
     select 1 from public.service_records sr where sr.service_type = service_rules.item_key
   );

-- ===========================================================================
-- Seed data
-- ===========================================================================
-- Universal gas-vehicle items only. Anything make/model-specific or EV-specific
-- is deliberately left out of v1 and can be added later as new rows — no schema
-- change required.
--
-- Calibration rule these numbers follow: yellow marks "worth knowing", red marks
-- "actually do this now". Where sources give a range, yellow sits at the more
-- permissive end of the planning zone and red sits at the widely-cited real
-- minimum, rather than the conservative early-warning figure shops tend to quote.
insert into public.service_rules (
  item_key, display_name, type,
  mileage_interval, time_interval_months,
  yellow_mileage, yellow_months, red_mileage, red_months,
  yellow_threshold, red_threshold,
  unit, sort_order, action_verb, notes
) values
  ('oil_change', 'Oil & Filter', 'interval',
   10000, 12,  8000, 10, 10000, 12,  null, null,
   'miles', 10, 'changed',
   'Assumes full synthetic. Drop the interval to about 5,000 miles if you run conventional oil.'),

  ('transmission_fluid', 'Transmission Fluid', 'interval',
   100000, 120,  85000, 96, 100000, 120,  null, null,
   'miles', 20, 'changed',
   'Some modern automatics are sold with a "lifetime" fill. If your manual says so, treat this as informational rather than overdue.'),

  ('brake_pads_front', 'Brake Pads (Front)', 'measurable',
   null, null,  null, null, null, null,  5, 3,
   'mm', 30, 'replaced',
   'New pads are roughly 10-12mm. The measured value comes from a shop inspection report. Front pads usually wear faster than rear.'),

  ('brake_pads_rear', 'Brake Pads (Rear)', 'measurable',
   null, null,  null, null, null, null,  5, 3,
   'mm', 31, 'replaced',
   'New pads are roughly 10-12mm. The measured value comes from a shop inspection report.'),

  ('brake_rotors_front', 'Brake Rotors (Front)', 'qualitative',
   null, null,  null, null, null, null,  null, null,
   'verdict', 40, 'inspected',
   'No universal millimetre value — every rotor carries its own stamped minimum thickness. What gets recorded is the shop''s stated verdict: within spec, near minimum, or below minimum.'),

  ('brake_rotors_rear', 'Brake Rotors (Rear)', 'qualitative',
   null, null,  null, null, null, null,  null, null,
   'verdict', 41, 'inspected',
   'No universal millimetre value — every rotor carries its own stamped minimum thickness. What gets recorded is the shop''s stated verdict: within spec, near minimum, or below minimum.'),

  ('brake_fluid', 'Brake Fluid', 'interval',
   45000, 36,  40000, 30, 45000, 36,  null, null,
   'miles', 50, 'flushed',
   'Time matters more than mileage here — brake fluid absorbs moisture from the air whether or not you drive.'),

  ('tires_tread_front', 'Tire Tread (Front)', 'measurable',
   null, null,  null, null, null, null,  4, 2,
   '32nds of an inch', 60, 'measured',
   'New tires start around 10-11/32. The federal legal minimum is 2/32, which is where red sits; wet-weather grip falls off well before that, which is what yellow at 4/32 is for. Front tires usually wear faster on a front-wheel-drive car.'),

  ('tires_tread_rear', 'Tire Tread (Rear)', 'measurable',
   null, null,  null, null, null, null,  4, 2,
   '32nds of an inch', 61, 'measured',
   'New tires start around 10-11/32. The federal legal minimum is 2/32, which is where red sits; wet-weather grip falls off well before that, which is what yellow at 4/32 is for.'),

  ('tires_age_front', 'Tire Age (Front)', 'interval',
   null, 72,  null, 60, null, 72,  null, null,
   'months', 70, 'fitted',
   'An age cap independent of mileage. This is what catches a low-mileage car whose tires still look fine but have hardened with age. Recorded from the date the tires were fitted. Only offset from the rear if the axles were shod separately rather than as a full set.'),

  ('tires_age_rear', 'Tire Age (Rear)', 'interval',
   null, 72,  null, 60, null, 72,  null, null,
   'months', 71, 'fitted',
   'An age cap independent of mileage. This is what catches a low-mileage car whose tires still look fine but have hardened with age. Recorded from the date the tires were fitted.'),

  ('cabin_air_filter', 'Cabin Air Filter', 'interval',
   20000, 12,  17000, 10, 20000, 12,  null, null,
   'miles', 80, 'replaced', null),

  ('engine_air_filter', 'Engine Air Filter', 'interval',
   30000, null,  25000, null, 30000, null,  null, null,
   'miles', 90, 'replaced',
   'Mileage-driven rather than time-sensitive.'),

  ('coolant', 'Coolant', 'interval',
   100000, 120,  85000, 96, 100000, 120,  null, null,
   'miles', 100, 'flushed',
   'Assumes long-life / OAT coolant, standard on most cars built since the 2000s.'),

  ('spark_plugs', 'Spark Plugs', 'interval',
   100000, 120,  85000, 96, 100000, 120,  null, null,
   'miles', 110, 'replaced',
   'Assumes iridium or platinum plugs, standard on most modern cars. Drop to about 30,000 miles for copper. The spec listed only the mileage thresholds; the 8-year / 10-year pair mirrors the other 100,000-mile items.'),

  ('battery', 'Battery', 'interval',
   null, 60,  null, 48, null, 60,  null, null,
   'months', 120, 'replaced',
   'Time only; there is no mileage relationship. At yellow, a voltage or load test is a better move than an automatic replacement.'),

  -- Catch-all so an unrecognised line item on a receipt is still stored,
  -- searchable, and attributable, rather than being dropped on the floor.
  -- Type 'other' is never flagged.
  ('other', 'Other Service', 'other',
   null, null,  null, null, null, null,  null, null,
   null, 999, null,
   'Anything that does not map to a tracked item. Kept for the service log and never flagged.')

on conflict (item_key) do update set
  display_name         = excluded.display_name,
  type                 = excluded.type,
  mileage_interval     = excluded.mileage_interval,
  time_interval_months = excluded.time_interval_months,
  yellow_mileage       = excluded.yellow_mileage,
  yellow_months        = excluded.yellow_months,
  red_mileage          = excluded.red_mileage,
  red_months           = excluded.red_months,
  yellow_threshold     = excluded.yellow_threshold,
  red_threshold        = excluded.red_threshold,
  unit                 = excluded.unit,
  sort_order           = excluded.sort_order,
  action_verb          = excluded.action_verb,
  notes                = excluded.notes;
