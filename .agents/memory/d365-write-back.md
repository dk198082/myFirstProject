---
name: D365 write-back pattern
description: How real-time writes to Dynamics 365 F&O work alongside the read-only Azure PG staging mirror.
---

# D365 F&O write-back

Rule: the Azure PG staging tables are a READ-ONLY mirror that refreshes on a lag. Any real-time change made in D365 (via its OData API at `$D365_URL/data/...`) will NOT appear in staging immediately — reads that must reflect the change instantly need a local overlay table that is auto-deleted once staging catches up (staging stays the source of truth).

**Why:** without an overlay, a successful D365 write looks like a no-op to the user until the mirror refreshes; without cleanup, the overlay would mask later legitimate D365-side changes.

**How to apply:** write to D365 FIRST, store the overlay only after D365 accepts; on reads, overlay then delete rows where staging already matches. Never store an overlay for a rejected write.

Auth: client-credential flow with AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET, token scope `${D365_URL}/.default`. A valid AAD token is NOT enough — the app registration must also be added inside D365 (System administration > Setup > Microsoft Entra ID applications) with a user permitted to make the change, otherwise 401/403. Entity keys that include dataAreaId need `?cross-company=true` on the request.

Entity choice for prod-order updates: the standard `ProductionOrderHeaders` entity REJECTS updates unless order status is Created (entity-level validateWrite). Use the org's custom `TO_SOProdTable` entity (backed directly by ProdTable, key dataAreaId+ProdId, field ProdGroupId) — it only blocks Ended orders, so Started orders are updatable. Many TO_/TO_SO custom entities exist; list them via GET `/data` service document.

Cross-company trap: the same ProdId can exist in multiple companies (tous/touk); always pin dataAreaId in filters AND keys, never rely on first match.

Gotcha 1: the snapshot's "available secrets" list can be stale — verify with viewEnvVars/printenv; in this workspace the AZURE_* AAD secrets were listed but not actually set (PG ran on the password fallback).

Gotcha 2: once AZURE_CLIENT_* secrets exist, any code that opportunistically prefers AAD token auth for the Azure PG mirror will break — the DB user (crmadmin) is a NATIVE password user, not an Entra principal. azureDb must prefer PG_NATIVE_PASSWORD/AZURE_PG_PASSWORD when set; AAD client creds are for D365 OData only.
