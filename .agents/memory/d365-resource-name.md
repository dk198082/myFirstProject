---
name: D365 resource performing operations
description: Where the displayable "resource" for a TOUS production order actually lives in D365FO staging tables.
---

# "Resource performing the operations" for a production order (TOUS)

The displayable resource is the **resource GROUP**, held in
`prodproductionorderrouteoperationresourcerequirementstaging.requiredoperationsresourcegroupid`
(e.g. `CALIBR`, `Warehouse`, `FA-Elctcal`, `CB-MltInd`, `Assembly`). The group id IS the
human-readable name — there is **no** resource-group name lookup table.

**Why:** the more specific fields are effectively empty in this dataset:
- `requiredoperationsresourceid` → `opresoperationsresourcestaging.resourcename` resolves for only ~35 TOUS orders.
- `prodproductionorderrouteoperationstaging.costingoperationresourceid` → resourcename: ~6 orders.
- `towrkctrid`: ~20 orders.
- By contrast `requiredoperationsresourcegroupid` covers ~6313/6315 Machine-class board orders.

**How to apply:** one order spans many route operations → many group rows. Aggregate distinct
per `(productionordernumber, dataareaid='TOUS')`, e.g.
`string_agg(DISTINCT requiredoperationsresourcegroupid, ', ' ORDER BY ...)`, filtering out empty strings.
The booking board's assignable-orders query and booking_slots snapshot use exactly this.
