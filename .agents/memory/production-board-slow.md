---
name: production-board query perf (fixed) + nested-loop rescan gotcha
description: How /production-board was made fast (~2s) and the planner trap to watch for on the read-only D365 PG.
---

# /api/production-board performance

The Schedule Board feed (`GET /api/production-board`) was ~14-54s and saturated
the Azure PG pool (`max: 10` in `azureDb.ts`) → `database_error: "timeout
exceeded when trying to connect"`. Now ~2s.

**Root cause (found via EXPLAIN ANALYZE):** the released-product table
(`ecoresreleasedproductv2staging`, ~144k rows) was used ONLY to filter orders
to the board scope (Machine + classification3) — none of its columns are
projected. The planner mis-estimated rows and put it on the inner side of a
nested loop, re-scanning the whole table once per candidate order
(`loops=149`, ~3.6M buffer hits) ≈ 52 of 54s.

**Fix:** pull the classification filter into `WITH board_products AS
MATERIALIZED (SELECT DISTINCT itemnumber ... WHERE classification...)` and
INNER `JOIN board_products bp ON bp.itemnumber = p.itemnumber`. MATERIALIZED
forces a single scan, then a hash join. Output is identical (no rp columns
projected; LEFT was already effectively INNER via the WHERE).

**Durable lessons:**
- The D365 PG is **read-only** — you cannot add indexes; fixes must be
  query-shape changes (CTE barriers, MATERIALIZED, restructuring joins).
- When a big table is used purely as a membership/scope filter, materialize its
  matching keys once instead of LEFT/JOIN-then-WHERE, or the planner may
  nested-loop-rescan it per outer row.
- **How to apply:** if a board/list endpoint on this DB is slow, run
  `EXPLAIN (ANALYZE, BUFFERS)` and look for a filter-only table with high
  `loops=` — that's the rescan trap.
- The `rt` route rollup was later switched OFF `productionroutedetailsd365()`
  to a direct staging-table aggregate (see route-details-function-slow.md); that
  removed the function's full-scan cost and the endpoint now also returns
  `consumedhours` (posted registeredhours, warehouse bookends excluded).
