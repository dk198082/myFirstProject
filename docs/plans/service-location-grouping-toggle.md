# Group Schedule Board by Service Location

## What & Why
Add a toggle to the Field Service Schedule Board that lets a dispatcher switch between two grouping modes:
- **By Technician Region** (current default) — regions are the technician's home region; one row per technician in their home region
- **By Service Location** — regions are the work order's state/city; technicians appear under whichever location their jobs are in (the same technician can appear in multiple location groups)

This lets a Region 1 coordinator see all jobs *going to* Region 1 sites, even if a Region 2 technician is doing the work.

## Done looks like
- A toggle (e.g. "By Tech Region / By Service Location") appears in the schedule board toolbar next to the existing view controls
- Switching to "By Service Location" re-groups the board so region headers become work order states (e.g. "Texas", "California") instead of CRM territory names
- Each location group lists only the technicians who have at least one job at that location during the period; the same technician can appear in multiple groups
- Job chips within each group show only that technician's jobs at that location — the chip layout, drag-and-drop, conflict highlights, and all other interactions are unchanged
- The toggle selection persists while navigating forward/backward in time but resets on page reload
- "By Tech Region" is the default; switching back restores the original view exactly
- Capacity/utilization badges remain visible but are labeled as the tech's total utilization, not location-scoped

## Out of scope
- Changing the Dynamics Write-Back board (separate artifact)
- Persisting the toggle preference across page reloads/sessions
- Filtering or scoping utilization calculations to a specific service location
- Drag-and-drop reassignment behavior changes (works the same in both modes)

## Steps

1. **Add `groupBy` param to the API** — Add an optional `groupBy=service-location` query parameter to `GET /api/schedule-board`. In `service-location` mode, restructure the SQL to group by `wo.state` (falling back to `wo.city` when state is null) instead of by `regions`/`technicians`. The response shape stays the same (`regions[].technicians[].jobs[]`), but `regionid_id` becomes a slug of the state name and `region` becomes the state label. Technicians are joined from bookings rather than from the `technicians` table, so a tech may appear in multiple region groups. Unscheduled jobs (no work order location) fall under an "Unknown Location" group.

2. **Update the OpenAPI spec and regenerate** — Add the `groupBy` query parameter to the `/schedule-board` path in the OpenAPI spec. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate the React Query hook and Zod schemas.

3. **Add the toggle to the board toolbar** — In `ScheduleBoard.tsx` (Field Service Schedule Board artifact), add a two-option toggle control ("By Tech Region" / "By Service Location") to the toolbar row alongside the week/month/tech view switcher. Store the active mode in local state. Pass `groupBy: "service-location"` to the API hook when the mode is active.

4. **Adjust region header rendering for service-location mode** — When in service-location mode, suppress the capacity/utilization badge from the region header (since location groups have no defined capacity) and add a small "Service Location" label or icon to make it visually distinct from the tech-region grouping. Technician rows within the group should show the technician's color-coded name as usual.

## Relevant files
- `artifacts/api-server/src/routes/scheduleBoard.ts`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx`
- `lib/api-spec/` (OpenAPI spec — locate with glob)
