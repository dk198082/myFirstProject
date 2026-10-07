# Single-Technician Stacked Calendar View

## What & Why
When a dispatcher is reviewing one technician's schedule, the current swimlane view forces them to scan across a narrow week with all technicians visible as rows. The stacked-weeks calendar layout (already used by the "tech/print" view) is much more readable for a single person — each week is its own row, Mon–Fri as columns, and you can see multiple weeks at a glance.

The new behaviour: the board automatically shows the stacked-weeks calendar whenever exactly one technician is in focus, and falls back to the current swimlane for two or more technicians.

## Done looks like
- Clicking a technician's name (the row header in the week or month swimlane view) opens the stacked-weeks calendar for that technician, covering several weeks starting from the current start date.
- The stacked-weeks view shows the technician's name and region at the top, with rows for each week and Mon–Fri (+ optionally Sat/Sun) as columns. Each cell shows their booked jobs, potential jobs, and schedule blocks for that day.
- A clearly-labelled "All technicians" / back button returns to the swimlane view.
- When in "tech view" mode via the existing tech checkbox picker and exactly one box is checked, the display also uses the focused single-tech layout rather than the multi-card layout.
- Multi-tech selection (2+ checked, or "all") always renders the current swimlane.
- Print still works: printing while in single-tech focused view prints only that technician's calendar.

## Out of scope
- Changing how the multi-technician swimlane or existing tech/print view renders.
- Automatic view-switching without an explicit user action (clicking the tech name); the switch is always user-initiated.
- Editing or drag-and-drop of jobs from within the stacked view (read-only for now, or same interaction as existing tech view chips).

## Steps
1. **Add a click-to-focus interaction on swimlane row headers** — In both week and month views, make each technician's name/row-header clickable. Clicking it sets a new `focusedTechId` state and switches the displayed layout to the single-tech stacked calendar for that technician.
2. **Single-tech stacked view layout** — Reuse the existing tech-view week-rows rendering (already in `view === "tech"` branch), but scoped to only the one focused technician and rendered full-width with a larger day-column target for readability. Show a header with the tech's name and a prominent "← All technicians" back button.
3. **Wire the existing tech-view checkbox picker** — When the tech-checkbox picker (visible in the toolbar under `view === "tech"`) is narrowed to exactly one selection, automatically engage the focused single-tech layout. When more than one is selected, revert to the multi-card tech view.
4. **Navigation continuity** — The prev/next and date-jump controls should still work in the focused view, stepping by week. The range label should show the technician's name alongside the week range.
5. **Maintain search and job highlighting** — Any active search query and chip dimming should carry over into the focused view without resetting.

## Relevant files
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx`
