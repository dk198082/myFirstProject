---
name: Resource utilization open-ended vs. timed rule parity
description: How the two resource-utilization endpoints must stay in lock-step, including the now-closed half-hour rounding parity.
---

# Resource utilization: open-ended vs. timed job rule

Two endpoints implement the same utilization rule in raw SQL against two different DBs:
- `GET /resource-utilization` — FS db, `bookings` table (stored `duration_minutes`, TIME cols `crmstarttime`/`crmendtime`).
- `GET /wb/resource-utilization` — d365crm db, `crm.booking` (duration derived from `starttime`/`endtime` timestamptz; status in `raw_json` OData FormattedValue).

The rule: open-ended booking (missing start OR end) = flat 480 min (8h); timed booking = real duration rounded to nearest 30 min, NO cap; cancelled/no-show excluded.

**Single source of truth:** the SQL fragments now live in `artifacts/api-server/src/lib/utilizationSql.ts` (FS_* and WB_* constants). Both route handlers import them, and the test suite (`artifacts/api-server/src/routes/resourceUtilization.test.ts`) runs the exact same fragments against the local Postgres. Change the rule there, not inline, or the endpoints drift.

**Why:** the rule is easy to regress silently in one endpoint but not the other.

## Half-hour rounding parity — CLOSED
Both endpoints now round in `numeric` (round-half-AWAY-from-zero), collapsing to `ROUND(minutes / 30) * 30`:
- FS: `ROUND(duration_minutes / 30.0) * 30` (stored integer ÷ numeric divisor).
- CRM: `ROUND(EXTRACT(EPOCH FROM (endtime - starttime))::numeric / 60 / 30) * 30` — the epoch is cast to `numeric` BEFORE any division, so every step is exact rational arithmetic.

**Why the cast must be on the epoch, up front:** `ROUND(double)` rounds half-to-EVEN, and even a late `((double)/30)::numeric` cast still rounds a value built by floating-point division (drift risk). Casting the raw epoch to numeric first removes both. Result: identical minutes for ALL durations, including every exact half-boundary (15/45/75/105/135 min → 30/60/90/120/150). The parity test cases assert these boundaries directly.

**How to apply:** keep all CRM timed-duration arithmetic in `numeric` (cast epoch first). Never round a `double precision` quotient — it reintroduces half-to-even divergence.
