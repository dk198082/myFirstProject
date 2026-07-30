# Production Booking App

## What & Why
Build a NEW standalone web app (react-vite artifact) for setting a bi-weekly production
cadence, modeled on the "NEW Booking" middle section of the customer's SL_Cadence
spreadsheet. Production planners auto-generate recurring booking slots, then allocate
Production Orders (and an associated Sales Order) into those slots. Once allocated, the
slot pulls live details from the assigned records (customer, item, status, dates).

The app is organized into 4 tabs — **300SL**, **600SL**, **1000/2000SL**, **MetalsImpact** —
and Production Orders are auto-sorted into the correct tab by their item/model number.

This is a separate product from the existing shop-floor app (different purpose: interactive
planning + persistence vs. read-only monitoring). It reuses the existing API server and the
writable Replit Postgres for storing slot assignments.

## Done looks like
- A new web app with 4 tabs: 300SL, 600SL, 1000/2000SL, MetalsImpact.
- Each tab shows a bi-weekly cadence of booking slots laid out like the spreadsheet's
  "NEW Booking" section: Production Start, Pick, Assy Start, Assy days, Assy End, Ship Date.
- The cadence auto-generates a slot every 2 weeks (10 working days) months ahead; the user
  can also add, clear, or shift slots.
- The user can search Production Orders and allocate one into a slot. The order is auto-sorted
  to the correct tab by its item/model number; the user can still move it.
- When a Production Order is allocated, the slot pulls live info: status, item, production
  start date, delivery date, and the linked Sales Order's number + customer name.
- The Sales Order defaults to the one linked to the Production Order, but the user can change
  it to a different sales order.
- Assignments persist across reloads (stored server-side) and survive a restart.
- The schedule dates (Assy Start, Assy End, Ship Date) are computed with working-day math
  matching the spreadsheet's WORKDAY formulas.

## Out of scope
- Editing/writing back to D365 (Azure source data stays read-only; only the app's own
  slot/assignment data is writable).
- Authentication / per-user permissions.
- The spreadsheet's left "source list" section and right "KPI" section (the existing
  shop-floor app already covers KPIs); this app focuses on the "NEW Booking" section only.
- Mobile-specific layout (desktop-first planning tool).

## Steps
1. **Derive the item/model → tab mapping** — From the spreadsheet's model column (M) and the
   item numbers (E), and by querying the d365 data, establish the rule that maps each
   production order's item/model to one of the 4 tabs (e.g. item-number prefix ranges:
   ~090013xx→300SL, ~090026xx→600SL, ~09010xx/090094xx→1000/2000SL, ~120040xx→MetalsImpact).
   Confirm against real data before hardcoding; treat unmatched items as an "Unassigned" bucket.
2. **Booking persistence schema** — Add tables to the writable Postgres (via the shared db
   package) for booking slots (tab, cadence index, production start date, pick/assy/ship lead
   day settings) and slot assignments (allocated production order number, chosen sales order
   number, plus a snapshot of pulled fields for resilience).
3. **API endpoints** — Add endpoints on the existing API server to: list/search assignable
   production orders with the fields the slot needs (status, item, model/tab, production start,
   delivery date, linked sales order + customer); list/create/update/clear booking slots per
   tab; and allocate/clear a production order and override the sales order on a slot. Pulled
   D365 detail comes from the existing production/sales data sources.
4. **Scaffold the new web artifact** — Create a new react-vite artifact ("Production Booking")
   wired to the API server, registered with its own slug/preview path.
5. **Cadence + tab UI** — Build the 4-tab layout where each tab renders its bi-weekly slot
   cadence as a grid matching the spreadsheet's "NEW Booking" columns. Auto-generate the
   cadence and provide controls to add, clear, and shift slots.
6. **Allocation flow** — Let the user search and pick a Production Order to drop into a slot;
   auto-route it to the correct tab by item/model with an override; show pulled live details
   in the slot; default the Sales Order to the linked one and allow choosing a different one.
7. **Working-day scheduling** — Compute Assy Start / Assy End / Ship Date from Production Start
   using working-day math (Pick=5, Assy per-tab default 15/20/25, Ship lead=10) matching the
   spreadsheet WORKDAY formulas, with editable per-slot/per-tab assembly days.
8. **Verify** — Confirm assignments persist across reload/restart, auto-tab-sorting is correct
   for sampled orders, and the computed dates match the spreadsheet for a few known orders.

## Relevant files
- `artifacts/shop-floor/src/pages/booking-schedule.tsx`
- `artifacts/api-server/src/routes/production.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/app.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/db/src/index.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/drizzle.config.ts`
- `attached_assets/2026-06-15_SL_Cadence_Snaphot_1782494034173.xlsx`
