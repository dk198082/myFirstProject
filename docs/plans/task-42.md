---
title: Potential job service location picker & detail view
---
# Potential Job Service Location Picker & Detail View

## What & Why

Dispatchers creating a Potential Job chip need to link it to a real CRM service location (account) rather than typing a customer name and city freehand. Once linked, the chip should surface the same rich hover detail that Job chips already show — customer info, assets at that location, and a link to a full detail view. This closes the gap between speculative placeholder scheduling and confirmed CRM work.

## Done looks like

- **Add / Edit Potential Job dialogs** show a searchable "Service Location" combobox. Typing filters live against `crm.account` records by account name, city, or state. Selecting a record auto-populates Customer Name, City, and State fields (which remain individually editable).
- `placeholder_jobs` table stores the selected `service_location_id` (CRM `accountid`).
- **PlaceholderJobChip tooltip** matches the JobChip tooltip layout: account/customer name, address, status badge (using the job's Status field), equipment list sourced from work orders at that service location, and a "View service location details" link at the bottom — mirroring the "View work order details" link on JobChip.
- Clicking "View service location details" navigates to a detail page (following the same routing pattern as `/work-order/:id`) that shows: account name and address, primary contact (name, phone, email), and a list of equipment/assets drawn from CRM work orders at that location.
- Hovering a PlaceholderJobChip that has no service location still shows the existing freeform tooltip (graceful fallback).

## Out of scope

- Editing CRM account data from the board.
- Linking a placeholder job to an existing open work order (a separate future feature).
- Syncing the placeholder's service location back to Dynamics.

## Steps

1. **DB migration** — Add `service_location_id` (nullable text) column to the `placeholder_jobs` table via `ALTER TABLE`. This is an out-of-band table so use `psql` directly, not Drizzle push. Confirm column added in dev.

2. **Service location search API** — Add `GET /wb/service-locations?search=<term>` to `writeback.ts` that queries `crm.account` on `name`, `msdyn_city`, and `msdyn_stateorprovince` (ILIKE, limit 20). Returns `id` (accountid), `name`, `city`, `state`, `address`. Add `GET /wb/service-locations/:locationId` that returns full account details (account row + primary contact from `crm.contact` + equipment list from `crm.cf_workordercustomerequipment` joined through `crm.workorder WHERE msdyn_serviceaccount = locationId`, deduped by equipment name). Add both endpoints to the OpenAPI spec and run codegen.

3. **Update Create/Update schemas and route handlers** — Include `service_location_id` in `createPlaceholderJobSchema`, `updatePlaceholderJobSchema`, the INSERT, UPDATE SET clause, SELECT column list, and all response-shape objects in `writeback.ts`. Follow the exact pattern already used for the `status` field (just added).

4. **Searchable combobox in Add dialog** — Replace or supplement the existing freeform Customer Name / City / State fields with a "Service Location" combobox in `AddBlockDialog.tsx` (visible only when `entryType === "potential_job"`). Use a controlled text input with a dropdown list of results fetched from the search endpoint (debounced, min 2 chars). On selection, auto-fill customer name, city, and state; store the `service_location_id`. Keep the freeform fields editable after auto-fill. Persist the selection label so it re-renders on re-open of the edit dialog.

5. **Same combobox in Edit dialog** — Apply the same service location combobox to `EditPlaceholderJobDialog.tsx`, pre-populated from `job.service_location_id`. A "Clear" action removes the link and reverts to freeform.

6. **Upgrade PlaceholderJobChip tooltip** — Rewrite the tooltip in `PlaceholderJobChip` (in `ScheduleBoard.tsx`) to match the JobChip tooltip structure: account name bold at top, address line, Status badge (using the existing `job.status` field as the badge label), equipment list (up to 5 items, fetched lazily or passed from a parent query), multi-day date/time range, notes, and a "View service location details" link with the `ExternalLink` icon pointing to `/service-location/${job.service_location_id}`. Fall back to the current simple layout when `service_location_id` is null.

7. **Service location detail page** — Add a `/service-location/:locationId` route to the schedule board app's router following the same pattern as the existing `/work-order/:workOrderId` route. The page calls `GET /wb/service-locations/:locationId` and renders: account name and full address, primary contact card (name, phone, email), and an equipment/asset table (name, serial number, last calibration date). Match the visual style of the existing Work Order Detail page.

## Relevant files

- `artifacts/api-server/src/routes/writeback.ts`
- `lib/api-spec/openapi.yaml`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx`
- `artifacts/field-service-schedule-board/src/components/AddBlockDialog.tsx`
- `artifacts/field-service-schedule-board/src/components/EditPlaceholderJobDialog.tsx`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`