---
name: CRM mirror dual-write
description: placeholder_jobs and schedule_blocks are mirrored best-effort into the d365crm Postgres schema `crm`
---

Every POST/PATCH/DELETE on `/wb/placeholder-jobs` and `/wb/schedule-blocks` also mirrors the row into `crm.placeholder_jobs` / `crm.schedule_blocks` in the external d365crm Postgres (helpers in the api-server's crmMirror module, fire-and-forget).

**Why:** user wants a copy of this scheduling data alongside CRM data; the Replit DB stays the source of truth so a suspended Neon endpoint must never fail the primary write.

**How to apply:**
- Mirror tables have plain `integer` PKs (ids come from the source DB, no serial). Same id in both DBs is what makes update/delete mirroring work.
- Mirror failures only log `req.log.warn` — no retry/queue. If the CRM endpoint was down for a while, re-run a backfill (upsert from the source rows; ON CONFLICT(id) DO UPDATE).
- If a column is added to either source table, add it to the crm mirror table AND to the upsert in crmMirror, or mirrored rows silently drop the field.
- Dev+prod share the same crm mirror (single D365CRM_DATABASE_URL), so dev testing writes into the same mirror tables.
