---
name: Potential Job technician scope
description: Confirmed product rule for required technician selection when creating or editing Potential Jobs.
---

Potential Jobs must always have a technician. On creation, preselect the technician from the chosen schedule row; on edit, preselect the currently assigned technician.

For coordinators with assigned regions, limit the dropdown to technicians in those assigned regions. For users without a coordinator assignment, limit it to the region of the selected row’s technician on creation or the currently assigned technician on edit. Do not use the board’s broad “All regions” filter as permission to list every technician.

**Why:** The user confirmed this behavior after verifying that adding a Potential Job from an R99 technician row showed only R99 technicians.

**How to apply:** Preserve this scope for future Potential Job create/edit changes, including alternate board grouping modes and dialog redesigns.