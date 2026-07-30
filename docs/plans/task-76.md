---
title: Expected consumption pace indicator
---
# Expected Consumption Pace Indicator

## What & Why
Add an "expected consumption" value per production order so the board shows whether a job is on pace. Using the scheduled start/end window of the non-bookend operations (exclude 'Warehouse Pick%' and 'Warehouse Receive%'), compute the required hours-per-working-day to finish the total scheduled hours by the end date. Then, given the current date/time, compute how many hours should have been posted by now. Comparing this to actual posted hours reveals ahead/behind schedule status.

## Done looks like
- The /production-board API returns an `expectedconsumedhours` value per order (and optionally the window dates), computed as: total scheduled hours × (elapsed working time within the window ÷ total working time in the window), clamped to [0, total].
- Working time counts Mon–Fri only (consistent with the Schedule Board's Mon–Fri 8h day convention); partial elapsed day counted proportionally by time of day.
- Orders whose window hasn't started show expected = 0; orders past their end date show expected = total.
- The board card tooltip shows expected vs actual (e.g., "Expected by now: 62h · Posted: 45h") with an ahead/behind indicator.
- The card progress bar gains a subtle pace marker (tick/line at the expected % position) so users can see actual vs expected at a glance.
- Behavior verified with a real started order.

## Out of scope
- No D365 write-back; read-only computation.
- No changes to how consumed hours or total hours are computed.
- No per-operation pacing (order-level only).
- Company working calendar/holidays from D365 (assume simple Mon–Fri).

## Steps
1. **Window computation in board query** — In the production board endpoint, derive per-order min(scheduledfromdate)/max(scheduledenddate) over deduped non-warehouse route operations (reuse existing DISTINCT ON dedup pattern to avoid staging fan-out).
2. **Expected hours calculation** — Compute expected consumption at request time using weekday-only elapsed fraction of the window, clamped, and add it to the API response and OpenAPI spec (rebuild lib declarations after spec changes).
3. **UI: tooltip + pace marker** — Show expected vs posted hours with ahead/behind status in the order card tooltip, and render an expected-position tick on the HoursProgress bar in both board and unallocated cards.

## Relevant files
- `artifacts/api-server/src/routes/production.ts`
- `artifacts/shop-floor/src/pages/dashboard.tsx`
- `lib/api-spec/openapi.yaml`
- `.agents/memory/header-staging-fanout.md`