# Broadcast group moves to all users instantly

## What & Why
When a manager moves a production order to a different group, that change is written to D365 and stored in a local overlay table immediately. Right now only the manager who made the change sees it on their board; every other user has to wait for the next D365 batch export (potentially 15-60+ minutes). The sync-status probe that all clients already poll can be extended to also include the latest overlay timestamp — no new infrastructure needed. When either the D365 sync time or the overlay timestamp advances, every open board refetches, so everyone sees the same production calendar in near-real time.

## Done looks like
- A group move made by one manager appears on every other open board within approximately 60 seconds (one probe cycle).
- No manual refresh, page reload, or D365 export is required.
- The "syncing" spinner on moved orders still works correctly for the manager who made the change.
- Desktop and mobile shop floor apps both pick up the change.

## Out of scope
- True push / WebSocket delivery (the 60-second probe convergence is sufficient).
- Broadcasting any other changes beyond production-group moves (those are the only local overlay writes).
- Reducing the probe interval (60 seconds is already fast enough for this use case).

## Steps
1. **Extend sync-status endpoint** — Add the `MAX(updated_at)` from the local `production_group_overrides` table to the `/production-sync-status` response alongside the existing D365 `lastsync` timestamp.
2. **Update the OpenAPI spec and regenerate the client** — Add the new `overlaylastupdated` field (nullable date-time) to the `ProductionSyncStatus` schema and run codegen so the TypeScript client reflects it.
3. **Update sync watchers** — In both the desktop and mobile sync watchers, treat an advance in either `lastsync` OR `overlaylastupdated` as a refresh trigger. Store both last-seen values and compare against both on each probe.
4. **Verify and update tests** — Confirm that simulating a newer `overlaylastupdated` with an unchanged `lastsync` triggers a refetch; update the existing sync-watcher tests accordingly.

## Relevant files
- `artifacts/api-server/src/routes/production.ts`
- `lib/api-spec/openapi.yaml`
- `lib/db/src/schema/overrides.ts`
- `artifacts/shop-floor/src/pages/dashboard.tsx`
- `artifacts/shop-floor-mobile/src/pages/mobile-list.tsx`
