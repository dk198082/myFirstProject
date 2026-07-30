---
name: SO-PO link in D365 staging
description: How sales order and production order references are stored in the BYOD staging export, and which cases are NOT available.
---

# Rule
The reference number for a board production order comes from two fields, with priority order:
1. `demandsalesordernumber` — SO number when the prod order was created via MRP/demand against a sales order
2. `parentproductionordernumber` — parent PO number for sub-production orders (only when != own productionordernumber; self-references are bad D365 data)

**Why:** The board SQL uses a CASE WHEN to implement this priority. Many orders have `parentproductionordernumber` equal to their own `productionordernumber` (D365 data quality issue) — these must be filtered out.

# What is NOT available
Manual "requirement marking" links (planner marks a production order against a sales order inside D365) are NOT in the BYOD staging export. These orders will show a blank reference even if a planner sees a linked SO in D365. Example: order 366221 is manually marked against SO 700528, but this link does not appear in `prodproductionorderheaderstaging.demandsalesordernumber` or `parentproductionordernumber`.

# salesorderlinev2staging
This table exists in the d365fo schema but:
- Does NOT have a `tomodifieddatetime` column (unlike prod order tables)
- Was investigated for a production order link column but could not confirm one within the BYOD export
- SO 700528 was not found in `salesorderheaderv3staging` either, suggesting manually-marked orders' SOs may not all be in the BYOD export

# How to apply
In the production-board SQL, `demandproductionordernumber` alias uses CASE WHEN. If the user asks why order X doesn't show a reference, check if it's a manually-marked order (planner action) vs. demand-driven (MRP) — only demand-driven ones will appear.
