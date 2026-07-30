# Fix drill-down dates showing one day early

## What & Why
Dates on the order drill-down page display one day earlier than the Job Chip, Job Chip hover, and the D365 ERP data. Cause: the drill-down's date formatter passes the raw UTC-midnight timestamp into `new Date()`, which shifts the calendar date back a day when rendered in a timezone behind UTC. The board's formatter truncates to the date portion and parses it as a local date, which is correct.

## Done looks like
- All dates on the order drill-down page match the Job Chip, Job Chip hover, and the D365 source data exactly
- No other page regresses (audit for any other `new Date(dateString)` formatting of D365 date fields)

## Out of scope
- Changing how the API returns dates
- Any visual/layout changes to the drill-down

## Steps
1. **Fix the drill-down formatter** — change it to truncate the timestamp to its date part and parse as a local date (same approach as the board's short-date formatter), keeping the "MMM d, yyyy" output format.
2. **Audit for the same bug elsewhere** — search the shop-floor app (and mobile app) for other places D365 date strings are passed directly to `new Date()` for calendar-date display, and apply the same fix.
3. **Add a regression test** — a unit test asserting that a UTC-midnight ISO timestamp formats to the same calendar date regardless of local timezone.

## Relevant files
- `artifacts/shop-floor/src/pages/order-detail.tsx:90-93`
- `artifacts/shop-floor/src/pages/dashboard.tsx:103-106`
