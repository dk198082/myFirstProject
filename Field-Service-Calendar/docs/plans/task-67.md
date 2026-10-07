---
title: Show multi-line notes as a list on chips
---
# Render multi-line notes as a list on chips

## What & Why
When a user types notes in the Custom Add Block dialog (or Potential Job dialogs) and presses Enter to create a vertical list of 2-3 items, the line breaks are lost on the board: chip notes render as a single truncated line. Notes with line breaks should display as a vertical list on the chip face.

## Done looks like
- On the Block chip (Drive Time / PTO / Custom), notes containing line breaks display as a vertical list — one line per entry — instead of one truncated line.
- The same behavior on the Potential Job chip.
- Single-line notes look exactly as they do today (no visual regression).
- Blank lines in the notes are ignored (no empty list rows).
- Each list line still truncates individually if too long, so chips don't overflow horizontally.

## Out of scope
- Rich text or markdown support in notes.
- Changes to the notes input fields themselves (textareas already accept Enter).
- The commented-out tooltip content (hover is disabled; leave those sections untouched).
- Scheduled Job chip notes (CRM work order descriptions) — unless trivially shared, keep this to Block and Potential Job chips.

## Steps
1. **Split and render block notes** — In the Block chip face, split notes on newlines, filter empty lines, and render each line as its own truncated row (optionally with a subtle bullet/marker for multi-line lists).
2. **Same for potential job notes** — Apply identical rendering in the Potential Job chip face.
3. **Verify** — Typecheck; create a Custom block and a Potential Job with 2-3 note lines and confirm they show as a vertical list on the board, and single-line notes are unchanged.

## Relevant files
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:469-471`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:627`