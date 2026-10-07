---
title: Search: potential jobs + all-future-dates
---
# Search: Potential Jobs + All-Future-Dates

## What & Why
The existing search only covers CRM-scheduled jobs visible in the current week/month view, and does not include potential jobs. Two improvements are needed:

1. **Include potential jobs** — Placeholder/potential job chips on the board are not currently dimmed or counted during a search; they should behave identically to CRM job chips.
2. **Always search all future dates** — Instead of a separate mode, every search automatically queries both job types across all future dates from the server and shows the results in a panel. No toggle required.

## Done looks like
- Typing in the search box dims potential job chips that don't match, exactly like CRM job chips.
- The match counter includes matching potential jobs.
- As the user types (with debounce), a results panel appears beneath the search box showing ALL future matches — both scheduled and potential jobs — regardless of the current view window.
- Each result shows: job-type badge ("Scheduled" / "Potential"), customer name or work order number, city/state, technician name, and date.
- Clicking a result closes the panel, navigates the board to the week containing that job, and keeps the query active so the matching chip is highlighted on the board.
- Results within the current view are already highlighted on the board; results outside the view require clicking to navigate to them.
- If the query is cleared, the panel closes and the board returns to normal.

## Out of scope
- Searching historical (past) dates.
- Searching the unscheduled jobs panel.
- Full-text search inside job notes.
- A separate "search current view only" vs "search all dates" toggle.

## Steps
1. **Extend client-side search to include potential jobs** — Add a `placeholderJobMatchesSearch` helper and apply the `dimmed` prop to `PlaceholderJobChip`s on the board. Include matching placeholder job count in the existing match counter.
2. **New server-side search endpoint** — Add `GET /api/wb/search?q=…` that queries `placeholder_jobs` (local DB, future dates only) and CRM bookings (CRM DB, future dates only) in parallel, returning a unified list: `type`, `id`, `work_order_number`, `customer_name`, `city`, `state`, `technician_name`, `start_date`.
3. **Register in OpenAPI spec and run codegen** — Add the endpoint to the OpenAPI spec so the React Query hook is auto-generated and type-safe.
4. **Results panel UI** — Below the search input, show a scrollable panel of all matches from the server (debounced, min 2 chars). Each row is clickable: navigates the board to the correct week and keeps the query active. Panel closes when the query is cleared.

## Relevant files
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:284-295`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:1743-1844`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:1920-1930`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:2415-2430`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:2640-2700`
- `artifacts/api-server/src/routes/writeback.ts:941-990`
- `artifacts/api-server/src/routes/writeback.ts:1182-1210`
- `lib/api-spec/openapi.yaml`