---
name: wb resource-utilization minutes semantics
description: What is and isn't included in utilized_minutes from /wb/resource-utilization
---

**Rule:** `/wb/resource-utilization`'s `utilized_minutes` already includes placeholder (potential) job minutes, merged server-side with per-day 8h capping and range clamping. Clients must never re-add placeholder minutes to totals; use the separate `placeholder_minutes` field for display breakdowns only.

**Why:** A client-side re-sum of placeholder jobs on the schedule board double-counted potential hours in the capacity badges (July 2026).

**How to apply:** Board utilization total = `utilized_minutes` + drive-time + PTO block minutes; custom blocks excluded. Jobs-only display value = `utilized_minutes - placeholder_minutes`.
