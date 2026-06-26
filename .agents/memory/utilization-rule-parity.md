---
name: Resource utilization open-ended vs. timed rule parity
description: How the two resource-utilization endpoints must stay in lock-step, and a known rounding divergence between them.
---

# Resource utilization: open-ended vs. timed job rule

Two endpoints implement the same utilization rule in raw SQL against two different DBs:
- `GET /resource-utilization` — FS db, `bookings` table (stored `duration_minutes`, TIME cols `crmstarttime`/`crmendtime`).
- `GET /wb/resource-utilization` — d365crm db, `crm.booking` (duration derived from `starttime`/`endtime` timestamptz; status in `raw_json` OData FormattedValue).

The rule: open-ended booking (missing start OR end) = flat 480 min (8h); timed booking = real duration rounded to nearest 30 min, NO cap; cancelled/no-show excluded.

**Single source of truth:** the SQL fragments now live in `artifacts/api-server/src/lib/utilizationSql.ts` (FS_* and WB_* constants). Both route handlers import them, and the test suite (`artifacts/api-server/src/routes/resourceUtilization.test.ts`) runs the exact same fragments against the local Postgres. Change the rule there, not inline, or the endpoints drift.

**Why:** the rule is easy to regress silently in one endpoint but not the other.

## Known divergence — numeric vs double ROUND at exact half-boundaries
FS rounds a stored integer: `ROUND(duration_minutes / 30.0) * 30` → `ROUND(numeric)` = round-half-AWAY-from-zero.
CRM rounds a computed double: `ROUND(EXTRACT(EPOCH ...)/60/30) * 30` → `ROUND(double precision)` = round-half-to-EVEN.
So a 75-min job → FS=90, CRM=60 (and any "x.5 thirty-units" landing on an odd unit). The tests deliberately avoid exact half-boundaries so they assert agreement; this edge is a real (small) parity gap, not yet aligned.

**How to apply:** when touching the timed-duration rounding, decide whether to unify rounding mode (e.g. cast CRM duration to numeric) if exact-boundary parity matters.
