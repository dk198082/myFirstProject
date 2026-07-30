---
title: Production Shop Floor Schedule Board
---
# Production Shop Floor Schedule Board

## What & Why

Build a full-stack Production Shop Floor View — a Gantt-style schedule board that surfaces live data from the D365 Azure PostgreSQL database. The board lets shop floor supervisors see all production orders plotted on a timeline, grouped by production group (resource), with linked sales order context, filtered to TOUS data area.

## Done looks like

- A web app loads and shows a Gantt/timeline schedule board with production orders as horizontal bars
- Orders are grouped by **productiongroupid** (the resource/row axis)
- Each bar spans from **schedulefromdate** to **scheduledenddate**
- Clicking or hovering a bar reveals production order details plus linked sales order info (joined via salesordernumber ↔ demandsalesordernumber)
- Data is filtered to `dataareaid = 'TOUS'`
- Backend calls the stored procedures `productionordersd365us` and `productionroutedetailsd365` (schema `d365fo`) and queries tables `prodproductionorderheaderstaging` and `salesorderheaderv3staging`
- Date-range navigation lets users pan forward/backward in time
- The app is live and accessible in the preview pane

## Out of scope

- Write/edit operations on production orders
- Authentication / user login
- Mobile-optimized layout (desktop-first)
- Historical analytics or reporting

## Steps

1. **Database credentials** — Before any code, request the Azure PostgreSQL username and password as secrets (`AZURE_PG_USER`, `AZURE_PG_PASSWORD`). Store host, database name, schema, and port as non-sensitive env vars.

2. **API spec** — Extend `lib/api-spec/openapi.yaml` with three endpoints:
   - `GET /production-orders` — calls stored proc `productionordersd365us`, returns all production order headers for TOUS
   - `GET /production-route-details` — calls stored proc `productionroutedetailsd365`, returns route/operation detail records
   - `GET /production-summary` — queries `prodproductionorderheaderstaging` joined to `salesorderheaderv3staging` on salesordernumber = demandsalesordernumber, returns enriched records with sales order context

3. **Codegen** — Run `pnpm --filter @workspace/api-spec run codegen` to regenerate React Query hooks and Zod schemas.

4. **Frontend artifact** — Create a `react-vite` artifact at `/` titled "Production Shop Floor". Launch the DESIGN subagent with the brief, available hooks, and data shapes to build:
   - A full-width Gantt/timeline board component (use a library like `react-gantt-task` or build with SVG/CSS)
   - Resource rows grouped by `productiongroupid`
   - Production order bars colored by status
   - Detail panel/tooltip on click showing order fields + linked sales order
   - Date range navigator (week/month/custom range)
   - Loading and empty states

5. **Backend routes** — In `artifacts/api-server/src/routes/`, add the three route handlers:
   - Connect to Azure PostgreSQL using `pg` (not the Replit DATABASE_URL — use the Azure connection string built from secrets)
   - Call stored procedures with `CALL d365fo.productionordersd365us()` and `CALL d365fo.productionroutedetailsd365()`
   - Query the staging tables with the join and `WHERE dataareaid = 'TOUS'`
   - Return JSON arrays

6. **Wire and test** — Ensure the frontend correctly calls the backend, bars render with correct widths relative to the date range, and the tooltip shows merged production + sales order data.

## Relevant files

- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `artifacts/api-server/src/routes/index.ts`
- `artifacts/api-server/src/app.ts`
- `artifacts/api-server/package.json`