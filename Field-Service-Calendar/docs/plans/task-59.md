---
title: Region-based chip colour defaults
---
# Region-based chip colour defaults

## What & Why

All job chips on the schedule board should be coloured by the technician's region rather than a hash of their technician ID. The requested mapping is:

| Region | Colour  |
|--------|---------|
| R1     | Blue    |
| R2     | Yellow  |
| R3     | Purple  |
| R4     | Green   |
| R5     | Orange  |
| R8     | Red     |
| R99    | Gray    |

Block chips (Drive Time, PTO, Custom, Placeholder Job) should default to the same region colour when no user-chosen colour is saved, but the user-selected colour_index always wins.

Add Block / Add Placeholder Job dialogs should open with the colour picker pre-set to the technician's region colour so the first save uses it automatically.

## Done looks like

- Every job chip on the board (all views: stacked, calendar week, month, tech-focus) is coloured by region — R1 chips are blue, R2 yellow, R3 purple, R4 green, R5 orange, R8 red, R99 gray
- Drive Time / PTO / Custom / Placeholder Job chips without a user-chosen colour also show in the technician's region colour
- When a user opens Add Block or Add Placeholder Job for a technician, the colour picker opens pre-set to the region colour; they can change it and it saves correctly
- Edit Block and Edit Placeholder Job dialogs pre-set the picker to the region colour when no override has been saved, and show the saved override when one exists
- The capacity dot next to each technician name also reflects the region colour (currently driven by the same `palette` variable)

## Out of scope

- Changing the region-to-colour mapping at runtime (hardcoded in frontend only)
- Regions not in the map (any unknown region name falls back to blue, index 0)
- Any backend / DB / OpenAPI changes — this is purely a frontend display change (color_index already stores 0-14; gray can be handled as a display-only palette entry that is not persisted, so no schema bump is needed)

## Steps

1. **Add gray to `TECH_PALETTE` and `ChipColorPicker`** — Append a gray swatch (index 15) to the `TECH_PALETTE` array in `ScheduleBoard.tsx` and the equivalent swatch list in `ChipColorPicker.tsx`. Update the Zod `color_index` max from 14 → 15 in `writeback.ts` and the OpenAPI spec `color_index` maximum from 14 → 15 across all three ScheduleBlock schemas (ScheduleBlock, CreateScheduleBlock, UpdateScheduleBlock). Run `pnpm --filter @workspace/api-spec run codegen` to regenerate client types.

2. **Define `REGION_COLOR_MAP` and helper** — In `ScheduleBoard.tsx`, declare a `const REGION_COLOR_MAP` that maps region name strings to TECH_PALETTE indices using the table above. Write a `regionPaletteEntry(regionName)` function that looks up the map and falls back to index 0 (blue) for unknown regions.

3. **Switch `JobChip` colour to region-based** — In every render loop that computes `const palette = techColor(...)`, replace it with `const palette = regionPaletteEntry(rg.region)` (the region variable is already in scope as `rg.region` in the region loop at all three view levels). The `CapacityBadge` and technician-name dot both use `palette`, so they update automatically.

4. **Pass `regionName` to `BlockChip` and `PlaceholderJobChip`** — Add a `regionName: string` prop to both components. In `BlockChip`, when `color_index` is null use `regionPaletteEntry(regionName).chip` instead of the hardcoded type colours. In `PlaceholderJobChip`, when `color_index` is null use `regionPaletteEntry(regionName).chip` instead of `techColor(technicianId).chip`. Thread `rg.region` through to every call site of both components.

5. **Pre-select region colour in Add dialogs** — Add `regionName: string` to the `addingBlock` state shape and to every `setAddingBlock(...)` call (the region variable `rg.region` is already in scope). Pass a `defaultColorIndex` prop to `AddBlockDialog` (the TECH_PALETTE index for the region). In `AddBlockDialog`, initialise `colorIndex` state to `defaultColorIndex` instead of `null`. Do the same for `AddPlaceholderJobDialog` (if it exists as a separate dialog) or `AddBlockDialog` when `entryType === "potential_job"`.

6. **Pre-select region colour in Edit dialogs** — Add `regionName: string` to the `editingBlock` and `editingPlaceholder` state shapes and thread it through the call sites. Pass `defaultColorIndex` to `EditBlockDialog` and `EditPlaceholderJobDialog`. In both dialogs, initialise `colorIndex` from `block.color_index ?? defaultColorIndex` (or `job.color_index ?? defaultColorIndex`) instead of `?? null`.

7. **Typecheck and smoke-test** — Run `pnpm run typecheck` and confirm it passes clean. Verify in the preview that job chips, block chips, and Add/Edit dialogs all show the correct region colour.

## Relevant files

- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:180-214`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:364-411`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:519-560`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:747-800`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:1380-1395`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:3025-3100`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:3300-3420`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:3640-3760`
- `artifacts/field-service-schedule-board/src/pages/ScheduleBoard.tsx:4183-4204`
- `artifacts/field-service-schedule-board/src/components/AddBlockDialog.tsx`
- `artifacts/field-service-schedule-board/src/components/EditBlockDialog.tsx`
- `artifacts/field-service-schedule-board/src/components/EditPlaceholderJobDialog.tsx`
- `artifacts/field-service-schedule-board/src/components/ChipColorPicker.tsx`
- `artifacts/api-server/src/routes/writeback.ts`
- `lib/api-spec/openapi.yaml`