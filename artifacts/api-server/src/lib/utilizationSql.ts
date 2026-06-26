// Single source of truth for the resource-utilization "open-ended vs. timed
// job" rule. This rule is implemented in raw SQL inside two endpoints that read
// from two different databases:
//
//   - GET /resource-utilization      (FS database, `bookings` table)
//   - GET /wb/resource-utilization   (d365crm database, `crm.booking` table)
//
// The two endpoints store booking times differently, so the SQL fragments are
// not identical, but they must stay in behavioural parity. Keeping the
// fragments here (instead of inline in each route) lets the route handlers and
// the test-suite share the exact same SQL, so the parity rule cannot regress in
// one endpoint without the tests noticing.
//
// The rule:
//   1. An open-ended booking (missing a start time OR an end time) counts as a
//      flat 8h (OPEN_ENDED_BOOKING_MINUTES) — a single working day.
//   2. A timed booking (both start and end present) counts its real duration,
//      rounded to the nearest 30 minutes, with NO upper cap, so genuinely long
//      jobs and over-booking still surface.
//   3. Cancelled / no-show bookings never represent worked time, so they are
//      excluded from the utilization total entirely.

// One open-ended booking, or one whole working day, counts as 8 hours.
export const OPEN_ENDED_BOOKING_MINUTES = 480;

// ── FS database (`bookings` table) ───────────────────────────────────────────
//
// The FS `bookings` row exposes the booking's time-of-day as the TIME columns
// `crmstarttime` / `crmendtime` and a pre-computed `duration_minutes` integer.
// The booking is LEFT JOINed, so `b.booking_id IS NULL` means "no booking".
export const FS_UTILIZED_MINUTES_SQL = `
  CASE
    WHEN b.booking_id IS NULL THEN 0
    WHEN b.crmstarttime IS NULL OR b.crmendtime IS NULL THEN ${OPEN_ENDED_BOOKING_MINUTES}
    ELSE ROUND(COALESCE(b.duration_minutes, 0) / 30.0) * 30
  END`;

// Excludes cancelled / no-show FS bookings from the utilization total. Lives in
// the LEFT JOIN ON clause so technicians with only cancelled bookings still
// render (with zero utilized minutes) instead of dropping out of the result.
export const FS_BOOKING_NOT_CANCELLED_SQL = `
  COALESCE(b.booking_status, '') NOT ILIKE 'cancel%'
  AND COALESCE(b.booking_status, '') NOT ILIKE '%no show%'
  AND COALESCE(b.booking_status, '') NOT ILIKE '%no-show%'`;

// ── d365crm database (`crm.booking` table) ───────────────────────────────────
//
// The CRM booking has no stored duration; the timed duration is derived from the
// `starttime` / `endtime` timestamptz columns. The booking-status name lives in
// the OData "FormattedValue" key inside `raw_json`.
const CRM_BOOKING_STATUS_FV = `b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue'`;

export const WB_UTILIZED_MINUTES_SQL = `
  CASE
    WHEN b.bookableresourcebookingid IS NULL THEN 0
    WHEN b.starttime IS NULL OR b.endtime IS NULL THEN ${OPEN_ENDED_BOOKING_MINUTES}
    ELSE ROUND((EXTRACT(EPOCH FROM (b.endtime - b.starttime)) / 60) / 30) * 30
  END`;

export const WB_BOOKING_NOT_CANCELLED_SQL = `
  COALESCE(${CRM_BOOKING_STATUS_FV}, '') NOT ILIKE 'cancel%'
  AND COALESCE(${CRM_BOOKING_STATUS_FV}, '') NOT ILIKE '%no show%'
  AND COALESCE(${CRM_BOOKING_STATUS_FV}, '') NOT ILIKE '%no-show%'`;
