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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
