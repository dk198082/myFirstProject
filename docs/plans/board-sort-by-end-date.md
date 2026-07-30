# Sort Board by End Date, Not Resource Code

## What & Why
Within each Production Group section on the Schedule Board, orders are currently grouped into swim lanes by Resource Code. The user no longer needs this grouping — they want a flat list of orders sorted by scheduled end date (earliest first), with the Resource Code kept as a visible reference on the left of each row. The per-resource order count and summed hours columns are also no longer needed and should be removed.

## Done looks like
- Within each Production Group section, there is one row per work order (no more grouping rows by resource code).
- Orders are sorted by `scheduledenddate` ascending (earliest end date at the top of each group section); orders with no end date sort last.
- The left-side reference column still shows the Resource Code (and resource name if available) for each order row — it is kept as a reference label, not a grouping mechanism.
- The per-resource order count and summed hours are removed from that left cell.
- The group section header no longer shows the resource count, total order count, or summed hours — just the group name (and group label).
- The Unassigned row (Started orders with no work-center reservation) continues to be shown, with "Unassigned" in the left cell, sorted in with the rest by end date.
- The calendar Gantt grid (day columns, card spanning, overflow arrows) is otherwise unchanged.
- All existing unit tests still pass; update any that assert the old sort or grouping structure.

## Out of scope
- Changing the Unallocated section (GenAssy / GenInstr / GenElec / Elec Setup) — that section is untouched.
- Changing the card content itself beyond ensuring resourcecode is visible.
- Any changes to filter pills, search, or status filters.

## Steps
1. **Flatten the board data structure** — Change `buildBoardData` in `board-logic.ts` so `groupedOrders` maps `productiongroupid → BoardOrder[]` (flat, sorted by `scheduledenddate` ascending) instead of the current two-level `productiongroupid → resourcecode → BoardOrder[]` map. Update the corresponding TypeScript type.
2. **Re-render group sections with one row per order** — Update the board rendering in `dashboard.tsx` to iterate over the flat order list. Each order gets its own table row; the left cell shows `resourcecode` (or "Unassigned" for orders in `UNASSIGNED_KEY`) and resource name as a reference label only — no count, no hours.
3. **Strip aggregate stats from group header** — Remove the resource count, total order count, and summed hours from the group section header (`<div className="bg-slate-800 …">`). Keep only the group name and label.
4. **Update unit tests** — Adjust any board-logic or dashboard tests that assert on the two-level grouping structure, resource row counts, or sort order to match the new flat-sorted structure.

## Relevant files
- `artifacts/shop-floor/src/pages/board-logic.ts`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1730-1760`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1787-2070`
- `artifacts/shop-floor/src/pages/board-logic.test.ts`
