# Fix stale group override and sync-lag visibility

## What & Why

Work Order 336848 was moved to ASSY02 through the Shop Floor UI and then moved back
to Unallocated (GenAssy) directly in D365/CRM — but did not reappear in the Unallocated
section after 6+ hours. Two independent root causes conspire to produce this.

---

### Root Cause A — Stale `production_group_overrides` entry (definite bug)

When an operator uses the Replit UI to reassign a work order to a group (e.g. → ASSY02),
the PATCH handler writes `{ prodid, groupid: 'ASSY02' }` to the local
`production_group_overrides` table. That override is cleared automatically **only** when
the D365 BYOD staging row for that order already shows `ASSY02` (i.e. the staging
mirror "caught up" to the override value).

If someone then moves the order back in D365/CRM directly (e.g. → GenAssy),
the staging mirror will eventually reflect `GenAssy`. But the catch-up check
(`staging.productiongroupid === override.groupid`) compares `'GenAssy' !== 'ASSY02'`
— the condition is **never satisfied**, so the override lives forever. On every
`/production-board` poll the override silently forces the order back into ASSY02,
hiding it from the Unallocated pool indefinitely.

The fix: when the staging value *differs* from the override value the override is
**stale in the opposite direction** and should be deleted, not kept.

---

### Root Cause B — D365 BYOD staging lag with no operator signal (UX gap)

Even when no override exists, the BYOD export that copies D365 data into the Azure
PG staging mirror runs on a schedule controlled entirely by D365. The Replit app has
no way to trigger it. If the export cycle is slow (or fails silently), the board
stays stale for hours with no visible warning beyond a small "Last Data Sync" label
that few operators notice.

Contributing factor: the staging table is append-only (each export job adds rows).
The `/production-board` query uses `MAX(tomodifieddatetime)` to deduplicate per
order. If the export that captured the group-change-back event produced a row with
a *lower* `tomodifieddatetime` than a previous export row (possible when D365 exports
different fields in different jobs), the deduplication CTE picks the older row and
silently ignores the newer group value.

---

### Secondary inconsistency

`/unallocated-order-details` reads directly from staging without applying
`production_group_overrides`, whereas `/production-board` applies the override in
JS. If an override exists, the order appears in ASSY02 on the board but may also
appear in the Unallocated detail grid — inconsistent views of the same order.

---

## Done looks like

- An order moved back to Unallocated in D365/CRM appears in the Unallocated section
  on the next board refresh (within the normal polling cycle), even if it previously
  had a local group override for a different group.
- The "Last Data Sync" time in the board header changes colour (e.g. amber / red)
  when the most recent staging timestamp is older than a configurable threshold
  (suggested: amber > 30 min, red > 60 min), giving operators an immediate signal
  that D365 data may be stale.
- `/unallocated-order-details` respects the same override logic as `/production-board`
  so both endpoints agree on where an order lives.
- Existing override behaviour for the forward path (Replit → D365) is unchanged.

## Out of scope

- Changing the D365 BYOD export frequency (D365 admin config, not code).
- Real-time D365 webhooks or change-data-capture (larger architectural change).
- Reducing the 15-minute UI polling interval (separate UX decision).

## Steps

1. **Fix the override catch-up logic** — In the `/production-board` JS post-processing
   loop, change the condition: if `staging.productiongroupid !== override.groupid`
   (staging has *moved on* from the override, in either direction), add the prodid
   to the `caughtUp` list for deletion. Currently the condition only deletes when
   they *match*; reverse or broaden the logic so any divergence clears the stale
   override.

2. **Apply overrides consistently in `/unallocated-order-details`** — Mirror the same
   override-overlay logic from `/production-board` into the unallocated details
   endpoint so both endpoints agree on which group an order belongs to.

3. **Add a stale-sync warning to the board header** — In the shop-floor dashboard,
   compare the existing `lastDataSync` value against the current time. Apply a
   distinct colour (amber/red) to the "Last Data Sync" label when the gap exceeds
   the thresholds. No new API endpoint is required; the data is already on the client.

## Relevant files

- `artifacts/api-server/src/routes/production.ts:489-521`
- `artifacts/api-server/src/routes/production.ts:783-820`
- `lib/db/src/schema/overrides.ts`
- `artifacts/shop-floor/src/pages/dashboard.tsx:926-936`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1440-1450`
