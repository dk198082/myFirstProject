---
name: Calendar Report date-range boundary convention
description: Why Calendar Report end dates must be exclusive internally, and where that convention is enforced.
---

The Calendar Report pipeline (`/wb/calendar-report` backend query, `buildReportWeeks`,
`buildDateRangeLabel` in `calendarReportApi.ts`) treats `endDate` as **exclusive** —
"the day after the last day to include" — everywhere: the SQL filter uses
`starttime < $endDate`, the week-builder loop uses `monday < end`, and the label
builder subtracts a day before formatting.

Month-range mode already respects this: `monthEndDate = addMonths(start, count)` lands
on the 1st of the month *after* the range.

**Why:** any UI surface that lets a user pick an end date directly (e.g. a date-picker
"Custom range" mode) naturally produces an INCLUSIVE date — the user picks "Sept 4"
meaning "include Sept 4". Passing that picked date straight through as `endDate`
silently drops the entire last day's bookings/blocks, because every consumer treats
that date as the exclusive boundary instead.

**How to apply:** any new date-range entry point for the Calendar Report (or anything
reusing `buildReportWeeks`/`eventsForDay`) must convert a user-picked inclusive end
date to exclusive (`addDays(pickedEnd, 1)`) before assigning it to the `endDate`/`end_date`
passed downstream. Keep the inclusive picked date around separately for validation and
for building a day-precise display label.
