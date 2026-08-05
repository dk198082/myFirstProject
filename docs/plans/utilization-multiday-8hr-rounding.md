# Utilization 8hr Multi-Day Rule

## What & Why
Refine how the resource-utilization calculation and the week-calendar time labels treat jobs based on whether they have both a start and end time. A job missing a start time or an end time is treated as an open-ended "multi-day" job and counted as a flat 8 hours (the existing per-day working-hours maximum). A job that has both a start and end time is a normal single-day job: its real duration counts toward utilization with no 8-hour cap, so genuinely long jobs and overbooking still surface. This makes the numbers and the calendar labels match the way dispatchers actually think about open-ended vs. timed work. Applies to both boards so they stay consistent.

## Done looks like
- In the utilization calculation, a job with no start time OR no end time contributes a flat 8 hours.
- In the utilization calculation, a job with both a start and end time contributes its actual duration with no 8-hour cap (it may exceed 8 hours), rounded to the nearest 30-minute increment.
- On the week calendar, a job with no start time OR no end time shows the label "8 hrs" instead of a start/end range or "All Day".
- On the week calendar, a job with both a start and end time keeps showing its normal time/duration label.
- Both the Field Service Schedule Board and the Technician Dashboard behave identically, with their respective backend endpoints producing matching numbers.

## Out of scope
- Changing the 40h/week (8h/day) capacity baseline or making capacity configurable (covered by other proposed tasks).
- Visual flagging/highlighting of over-booked technicians (separate task).
- Any change to cancelled/no-show exclusion behavior.
- Changing how multi-day spanned jobs are split into one chip per day (the D1/2 badges) — only the time label text changes.

## Steps
1. **Backend — d365crm utilization endpoint (`/wb/resource-utilization`)** — Replace the current per-day generate-series 8-hour clamp so that: bookings missing a start time or end time count as a flat 8 hours (480 min) each, and bookings with both times count their full duration within the requested range with NO 8-hour cap, rounded to the nearest 30 minutes. Note: the current query excludes rows where `endtime IS NULL` and bounds bookings by `starttime`, so the executor must adjust filtering so time-less bookings are still included and attributed to the correct period (using whatever date field reliably places the booking in range).

2. **Backend — legacy utilization endpoint (`/resource-utilization`)** — Apply the same rule against this endpoint's data model (which currently sums a precomputed `duration_minutes`): jobs missing a start or end time count as a flat 8 hours; jobs with both times count their real duration with no cap, rounded to the nearest 30 minutes. Keep the response shape unchanged so the Technician Dashboard keeps working.

3. **Week-calendar label — Field Service Schedule Board** — Update the chip time-label logic so a job with no start time OR no end time renders "8 hrs" (instead of the start/end range or "All Day"), while jobs with both times keep their existing duration/time label and multi-day chip-splitting behavior.

4. **Week-calendar label — Technician Dashboard** — Apply the same "8 hrs" label rule to this board's chip/job time display so the two boards read identically.

## Relevant files
- `artifacts/api-server/src/routes/writeback.ts:1153-1325`
- `artifacts/api-server/src/routes/resourceUtilization.ts:6-121`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:127-135,254-335`
- `artifacts/technician-dashboard/src/pages/ScheduleBoard.tsx:97,334-357,992-996`
