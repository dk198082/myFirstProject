---
name: d365crm write-back endpoint schema quirks
description: Non-obvious crm.* column/source choices when building d365crm-backed /wb endpoints in api-server
---

# d365crm write-back endpoint schema quirks

## New booking write-backs reuse the booking_writebacks table

`booking_writebacks.booking_id` is NOT NULL, so scheduling a brand-new booking
(for an unscheduled work order) stages a row with a **synthetic** booking id of
the form `new:<workOrderId>` instead of adding a nullable column. The `/wb/sync`
loop branches on this prefix: `new:` rows call `createBooking` (POST
bookableresourcebooking, binds `msdyn_WorkOrder@odata.bind` + optional
`Resource@odata.bind`), everything else calls `patchBooking`.

**Why:** avoids a schema migration while still distinguishing create vs. patch.
**How to apply:** any new write-back "verb" should keep using the prefix
convention on `booking_id` and add a matching branch in the sync loop; the
frontend detects `new:` to render a "New booking" badge.

CRM-backed `/wb/*` endpoints in `artifacts/api-server/src/routes/writeback.ts` read the d365crm
Postgres mirror (`crm.*` tables) via `getCrmPool()`. Several fields do NOT map the way the FS schema does:

- **Work-order calibration due date**: there is no due-date column on `crm.workorder`. Derive it from
  `MIN(crm.cf_workordercustomerequipment.cf_nextcalibrationdate)` joined on `woce.workorderid = wo.msdyn_workorderid`.
  Only a small fraction of unscheduled WOs have one — the frontend buckets nulls into "Future / unset".
- **Service location address**: `wo.msdyn_displayaddress` does NOT exist. Use `cf_servicelocation` formatted
  value first, fall back to `wo.msdyn_address1`.
- **Booking duration**: `crm.booking` has no stored duration column. Compute minutes as
  `EXTRACT(EPOCH FROM (endtime - starttime)) / 60`.
- **Resource→region mapping**: join `crm.msdyn_resourceterritory` (resource→territory). Use `DISTINCT ON
  (resource)` because a resource can have multiple territory rows.
- **Staged write-back overlay on the schedule board**: `booking_writebacks` lives in the app DB (`localPool`),
  a DIFFERENT database from the CRM mirror (`getCrmPool()`) — you CANNOT join them in one SQL query. Fetch the
  board from CRM, fetch queued (status='queued', latest-per-booking via `DISTINCT ON`) write-backs from localPool,
  then overlay in JS. A move can reassign technician, so re-home the booking under the target tech's row/region
  (build a techId→{regionid_id,name,email} map from the board rows) and recompute day_index from the staged start.
  **Why:** without this overlay, drag-to-reschedule stages a row but the board (and client-side conflict
  highlighting, which is derived from job start/end+tech) keeps showing the old position until sync.

## Work-order detail must be sourced from d365crm, not FS

The FS database (technician-dashboard data source, behind `GET /work-orders/:id`)
and the d365crm mirror are DISJOINT — different work-order GUIDs and numbers, and
FS holds only ~1331 seed/test rows (WO-10001, TEST-*). A dynamics work order will
never resolve through the FS detail endpoint. To show detail for dynamics jobs,
read from `crm.*` (e.g. `GET /wb/work-orders/:workOrderId/detail`).

**Why:** the two stores are separate Postgres DBs with no shared identifiers.
**How to apply:** any dynamics-write-back feature that needs per-record data must
go through a `/wb/*` (crm-backed) endpoint, never the FS `/api/*` routes.

- crm mirror has NO work-order product/service line tables (only a `product`
  master), so `products`/`services` arrays are always empty in a crm-backed detail.
- Status display names (`system_status`, `sub_status`) come from raw_json
  `..._value@...FormattedValue` keys — the raw lookup columns hold GUIDs, so map the
  FormattedValue (null when absent) to avoid GUID-like UI text.

## Resource utilization: open-ended = flat 8h, timed = real duration (no cap)

`/wb/resource-utilization` (CRM) and `/resource-utilization` (FS legacy) must produce matching
numbers and obey the SAME per-booking rule:
- **Open-ended booking** (missing a start time OR an end time) → flat 8h (480 min), one working day.
  On CRM: `b.starttime IS NULL OR b.endtime IS NULL`. On FS legacy: `crmstarttime IS NULL OR crmendtime IS NULL`.
- **Timed booking** (both times) → its ACTUAL duration with NO cap (may exceed 8h, so long jobs and
  overbooking surface), rounded to the nearest 30 min. CRM computes `end-start`; FS legacy rounds the
  precomputed `duration_minutes`. Round via `ROUND(minutes/30)*30`.
- Still exclude cancelled / no-show via `NOT ILIKE 'cancel%'` / `'%no show%'` on
  `_bookingstatus_value@...FormattedValue`.
- **Range placement:** CRM filter changed from `starttime >= … AND endtime IS NOT NULL` to
  `COALESCE(starttime, endtime)` bounds so time-less bookings are still counted. FS legacy already
  places by `crmstart_time` (date) so no filter change needed.
- **Calendar labels mirror this:** a chip with a missing start/end time shows the literal `"8 hrs"`
  (FS board via `chipTimeLabel` early-return; technician dashboard inline) instead of a range/All-day.
- **History:** an earlier version capped each booking to 8h PER JOB PER DAY via `generate_series` +
  `LEAST(…, workingMinPerDay)`. That cap was REMOVED — do NOT reintroduce it; timed jobs are now
  uncapped on purpose.
  **Why:** the CRM mirror still has outlier multi-thousand-hour spans, but those are open-ended (no
  real end) and now collapse to the flat 8h rule, so the cap is no longer the safeguard.

**GOTCHA — guard the LEFT JOIN per-booking expression with `CASE WHEN b.<pk> IS NULL THEN 0`.**
A technician with zero bookings is an unmatched LEFT JOIN row (all b.* NULL); without the guard the
`CASE` could mis-fire (e.g. the `starttime IS NULL OR endtime IS NULL` branch would award a bogus 480).

**Why:** these were discovered by probing the live CRM DB; guessing FS-equivalent column names fails at runtime
(e.g. `column wo.msdyn_displayaddress does not exist`).

**How to apply:** when adding any new d365crm-backed endpoint, probe column existence first (the password in
`D365CRM_DATABASE_URL` breaks pg URL parsing, so getCrmPool regex-parses it — copy that parseUrl for ad-hoc probes
and run node from `artifacts/api-server`). Prefer COALESCE(real column, raw_json FormattedValue) for names/labels.
