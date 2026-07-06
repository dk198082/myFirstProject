---
name: docs/*.html data model & catalog are hand-authored
description: How the data-model / data-catalog docs work and how to update them
---

`docs/data-model.html` and `docs/data-catalog.html` are **hand-authored static HTML**
(no generator script, not served by any artifact/workflow — opened directly in a
browser). "Republish the data model / data-catalog" means: hand-edit these two files
to match the current DB, not run a build.

Both embed a JS array near the bottom of a `<script>` block:
- `data-model.html`: an `entities` array (ERD boxes) + a `relations` array
  (`[fromId, toId, label, dashed?]`). App DB entities sit in the green section; add
  new boxes with x/y coords that fit inside the App DB section rect. Cross-DB links to
  the CRM mirror use `dashed = true`.
- `data-catalog.html`: a `catalog` array of `{id,name,schema,desc,refs,refdBy,attrs}`;
  each attr is `{n,t,r,null,biz}` with role `r` in pk|fk|calc|sys|uk|''. Sidebar and
  body render from this array automatically.

**When the DB schema changes, update BOTH files** (they drift silently otherwise —
e.g. `schedule_blocks` was missing from both until added). Mirror an existing App DB
entry (e.g. `booking_writebacks`) for structure.
