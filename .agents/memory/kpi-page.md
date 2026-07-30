---
name: KPI page (shop-floor)
description: How the shop-floor /kpi page defines and computes its flow/delivery KPIs and where the posting data comes from.
---

The shop-floor web app has a /kpi page replicating a customer Excel "KPI" table.
Data comes from a dedicated endpoint GET /production-kpi (api-server), which aggregates
posting dates per order from the route-card production journal
(`prodroutecardproductionjournalentrystaging.postedtimestamp`, isposted=1), EXCLUDING the
warehouse pick/receive operations. delivery + hours are the Schedule Board values (route
window end + SUM(setup+process) over non-warehouse ops). /production-kpi accepts an optional
`prodid` to scope to one order — used by the order-detail "Production Summary" banner, which
reuses the same math/cells (shop-floor/src/lib/kpi.ts + components/kpi-cells.tsx) as /kpi.
(The earlier `prodproductionroutetransactionstaging.realizedaccountingdate` source is OBSOLETE.)

KPI definitions (match the Excel column labels exactly):
- Flow Time (Working Days) = Excel NETWORKDAYS(firstposting, lastposting) — weekdays inclusive of both
  endpoints, weekends excluded, no holiday calendar. Implemented with a manual week-math helper, NOT
  date-fns differenceInBusinessDays+1 (that overcounts weekend endpoints).
- Active Days = distinct calendar days with a posting (COUNT DISTINCT realizedaccountingdate::date).
- Continuity % = Active Days ÷ Flow Time × 100. NOT capped at 100 — postings on weekend days (which the
  working-day flow time excludes) can legitimately push it above 100%.
- MATERIAL KPI (On time/Late) = starteddate <= scheduledstartdate (proxy: materials ready => started on time).
- DELIVERY KPI (On time/Late) = (reportedasfinisheddate ?? endeddate) <= deliverydate.

**Why proxies:** There is no BOM/material-requirement table wired into the API, so "material on time" is
inferred from whether the order started on schedule. All KPI inputs are null-safe (render "—" when missing).

**D365 sentinel:** header date columns use 1900-01-01 for "unset"; the endpoint nulls anything <= 1990-01-01
via CASE. Apply the same guard for any new date field pulled from these staging tables.

Note: most recent orders show Flow Time = 1 / Continuity 100% because postings were batch-imported on a
single accounting date — that is real data behavior, not a bug.
