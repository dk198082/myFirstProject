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

- **technician-dashboard** and **dynamics-write-back** web apps, both protected by Microsoft (Azure Entra ID) sign-in.
- Auth: OIDC against `https://login.microsoftonline.com/${TENANT_ID}/v2.0` using `CLIENT_ID`/`CLIENT_SECRET`/`TENANT_ID`. MFA is enforced Azure-side via Conditional Access (no app code). Sessions are stored in local Postgres (`DATABASE_URL`).
- Auth server lives in `api-server` (`src/lib/auth.ts`, `src/routes/auth.ts`, `src/middlewares/authMiddleware.ts`). A single `/api/callback` serves both apps via the `return_to` cookie. Data API routes are guarded by `requireAuth` (only `/api/auth/*` and health are public). Shared web hook: `@workspace/auth-web`.

### Azure app registration (required to log in)
Register these in the Azure portal app registration for **each** domain (dev + prod):
- Redirect URI (Web): `https://<domain>/api/callback`
- Front-channel logout / post-logout redirect URI: `https://<domain>/`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
