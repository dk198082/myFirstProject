---
title: Add Elec groups to Schedule Board
---
# Add Elec groups to Schedule Board

## What & Why
The Schedule Board currently shows only Assy/Inst/Paint production groups, with GenAssy/GenInstr rolled into the Unallocated section. Electrical work is invisible. Add Elec01, Elec02, and Elec03 as first-class board groups (filter pills + their own sections), and roll the remaining electrical catch-all groups (GenElec and "Elec Setup") into the Unallocated section alongside GenAssy/GenInstr.

D365 data check (read-only Azure PG mirror, dataareaid='TOUS'): started orders currently exist in Elec01 (2), Elec02 (2), Elec03 (1), "Elec Setup" (1), GenElec (11). There is no group literally named "Elec".

## Done looks like
- Elec01, Elec02, Elec03 pills appear in the "Filter production groups" bar and work with All/None like the other pills
- Elec01, Elec02, Elec03 each render as their own board section (always shown, even when empty), placed after Paint in display order
- GenElec and "Elec Setup" orders appear merged into the Unallocated section (board cards, unscheduled grid, and the Unallocated order-details view), same behavior as GenAssy/GenInstr
- Pick-status dots/tooltips work on the new groups' cards like everywhere else
- Group display names for the new sections come from the existing /production-groups lookup
- Existing board behavior for all other groups is unchanged; shop-floor test suite updated and green

## Out of scope
- Mobile app grouping/filtering changes
- Production Booking app board
- KPI banner group list
- Any D365 write-back / group-change dropdown changes (it already validates against the D365 group table)

## Steps
1. **Board group constants** — Add Elec01/Elec02/Elec03 to the board's ordered group list and filter-pill list; add GenElec and "Elec Setup" to the Unallocated group set (note "Elec Setup" contains a space — keep exact spelling).
2. **API server scope** — Widen the two hardcoded GenAssy/GenInstr IN-lists so board rows and the unallocated-order-details endpoint include GenElec and "Elec Setup" (production-board WHERE clause and /unallocated-order-details). Check /production-picking's board_orders scope too so pick status covers the new groups' orders. Restart the API server workflow after changes.
3. **UI copy** — Update the Unallocated section labels that currently say "GenAssy + GenInstr" so they reflect the wider group set.
4. **Tests** — Update board-logic tests (pill count, UNALLOCATED_GROUPS contents, group-assignment cases) and keep the full shop-floor suite green.

## Relevant files
- `artifacts/shop-floor/src/pages/board-logic.ts:9-30`
- `artifacts/shop-floor/src/pages/board-logic.test.ts`
- `artifacts/shop-floor/src/pages/dashboard.tsx:1192-1370`
- `artifacts/api-server/src/routes/production.ts:326-331,655-661,690-720`