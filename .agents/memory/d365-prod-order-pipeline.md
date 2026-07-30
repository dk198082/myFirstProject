---
name: D365 production-order pipeline vs. backlog
description: Status enum meaning for machine production orders and the row-cap ordering trap when querying them.
---

Machine production orders in D365 (`prodproductionorderheaderstaging.productionorderstatus`, numeric 0..7) split into:
- **4 = Started** — physically in production (STARTED on the New Booking page).
- **0/1/2/3 = Created/Estimated/Scheduled/Released** — committed but not started (BOOKED).
- **5/6/7 = Reported/Ended/Ordered** — completed; a very large historical backlog (2010s), noise for forward-looking views.

**The trap (cost real debugging):** the active pipeline (Started + committed future orders, dated ~current year) is a tiny slice sitting on top of a huge multi-thousand-row historical backlog. A query like `ORDER BY scheduledstartdate ASC ... LIMIT 1000` returns the *oldest* completed orders and silently drops the entire current pipeline — the endpoint looks like it works (returns 1000 rows) but every row is a decade-old, status-7 order.

**Why:** the backlog dwarfs the live pipeline, and machine tabs share the cap with the huge `MFI` tab.

**How to apply:** for any forward-looking projection over these orders, order **most-recent-first** (`scheduledstartdate DESC NULLS LAST`) or filter to non-completed statuses before capping, so the live pipeline survives. Duplicate rows come from the released-product join — dedupe by `productionordernumber`.

The **New Booking / Schedule** page (`artifacts/shop-floor`) shows real Started/Booked orders with their actual dates and only *projects* OPEN slots (bi-weekly cadence per family, anchored after the last committed order). It does not fabricate Started/Booked rows — if the pipeline is empty it correctly shows OPEN slots only.
