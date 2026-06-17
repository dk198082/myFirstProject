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

**Why:** these were discovered by probing the live CRM DB; guessing FS-equivalent column names fails at runtime
(e.g. `column wo.msdyn_displayaddress does not exist`).

**How to apply:** when adding any new d365crm-backed endpoint, probe column existence first (the password in
`D365CRM_DATABASE_URL` breaks pg URL parsing, so getCrmPool regex-parses it — copy that parseUrl for ad-hoc probes
and run node from `artifacts/api-server`). Prefer COALESCE(real column, raw_json FormattedValue) for names/labels.
