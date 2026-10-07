---
name: Potential Job technician scope
description: Confirmed product rule for required technician selection when creating or editing Potential Jobs.
---

Potential Jobs must always have a technician. On creation, keep the technician from the selected schedule row preselected; on edit, keep the currently assigned technician preselected. Both pickers show the full active technician roster, grouped and sorted alphabetically within region. Put the coordinator’s assigned region(s) first; when none exist, put the selected/current technician’s region first. Sort all other regions naturally (R1, R2, R3, …). Do not change board-click assignment defaults.

**Why:** The user explicitly requested cross-region technician selection while keeping the board-row-derived default unchanged.

**How to apply:** Apply the all-technicians list to Potential Job create/edit dialogs only. Do not change region visibility or other scheduling pickers.