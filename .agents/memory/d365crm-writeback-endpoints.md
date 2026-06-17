---
name: d365crm write-back endpoint schema quirks
description: Non-obvious crm.* column/source choices when building d365crm-backed /wb endpoints in api-server
---

# d365crm write-back endpoint schema quirks

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

**Why:** these were discovered by probing the live CRM DB; guessing FS-equivalent column names fails at runtime
(e.g. `column wo.msdyn_displayaddress does not exist`).

**How to apply:** when adding any new d365crm-backed endpoint, probe column existence first (the password in
`D365CRM_DATABASE_URL` breaks pg URL parsing, so getCrmPool regex-parses it — copy that parseUrl for ad-hoc probes
and run node from `artifacts/api-server`). Prefer COALESCE(real column, raw_json FormattedValue) for names/labels.
