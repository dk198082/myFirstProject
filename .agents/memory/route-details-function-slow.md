---
name: productionroutedetailsd365 is a full-scan trap
description: When/why to bypass the d365fo.productionroutedetailsd365() SQL function for filtered/per-order route data.
---

`d365fo.productionroutedetailsd365()` wraps another set-returning function
(`productionordersd365us()`) and applies a large `GROUP BY`. Because of that, an
order-number predicate placed on the function's output **cannot push through it** —
even `WHERE productionordernumber = '<one id>'` makes it full-scan every order
(40s+ / statement-timeout on this dataset).

**Rule:** for KPI / per-order / small-set route operation data, do NOT call the
function. Query the underlying staging tables directly:
`prodproductionorderrouteoperationstaging p JOIN routeoperationstaging r ON
p.operationid=r.operationid AND p.dataareaid=r.dataareaid`, filtered by
`p.productionordernumber IN (<small set>)`. That path is index-friendly (~150ms).
These tables expose the same conceptual columns the function returned
(operationnumber, operationname, estimatedsetuptime, estimatedprocesstime,
scheduledenddate, etc.).

**Why:** the function is convenient but only fast for whole-dataset consumers.
The per-order route-details endpoint *appears* fast only when the result set is
tiny and cached; under load the function full-scans regardless.

**How to apply:** any endpoint that needs route ops should hit the staging
tables directly — NOT the function. This now includes `/production-board`: its
`rt` rollup was switched from the function to a direct aggregate over
`prodproductionorderrouteoperationstaging JOIN routeoperationstaging`, plus a
pre-aggregated `prodroutecardproductionjournalentrystaging` (isposted=1) subquery
for posted hours. Whole-board rollup over all orders runs in ~0.6s and the
endpoint dropped from 57s+ to ~5s. No remaining callers of the function should
be added.
