---
name: Persisted chip color indexes
description: Constraint for changing the schedule board's shared chip palette.
---

Palette indexes are persisted with schedule blocks and placeholder jobs, so changing
the meaning of an existing index changes the appearance of saved records.

**Why:** user-selected color overrides are stored as numeric `color_index` values;
reusing an old index for a newly requested color would silently recolor existing data.

**How to apply:** append new palette entries when introducing a new default color, and
point the region default map at the new index. Do not insert, reorder, or repurpose
existing entries.