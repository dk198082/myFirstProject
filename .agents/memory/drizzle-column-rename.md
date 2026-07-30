---
name: Drizzle column renames fail in post-merge
description: Why renaming a DB column via drizzle-kit push silently breaks, and the manual fix.
---

# Drizzle column renames break the post-merge push

Renaming a column in a Drizzle schema (e.g. `ship_days` -> `pack_days`) does NOT
apply cleanly through `drizzle-kit push`, which is what the post-merge setup
script (`scripts/post-merge.sh`) runs. Push detects a column add/drop conflict and
shows an **interactive** "is X renamed to Y?" prompt (`promptColumnsConflicts`).
In the non-TTY post-merge/CI environment this throws
`Error: Interactive prompts require a TTY terminal`, the push aborts, and the
**old column name stays in the database** while the merged code now queries the
new name.

**Symptom:** after a rename merge, runtime queries fail with
`column "<old_name>" does not exist` (HTTP 500 on the affected endpoints), even
though typecheck/build pass. The running compiled API process may also still hold
the *old* code until restarted — so you can see BOTH a stale-code error (queries
old column) and a missing-column error depending on what was renamed where.

**Fix:** apply the rename directly with SQL (preserves data), then restart the
API workflow so it rebuilds against the new schema:
- `ALTER TABLE <table> RENAME COLUMN <old> TO <new>;`
- restart the live API workflow (the long-running one builds dist once at startup).

**Why:** drizzle-kit push is generate-and-diff, not a real migration; column
renames are ambiguous (rename vs drop+add) and require interaction it can't get.

**How to apply:** whenever a task renames a DB column, don't rely on post-merge
push — do the `ALTER TABLE ... RENAME COLUMN` yourself and restart the API.
