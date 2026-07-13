# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

### Session table is provisioned out of band

The Express session store (`connect-pg-simple` in `artifacts/api-server/src/app.ts`) uses
the `sessions` table with `createTableIfMissing: false`. This table is **not** part of the
Drizzle schema, so Replit's Publish flow (which diffs the declared schema) will **not**
create it in production. Each environment must have a `sessions` table or `/api/login`
fails at runtime with `relation "sessions" does not exist`.

Provision it once per environment (dev already has it). Run this against **production**
before/after deploying:

```sql
CREATE TABLE IF NOT EXISTS public.sessions (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   jsonb   NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public.sessions (expire);
-- Remove the old singular table if it exists in that environment:
DROP TABLE IF EXISTS public.session;
```

Notes: the store was consolidated from a stray singular `session` table to `sessions`
(plural); `jsonb` is compatible with `connect-pg-simple`. Production DB is read-only to the
agent and may be frozen when the app isn't actively deployed — the user runs the SQL above.

### `placeholder_jobs.service_location_id` must be provisioned in production

The `service_location_id` column was added to the dev `placeholder_jobs` table via psql
and is now declared in the Drizzle schema (`lib/db/src/schema/placeholderJobs.ts`).
Production does **not** yet have this column — the Publish flow will diff and apply it
automatically when the app is re-published.

If you need to provision it manually before re-publishing, run against **production**:

```sql
ALTER TABLE placeholder_jobs ADD COLUMN IF NOT EXISTS service_location_id text;
```

Note: `status` is also present in dev (via psql) and missing from the Drizzle schema
declaration — it has the same gap with production. Tracked separately.

### Drizzle schema is not the source of truth for most tables — never `push`/`push-force`

Almost every table in this project (`booking_writebacks`, `sessions`, the CRM tables,
and originally `schedule_blocks`) was created **out of band via psql**, not declared in
the Drizzle schema. As a result, `drizzle-kit push` / `push-force` computes a diff that
**drops** those undeclared tables (plain `push` errors at the non-interactive data-loss
prompt; `push-force` would drop silently). **Do not run push/push-force to "sync" dev.**

- `scripts/post-merge.sh` runs `pnpm --filter db push`; on a task merge it will fail the
  non-interactive prompt rather than drop data, so post-merge DB reconciliation is
  effectively inert until the real tables are declared in Drizzle.
- The Publish flow only manages tables that are **declared** in the Drizzle schema
  (undeclared tables are neither created nor dropped in prod). So to get a schema change
  into production, the table must be declared in Drizzle first — then re-publish.
- `schedule_blocks` is now declared in `lib/db/src/schema/scheduleBlocks.ts` (matching the
  live dev table exactly, incl. the `block_type` CHECK for `drive_time`/`pto`/`custom` and
  the `title` column). This was added so Publish can migrate its `custom` CHECK constraint
  to production — production was created with the old constraint (`drive_time`/`pto` only),
  which made Custom blocks fail with a 500 in the deployed app.

### `pg` sslmode deprecation warning

`pg` (v8.16+) prints a one-time `SECURITY WARNING: The SSL modes 'prefer',
'require', and 'verify-ca' are treated as aliases for 'verify-full'` whenever a
connection **string** carries one of those `sslmode` values. It is a forward-compat
notice (those modes change meaning in `pg` v9), **not** an error — connections still
work.

- Only the main pool (`lib/db/src/index.ts`) passes a raw `connectionString`, so it's
  the only one that can emit it. The `db.ts` (FS Azure) and `crmDb.ts` (Dynamics)
  pools build from discrete fields and never trigger it.
- Dev's `DATABASE_URL` uses `sslmode=disable`, which is not a warned mode, so the
  warning only appears in **production**, where `DATABASE_URL` uses `sslmode=require`.

`lib/db/src/index.ts` now normalizes this: it strips `sslmode` from the URL and sets
`ssl` explicitly (preserving current behavior), so the warning is silenced in every
environment. Alternatively/redundantly, you can set the production `DATABASE_URL`
secret to `sslmode=verify-full` to make pg's current behavior explicit.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
