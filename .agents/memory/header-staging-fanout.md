---
name: prodproductionorderheaderstaging fan-out & status-filter ordering trap
description: This staging table is append-only — many rows per order from multiple export jobs. Status/group filters must run AFTER deduplication, not before.
---

## The staging table is append-only

`prodproductionorderheaderstaging` never UPDATEs existing rows. Each D365 export
job (`definitiongroup`) inserts a fresh row for every order it touches. A single
order can have many rows over time — observed 14 rows for one order across jobs:
`NewExporttobyodProdHeader`, `Production related update`, `Data to byod at 12pm EST`,
`Job- Production Orders to BYOD`, `prodheaderfullexport`, etc.

`tomodifieddatetime` = when D365 last modified the order.
`syncstartdatetime` = when this particular row was written to the staging table.

---

## The status-filter ordering trap (critical bug pattern)

**Wrong:**
```sql
SELECT DISTINCT ON (productionordernumber) ...
FROM prodproductionorderheaderstaging p
WHERE dataareaid = $1
  AND p.productionorderstatus = 4        -- ← WHERE runs BEFORE DISTINCT ON
ORDER BY productionordernumber, ...
```

PostgreSQL evaluates WHERE before SELECT (including DISTINCT ON). If the most-recent
row has status=5 (Reported as Finished) and older rows have status=4, the WHERE
eliminates the status=5 rows first — DISTINCT ON then sees only old status=4 rows.
Result: RAF orders stay on the board indefinitely.

**Correct — deduplicate in a CTE first, then filter:**
```sql
WITH latest_orders AS MATERIALIZED (
  SELECT DISTINCT ON (productionordernumber)
    *
  FROM d365fo.prodproductionorderheaderstaging
  WHERE dataareaid = $1
  ORDER BY productionordernumber, tomodifieddatetime DESC NULLS LAST
)
SELECT ... FROM latest_orders p
WHERE p.productionorderstatus = 4   -- now runs on already-deduplicated rows
```

**Why:** You cannot trust a simple WHERE filter on this table to give you current
state. You must always surface the most-recent row (`tomodifieddatetime DESC`) before
applying any filter on mutable fields (status, group, pool, etc.).

**How to apply:** Any query filtering this table on a mutable column must wrap it
in a CTE with `DISTINCT ON … ORDER BY tomodifieddatetime DESC NULLS LAST` first.
This is how `/production-board` is written today.

---

## SUM fan-out (older issue, still relevant)

Joining `prodproductionorderheaderstaging` directly without deduplication and then
SUMming numeric columns triples every total (one result per export-job row). Always
deduplicate before joining for aggregation queries.

---

## Also affected — `prodproductionorderrouteoperationstaging`

Has **2 rows per (productionordernumber, operationnumber)** with different `operationid`
values (same multi-export pattern). Causes totalscheduledtime to double.

Fix: `DISTINCT ON (productionordernumber, operationnumber)` ordered by `operationid DESC`
before joining.

---

## Other tables confirmed clean (unique keys)

- `hcmworkerstaging` — unique by recid
- `routeoperationstaging` — unique by (operationid, dataareaid)
- `costproductiongroupstaging` — unique by (groupid, dataareaid)
