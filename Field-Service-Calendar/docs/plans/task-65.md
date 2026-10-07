---
title: Default chip sort order in calendar cells
---
# Default chip sort order within calendar cells

## What & Why
On the Schedule Board, each Technician/Date cell can contain Scheduled Jobs, Potential Jobs, and blocks (Drive Time, PTO, Custom). Today the default order is jobs, then blocks, then potential jobs, and can shift based on creation order. The user wants a consistent default order within every cell: Scheduled Jobs first, Potential Jobs second, all block types last — even when blocks are added later.

## Done looks like
- In every Technician/Date cell (focused-tech view and both region grid views), chips appear in this default order: Scheduled Jobs (sorted by start time as today), then Potential Jobs, then blocks (Drive Time / PTO / Custom).
- Adding a new Custom or Drive Time block later still places it at the bottom of the cell, not interleaved above jobs.
- Manual drag-reordering within a cell still works and continues to take precedence over the default order; chips without a saved manual position fall back to the type-tier order (jobs → potential jobs → blocks) instead of insertion order.

## Out of scope
- Sorting changes across cells (rows/columns), technician ordering, or day ordering.
- Changes to how blocks/potential jobs are sorted among themselves within their tier (keep current relative ordering).
- Backend/API changes — this is purely client-side presentation.

## Steps
1. **Reorder default cell assembly** — In the three places where a cell's chip list is assembled, build the array in the order jobs → potential jobs → blocks (currently jobs → blocks → potential jobs).
2. **Make the fallback sort type-aware** — Update the saved-order sorting helper so chips without a saved manual position are ordered by type tier (job → potential job → block) rather than by raw insertion order, ensuring later-added blocks land at the bottom even in cells with a saved manual order.
3. **Verify** — Typecheck and confirm on the board that cells show the expected order in all three views, and manual drag-reordering still persists and wins.

## Relevant files
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:1497-1506`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:3041-3121`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:3421-3475`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:3774-3827`