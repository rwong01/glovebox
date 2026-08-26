-- ===========================================================================
-- Glovebox — maintenance queries
-- ===========================================================================
-- Not part of setup. These are for cleaning up after a bad scanning run.
-- Run them ONE AT A TIME in the Supabase SQL Editor, reading each first.
--
-- Every destructive query below is preceded by the SELECT that shows you what
-- it would touch. Run the SELECT, look at the count, then run the change.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. How good are my dates?
-- ---------------------------------------------------------------------------
-- Records scanned before the date-extraction fix have one of two problems:
-- the date was dropped entirely, or today's date was substituted because the
-- column used to be NOT NULL. The second is the dangerous one — a 2019 oil
-- change dated to the day you scanned it will wreck the driving-pace estimate
-- that every projection depends on.
select
  v.nickname,
  count(*)                                                as records,
  count(*) filter (where r.service_date is null)          as undated,
  count(*) filter (where r.service_date = r.created_at::date
                     and r.source = 'ocr')                as likely_substituted,
  min(r.service_date)                                     as earliest,
  max(r.service_date)                                     as latest
from public.service_records r
join public.vehicles v on v.id = r.vehicle_id
group by v.nickname
order by v.nickname;


-- ---------------------------------------------------------------------------
-- 2. Look at the suspect records before touching them
-- ---------------------------------------------------------------------------
-- A scanned record whose service date happens to equal the day it was scanned
-- is almost always the substitution, not a coincidence — you do not usually
-- scan a receipt the same day you get it, and never for a backlog.
--
-- `raw_notes` holds the full transcription, so you can see the real date the
-- page carried and judge for yourself.
select
  r.id,
  r.service_date  as recorded_as,
  r.created_at::date as scanned_on,
  r.mileage_at_service,
  r.service_type,
  left(replace(r.raw_notes, E'\n', ' '), 160) as transcription
from public.service_records r
join public.vehicles v on v.id = r.vehicle_id
where r.source = 'ocr'
  and r.service_date = r.created_at::date
order by r.created_at desc
limit 50;


-- ---------------------------------------------------------------------------
-- 3. Clear the substituted dates
-- ---------------------------------------------------------------------------
-- Sets them to NULL rather than guessing. An honestly undated record is
-- excluded from the pace calculation; a confidently wrong one poisons it.
-- The app now handles undated records properly and you can fill them in by
-- hand from the service log.
--
-- Uncomment to run.
--
-- update public.service_records r
--    set service_date = null
--   from public.vehicles v
--  where v.id = r.vehicle_id
--    and r.source = 'ocr'
--    and r.service_date = r.created_at::date;


-- ---------------------------------------------------------------------------
-- 4. Start the scanning over for one vehicle
-- ---------------------------------------------------------------------------
-- Usually the better option after a pipeline change: you still have the paper,
-- and a fresh run picks up dates, multi-page grouping and per-visit grouping
-- that the earlier one could not. Only removes SCANNED records — anything you
-- typed in by hand is left alone.
--
-- Replace the nickname, run the SELECT first to check the count, then
-- uncomment the DELETE.
--
-- select count(*) from public.service_records r
--   join public.vehicles v on v.id = r.vehicle_id
--  where v.nickname = 'The Civic' and r.source = 'ocr';
--
-- delete from public.service_records r
--  using public.vehicles v
--  where v.id = r.vehicle_id
--    and v.nickname = 'The Civic'
--    and r.source = 'ocr';
--
-- The odometer only ratchets up, so it keeps the highest reading it ever saw
-- even after the records behind it are gone. Reset it if that is now wrong:
--
-- update public.vehicles set current_mileage = 0 where nickname = 'The Civic';


-- ---------------------------------------------------------------------------
-- 5. Re-group records into visits
-- ---------------------------------------------------------------------------
-- The service log groups by `receipt_group` where present, and otherwise by
-- date + mileage + vendor. Records scanned one page at a time before the
-- grouping fix each got their own group, so pages of one invoice show as
-- separate visits. This merges any that share a date, mileage and vendor.
--
-- Uncomment to run.
--
-- with merged as (
--   select service_date, mileage_at_service, vendor, vehicle_id,
--          min(receipt_group::text)::uuid as keep
--     from public.service_records
--    where service_date is not null and mileage_at_service is not null
--    group by service_date, mileage_at_service, vendor, vehicle_id
--   having count(distinct receipt_group) > 1
-- )
-- update public.service_records r
--    set receipt_group = m.keep
--   from merged m
--  where r.vehicle_id         = m.vehicle_id
--    and r.service_date       = m.service_date
--    and r.mileage_at_service = m.mileage_at_service
--    and r.vendor is not distinct from m.vendor;
