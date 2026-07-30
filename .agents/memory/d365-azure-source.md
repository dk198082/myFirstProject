---
name: D365 Azure source DB
description: How read-only Dynamics 365 source data is accessed and introspected in this shop-floor monorepo.
---

The shop-floor / production apps read live source data (production orders, sales orders, routes) from a **read-only Azure-hosted PostgreSQL** D365FO database. Writable app state (booking assignments, etc.) lives in the separate Replit Postgres (`DATABASE_URL`, `@workspace/db`).

**Access in app code:** `artifacts/api-server/src/lib/azureDb.ts` `getPool()` — recreates the `pg.Pool` every 55 min using an Azure AD token (`ClientSecretCredential`, scope `https://ossrdbms-aad.database.windows.net/.default`), falling back to native password (`PG_NATIVE_PASSWORD`) if AAD creds are absent.

**Query conventions:** schema is `d365fo`, legal entity filter `dataareaid = 'TOUS'`. D365 uses a sentinel `1900-01-01` for null dates — guard with `CASE WHEN col > '1990-01-01' THEN col END`. Azure numeric columns serialize as strings via `pg`; cast (`::float8`) when the OpenAPI contract says number.

**Where creds live:** `AZURE_PG_HOST`/`AZURE_PG_DATABASE`/`AZURE_PG_USER`/`PG_NATIVE_PASSWORD` are present in the agent shell; the AAD `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET` are only injected into workflows, not the shell.

**Agent introspection (column discovery):** native password works from the shell:
`export PGPASSWORD="$PG_NATIVE_PASSWORD"; psql "host=$AZURE_PG_HOST port=5432 dbname=$AZURE_PG_DATABASE user=$AZURE_PG_USER sslmode=require" -c "SELECT column_name FROM information_schema.columns WHERE table_schema='d365fo' AND table_name='...'"`

**Schedule Board start/end dates:** the board does NOT use the production header `scheduledstartdate`/`scheduledenddate` for display — those include the warehouse bookend route ops. Instead it derives the production window from `productionroutedetailsd365()` ops, EXCLUDING the leading `operationname ILIKE 'Warehouse Pick%'` and trailing `'Warehouse Receive%'` steps: `route_start = MIN(scheduledfromdate)`, `route_end = MAX(scheduledenddate)` (warehouse pick is always earliest, receive always latest). Guard the `1900-01-01` sentinel; COALESCE back to header dates when an order has no qualifying route ops.

**Useful column landmarks:** sales `salesorderheaderv3staging`: `deliveryaddressname` = customer name, `requestedshippingdate` = SO delivery, `orderingcustomeraccountnumber` = customer account. Production `prodproductionorderheaderstaging`: `itemnumber`, `productionordernumber`, `productionordername`, `productconfigurationid` (product configuration / variant id), `scheduledstartdate` (prod start), `scheduledenddate` (prod end), `deliverydate` (prod delivery), `productionorderstatus` (numeric enum 0..7), `demandsalesordernumber` (link to sales order).
