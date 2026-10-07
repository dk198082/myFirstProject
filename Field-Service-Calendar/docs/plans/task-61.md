---
title: Hide hover tooltips on block & placeholder chips
---
# Hide hover tooltips on block/placeholder chips

## What & Why
Block and placeholder-job chips (Drive Time, PTO, Custom, and Potential Jobs) currently show a tooltip on hover just like scheduled-job chips do. We want to suppress those tooltips for now while keeping the code intact so the feature can be re-enabled quickly. Scheduled-job chips (JobChip) are unaffected.

## Done looks like
- Hovering over a Drive Time, PTO, Custom, or Potential Job chip shows **no** tooltip
- The chip itself still renders, is still clickable/editable/draggable — only the tooltip disappears
- Hovering over a scheduled-job chip (JobChip) still shows its tooltip — no change there
- All commented-out tooltip code can be restored by un-commenting two clearly delimited blocks

## Out of scope
- Any change to JobChip hover behaviour
- Any change to chip click/edit/delete/drag functionality
- Removing tooltip-related imports (keep them in case they're used elsewhere)

## Steps
1. **BlockChip** — Comment out the outer `<Tooltip>` / `<TooltipTrigger asChild>` / `</TooltipTrigger>` / `<TooltipContent>…</TooltipContent>` wrappers. The inner button (the chip itself) should render unwrapped. Add a clearly labelled `{/* HOVER DISABLED — uncomment to restore … */}` comment block around the removed markup.
2. **PlaceholderJobChip** — Apply the same treatment: comment out the `<Tooltip>`, `<TooltipTrigger asChild>`, `</TooltipTrigger>`, and both `<TooltipContent>` blocks (the rich CRM-linked one and the simple freeform one). The chip button renders unwrapped.
3. Typecheck to confirm no regressions (`pnpm run typecheck`).

## Relevant files
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:378-742`