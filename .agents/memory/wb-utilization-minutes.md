---
name: wb resource-utilization minutes semantics
description: What is and isn't included in utilized_minutes from /wb/resource-utilization
---

**Rule:** `/wb/resource-utilization`'s `utilized_minutes` already includes placeholder (potential) job minutes, merged server-side with per-day 8h capping and range clamping. Clients must never re-add placeholder minutes to totals; use the separate `placeholder_minutes` field for display breakdowns only.

**Why:** A client-side re-sum of placeholder jobs on the schedule board double-counted potential hours in the capacity badges (July 2026).

Multi-day CRM booking minutes are allocated only to included working days that overlap the requested range. Interior weekends are excluded unless the booking explicitly starts or ends there, matching schedule-board chip expansion.

**Why:** Filtering by booking start date assigns a cross-week job only to its first week; counting every calendar day also consumes capacity on inferred weekend continuation days.

**How to apply:** Board utilization total = `utilized_minutes` + drive-time + PTO block minutes; custom blocks excluded. Jobs-only display value = `utilized_minutes - placeholder_minutes`. Use overlap semantics for CRM booking selection and clamp each included day to 8 hours.
