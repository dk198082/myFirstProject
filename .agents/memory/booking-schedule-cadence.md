---
name: Booking schedule cadence
description: How the shop-floor Booking/Schedule page replicates the Excel cadence/WORKDAY logic and why grouping deviates from the source sheet.
---

The shop-floor web app has a Booking/Schedule page that reproduces a customer Excel
"NEW - BOOKING/SCHEDULE" capacity-leveled cadence table from /production-board data.

Scheduling math (matches the Excel exactly):
- Excel `WORKDAY(date, n)` == date-fns `addBusinessDays(date, n)` — skips Sat/Sun, no holiday calendar.
- Assy Start = WORKDAY(Production Start, Pick); Pick default 5.
- Assy End = WORKDAY(Assy Start, Assy); Assy default 15, editable per resource group.
- Ship Date = WORKDAY(Assy End, ShipLead); ShipLead default 10.
- Production-start cadence per resource group: WORKDAY(prevLeveled, 10). STARTED orders
  (productionstatus === 4) anchor to their actual schedulefromdate AND reset the cadence baseline.

**Why grouping deviates:** The Excel "RESOURCE GROUP" labels (FA-300SL, FA-600SL,
FA-2-2000SL, FA-MTLImps) do NOT map 1:1 to anything in the d365fo DB — orders have many
capacity-reservation resource rows per operation and productiongroupid values look totally
different (Assy01-10, Cal_GEN, OSO, GenAssy...). So the page groups by productiongroupid
(the app's existing grouping) instead of trying to reconstruct the Excel labels. Pick/Assy are
editable defaults rather than per-model hardcoded values.

**Why the active-only default:** /production-board returns ~41k orders going back to 2009.
Filtering to Started(4)+Released(3) yields ~600 (mostly current year) — usable and matching the
sheet's scope. There is a render cap (~3000 rows) guarding the opt-in "All orders" toggle since
the page is not virtualized.
