---
name: Production board data model
description: How scheduled vs unscheduled orders work in the shop floor board
---

**Rule:** An order is "scheduled" if it has a row in wrkctroperationsresourcecapacityreservationstaging; null resourcecode = "unscheduled". As of Jun 2026: ~456 scheduled, ~383 unscheduled out of ~839 active orders.

**Why:** The capacity reservation table is the sole source of work-center (resource) assignment. The opres resourcename is blank for all current machine/work-center resources (FA-*, CB-*, MS-*, etc.) — resource codes ARE the display label.

**How to apply:** /production-board endpoint uses LEFT JOIN on reservation table; overlap filter (scheduledstartdate <= toDate AND scheduledenddate >= fromDate) to catch in-progress orders. Frontend places orders in max(start, weekStart) day column.

**Worker name (assembler):** Use prodproductionroutetransactionstaging (torefnumber = production order number, toworker = recid) JOIN hcmworkerstaging on recid → name. Aggregate per order with STRING_AGG(DISTINCT name) since an order spans many operations/workers. hcmworkerstaging has NO dataareaid column; filter dataareaid on the transaction side only. recid is effectively unique by name (a few recids appear twice but with identical names), so DISTINCT aggregation can't double-count. Names are "Last, First" — use "; " as the multi-worker separator, not ", ".
