# Hide Empty Techs On Board

## What & Why
On the Dynamics Write Back schedule board, technicians with no jobs in the
selected date range are currently shown as empty rows. The user wants the board
to only list technicians that actually have jobs, so the view stays focused on
real scheduled work.

## Done looks like
- The schedule board (Week, Month, and Calendar/print views) only displays
  technicians who have at least one job in the current range.
- Region technician counts and the technician filter dropdown reflect only
  technicians with jobs.
- Regions with no technicians that have jobs are not shown as empty.
- No change to the data the API returns for other consumers; this is a
  display-only filter on the board.

## Out of scope
- Changing the `/wb/schedule-board` API response shape or removing the empty
  technician rows on the backend.
- Any unscheduled-jobs or workload panel work (handled separately).

## Steps
1. In the schedule board page, derive a filtered region list where each region's
   technicians include only those with one or more jobs, and drop regions that
   end up with no technicians.
2. Make all board views, region/technician counts, and the technician filter
   dropdown read from this filtered list so empty technicians never appear.

## Relevant files
- `artifacts/dynamics-write-back/src/pages/ScheduleBoard.tsx:308-407`
- `artifacts/dynamics-write-back/src/pages/ScheduleBoard.tsx:570-580,870-930`
