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
-- Records scanned before the date-extraction fix have one of two problems: the
-- date was dropped entirely, or the day of the scan was substituted because
-- the column used to be NOT NULL. The second is the dangerous one — a 2019 oil
-- change dated to the day you scanned it wrecks the driving-pace estimate that
-- every projection depends on.
--
-- Columns:
--   dated_as_today    the substitution. Wrong, and silently so.
--   no_date           honest but unusable for interval flagging.
--   app_can_recover   the transcription still holds a date, so the in-app
--                     "Recover dates" banner will fix these for free.
--   needs_hand_entry  no date anywhere in the text — usually a continuation
--                     page, which inherits its date once grouped, or a receipt
--                     that genuinely never had one.
--
-- The regex mirrors the parser in src/lib/receiptDate.js. It is an
-- approximation: it asks only whether something date-shaped is present, so
-- treat `app_can_recover` as an upper bound and the banner's own count as the
-- authority.
with tagged as (
  select
    v.nickname,
    r.source,
    r.service_date,
    r.created_at::date as scanned_on,
    coalesce(r.raw_notes, '') ~*
      '(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})|((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{2,4})|(\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{2,4})'
      as date_in_text
  from public.service_records r
  join public.vehicles v on v.id = r.vehicle_id
)
select
  nickname,
  count(*) filter (where source = 'ocr')                                as scanned_items,
  count(*) filter (where source = 'ocr' and service_date = scanned_on)  as dated_as_today,
  count(*) filter (where source = 'ocr' and service_date is null)       as no_date,
  count(*) filter (where source = 'ocr'
                     and (service_date is null or service_date = scanned_on)
                     and date_in_text)                                  as app_can_recover,
  count(*) filter (where source = 'ocr'
                     and (service_date is null or service_date = scanned_on)
                     and not date_in_text)                              as needs_hand_entry,
  count(*) filter (where source = 'manual')                             as typed_by_hand
from tagged
group by nickname
order by nickname;


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
