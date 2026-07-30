---
title: Align Utilization detail-view day columns with grid header
---
# Align Utilization detail columns with header

## What & Why
On the Utilization board, expanding a person/group row shows a detail breakdown (order, operation, per-day hours, total). The detail view is currently a nested table inside one full-width cell, so its day-of-week columns don't line up vertically with the "EEE d" day columns in the main grid header. The user wants the detail content shifted/structured so each day column aligns with the header day above it.

## Done looks like
- When a group row is expanded, each day's hours in the detail rows sit directly under the matching day column of the main header
- The Order/Operation labels occupy the space to the left (under Group / Posted / Utilization columns) without pushing the day columns out of alignment
- No regression in the collapsed view, sorting, or the "No hours posted" column

## Out of scope
- Any data/logic changes to how posted hours are computed or attributed
- Changes to other tabs (Schedule Board, etc.)

## Steps
1. **Restructure the expanded detail rows** — Instead of a nested table inside a single colSpan cell, render the detail rows as rows of the outer table (or give the inner table a colgroup with widths synchronized to the outer table): Order+Operation info spanning the first three columns, one cell per day aligned with the header day columns, and Total in the final column.
2. **Verify alignment visually** — Expand a group with posted hours and confirm each day value lines up under its header day, in both Week and 2 Weeks modes.

## Relevant files
- `artifacts/shop-floor/src/pages/dashboard.tsx:444-600`