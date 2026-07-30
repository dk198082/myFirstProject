---
name: Schedule Board pick-remaining tooltip
description: Why the /production-picking aggregate is a separate cached endpoint, and how "remaining to pick" is computed.
---

The Schedule Board order-card tooltip shows each BOM component's quantity still
remaining to pick. This is served by `GET /production-picking`, kept SEPARATE
from `/production-board`.

**Source (per stakeholder):** read the remaining qty DIRECTLY from the BOM line
column — do NOT recompute it. For each started machine order, from
`prodproductionorderbillofmaterialslinestaging`:
- `itemnumber`, `remainingbomlinequantity` (qty), `bomlineunitsymbol` (unit).
- A component can span multiple BOM lines — SUM `remainingbomlinequantity` per
  (order,item) so it appears once; `HAVING SUM(...) <> 0` (keep non-zero only,
  can be negative). Cast `::float8` so JSON serializes numbers, not strings.
- Do NOT derive remaining from picking-journal math (the earlier
  estimatedbomlinequantity − consumptioninventoryquantity approach was WRONG —
  showed wrong data). The staging column is authoritative.

**Why a separate, cached endpoint:** the BOM staging table is large and unindexed
(read-only D365 source), so this aggregate full-scans it (~10s) even with an
order-id predicate — a per-order lazy hover fetch would be unusable. So compute
for ALL board orders in one query, cache in-memory (5 min TTL), and have the
client fetch it independently of the board so the board never blocks on it. The
board itself must stay fast (~2s).

**How to apply:** don't inline this into the board query, and don't try to make a
per-order variant "fast" — the table has no usable index. Keep it batched +
cached. Tooltip renders `itemnumber — remaining unit`.
