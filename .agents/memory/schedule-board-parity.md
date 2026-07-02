---
name: Schedule board parity (FS vs d365crm)
description: How the two schedule-board endpoints map regions→techs→bookings, with the required CRM territory/name fallbacks
---

# Schedule board parity (FS vs d365crm)

Two schedule-board endpoints must stay design/shape-identical:
- `GET /schedule-board` (FS Azure DB) in `scheduleBoard.ts`
- `GET /wb/schedule-board` (d365crm crm.* tables) in `writeback.ts`

## Region→technician mapping (CRM side)
- Primary: `crm.msdyn_resourceterritory` (resource→territory), DISTINCT ON resource.
- **Required fallback:** when a booking's resource has NO territory mapping, place it under the work order's service territory (`crm.workorder.msdyn_serviceterritory`). Do NOT drop such bookings.
- **Why:** using `msdyn_resourceterritory` alone silently drops bookings whose resource lacks a mapping, which breaks parity with the FS board (where every booking's tech has a region). The fallback keeps every booking on the board.
- The CRM query is a UNION: (A) every in-range booking with territory resolved via COALESCE(resource_territory, wo_service_territory); (B) mapped resources with no in-range bookings, so empty technician rows still render (parity with the FS board's LEFT JOIN behavior).

## Human-readable name fallbacks (CRM sparsity)
crm.* lookup tables are sparse, so resolve display names with COALESCE to the FormattedValue keys in `raw_json`:
- resource/tech name → `_resource_value@OData.Community.Display.V1.FormattedValue` (booking raw_json) when `bookableresource.name` is null.
- customer name → `_msdyn_serviceaccount_value@...FormattedValue` (workorder raw_json) when `account.name` is null.
- system status, work order type/title, booking status all come from workorder/booking `raw_json` FormattedValue keys.

## start-param convention
Both endpoints mark `start` as `required: false` in `openapi.yaml` but the handlers return 400 when it is missing; the frontends always pass it. This mirrors the existing FS endpoint — keep them consistent, don't special-case the CRM side.

## DB access quirk
`D365CRM_DATABASE_URL`'s password contains chars (`% # ! ^`) that break URL percent-decoding, so `psql "$D365CRM_DATABASE_URL"` and pg's `connectionString` both fail. `getCrmPool()` (`api-server/src/lib/crmDb.ts`) regex-parses the URL into discrete pg fields. For ad-hoc probes, reuse that same manual parse; never pass the raw URL to pg directly.
