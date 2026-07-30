---
name: Utilization worker attribution
description: Weekly Resource Utilization attributes posted hours by the worker who posted them, not the order's group.
---

Each board production group is a PERSON (D365 group names embed a person's name after the group id).

**Rule:** utilization hours come from `d365fo.prodproductionroutetransactionstaging` (grain = one posting; `toworker` recid → `hcmworkerstaging.recid`, day = `estimatedaccountingdate`, voucher = `estimatedaccountingvouchernumber`; `realizedaccountingdate` is mostly 1900-01-01 — don't use it). A hardcoded personnelnumber→group map in the utilization route attributes hours to the worker's group; unmapped workers fall back to the order's `productiongroupid`. Weekly totals reconcile exactly with the route-card journal staging.

**Why:** people post time on orders outside their own group (loaners, ungrouped/Cal_GEN orders), so order-group attribution understates a person's week. The journal table has no worker field; posteduserid is a posting clerk, not the worker.

**How to apply:** when a group changes hands, update WORKER_GROUP_MAP in the utilization route. Local production-group overrides must only remap order-attributed rows (byworker=false), never worker-attributed ones.
