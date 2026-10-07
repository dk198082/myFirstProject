---
name: Multi-day booking weekday expansion
description: Rules for showing CRM bookings that span multiple days, weeks, or months on the schedule board.
---

Multi-day CRM bookings must appear on every covered Monday–Friday across week and month boundaries. Saturday and Sunday continuation chips are omitted unless the booking itself starts or effectively ends on that weekend date.

**Why:** A date range spanning a weekend does not mean the technician is booked to work that weekend. Explicit weekend boundary dates still represent deliberate coordinator scheduling and must remain visible.

The D#/# chip counter represents included working-day occurrences across the complete booking, not calendar-day offsets or only the currently visible week/month. Numbering must remain stable across view boundaries.

**Why:** Skipped weekends must not inflate the counter, and opening a later week must not restart a continuing booking at D1.

**How to apply:** Schedule-board queries must use overlap semantics rather than filtering only by booking start time. Apply the same day-expansion and complete-span numbering rules to technician-region and service-location grouping, preserving exclusive-midnight end behavior.