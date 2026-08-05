# Schedule Board for Dynamics Write Back

## What & Why
Recreate the technician-dashboard Schedule Board (weekly/monthly region-grouped calendar with rich job tiles) inside the `dynamics-write-back` app, using the same visual design but sourcing data from the d365crm (`crm.*`) database instead of the FS Azure DB. This gives the write-back app its own schedule board view over the same bookings it stages edits against.

## Done looks like
- The Dynamics Write Back app has a new "Schedule Board" page reachable from its top nav.
- The board looks the same as the technician-dashboard one: region cards, Week / Month / Calendar view toggles, weekday columns, one row per technician, and rich job tiles (customer name, city/state, time + duration, work-order number, status code, conflict highlight).
- Regions are derived from crm territories, technicians from crm resources, and jobs from crm bookings for the selected date range.
- Date navigation (prev/next/today), region filter, technician filter, and print all work as on the original.
- Clicking a job tile opens the app's existing booking edit dialog (stage-then-sync), since this app is built for editing bookings.

## Out of scope
- Drag-and-drop, region expand/collapse, and the new direct-edit dialog discussed for the technician-dashboard (separate, still-pending work).
- Any change to the technician-dashboard schedule board itself.
- Writing schedule edits directly to crm (this app keeps its existing stage-to-local-queue then sync model).

## Steps
1. **Add a crm-backed schedule-board endpoint** — Define a new `GET /wb/schedule-board` (view + start params) in the OpenAPI spec, regenerate the typed hooks/schemas, then implement it in the API server reading from the crm pool. Group by territory (region) → resource (technician) → bookings in range, shaped identically to the existing FS schedule-board response (regions[].technicians[].jobs[] with day_index, date, time, customer, city/state, work-order number, status). Resolve human-readable names from `raw_json` formatted values per the d365crm data quirks, and map resources to territories via `crm.msdyn_resourceterritory` (fall back to the work order's service territory where needed).
2. **Build the Schedule Board page in dynamics-write-back** — Port the schedule-board UI/design from the technician-dashboard page, wired to the new crm hook. Reuse/copy any required shared UI pieces and helper functions, and adapt the page to the write-back app's own layout/nav (it has no TopNav component). Make job tiles open the app's existing booking edit dialog instead of linking to a work-order detail route.
3. **Wire up routing and navigation** — Add the new page to the app's router and add a "Schedule Board" link to the top nav alongside Work Orders and Queued Write-backs.

## Relevant files
- `artifacts/technician-dashboard/src/pages/ScheduleBoard.tsx`
- `artifacts/dynamics-write-back/src/App.tsx`
- `artifacts/dynamics-write-back/src/pages/WorkOrders.tsx`
- `artifacts/api-server/src/routes/writeback.ts`
- `artifacts/api-server/src/routes/scheduleBoard.ts`
- `artifacts/api-server/src/lib/crmDb.ts`
- `lib/api-spec/openapi.yaml:329`
