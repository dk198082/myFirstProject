---
name: Drizzle schema is NOT the source of truth for existing tables
description: Why `drizzle-kit push`/`push-force` is destructive here and how prod schema actually changes
---

**Almost every table in this project was created out-of-band via psql, not via the
Drizzle schema.** `lib/db/src/schema/` was essentially empty (`export {}`). Tables
like `booking_writebacks`, `sessions`, the CRM tables, and (originally)
`schedule_blocks` exist in the databases but were never declared in Drizzle.

**Consequence — `drizzle-kit push` / `push-force` is DESTRUCTIVE here.** Because the
declared schema doesn't contain those tables, `push` computes a diff that DROPS them
(it warned about deleting `booking_writebacks` (28 rows) and `sessions`). Plain `push`
errors out at the non-interactive data-loss prompt (no TTY) instead of dropping, but
`push-force` would silently drop. **Never run push/push-force to "sync" dev here**
without first declaring every existing table in Drizzle.

Note: `scripts/post-merge.sh` runs `pnpm --filter db push` — so a task merge triggers
this same diff; it will fail the non-interactive prompt rather than drop data, but it
means post-merge DB reconciliation is effectively a no-op/failure until the schema
declares the real tables.

**How prod schema actually changes.** Per replit.md, the Publish flow diffs the
*declared* schema; undeclared tables are neither created nor dropped in prod (an empty
declared schema left all prod tables intact across many publishes). So a table must be
**declared in Drizzle** for Publish to manage it in production.

**Applied lesson:** `schedule_blocks` is now declared in `lib/db/src/schema/scheduleBlocks.ts`
(including its `block_type` CHECK allowing drive_time/pto/custom and the title column) so
Publish can manage it. When adding a column/constraint to any out-of-band table, first
declare the *whole* table in Drizzle to match the live DB, then rely on Publish — do not
push.
