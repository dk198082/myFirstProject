# Deploying to Azure

## ✅ Update: the "no auth enforcement" gap from previous exports is fixed

Earlier exports of this app had a login flow that didn't actually gate any
data routes — I flagged this prominently the last two times. **This export
fixes it.** Every route in `writeback.ts` and the other data routers now has
`requireLogin` (any logged-in user) or `requireRole("editor")` (write access)
applied per-route (see `lib/auth.ts` for the middleware, and
`routes/index.ts`/`routes/writeback.ts` for where it's applied) — including
the `/wb/admin/sync-mirror` endpoints I called out specifically last time.
New test files (`auth.test.ts`, `auth-me.test.ts`, `fs-routes-login.test.ts`,
`writeback-login.test.ts`, `writeback-role.test.ts`) exercise this directly
against the real middleware, not just mocks.

This also changes what "authorized" means: on login, `routes/auth.ts` now
calls the Data Admin Suite's `/api/access-check` endpoint to decide whether
the user is allowed in at all and whether they get `viewer` or `editor`, with
a **local fallback** to the `app.app_user` table (now a proper Drizzle table,
see `lib/db/src/schema/appUser.ts`) if the Admin Console is unreachable or
unconfigured. Two new environment variables come with this:

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_CONSOLE_URL` | Recommended | Base URL of the deployed Data Admin Suite, e.g. `https://admin.yourorg.azurewebsites.net`. If unset, every login falls back to the local `app.app_user` table instead. |
| `ADMIN_CONSOLE_API_KEY` | Required if `ADMIN_CONSOLE_URL` is set | Matches an API key configured on that Admin Console deployment for its `/api/access-check` endpoint (see that app's own `AZURE_DEPLOYMENT.md`). |

If you're not deploying the Data Admin Suite at all (or not yet), leave both
unset — logins will use the local fallback table exclusively. Either way, at
least one user needs a row in `app.app_user` (`role` = `viewer` or `editor`)
or in the Admin Console's access grants, or **no one** can log in, including
you. `scripts/insert-app-user.mts` is a one-off script for seeding that table
directly — open it and adjust the hardcoded user list before running it, and
note it reads `FS_DATABASE_URL` rather than this app's actual `DATABASE_URL`
env var (a naming mismatch in the script itself, not a documentation typo —
just export `FS_DATABASE_URL` set to the same value when you run it):

```bash
FS_DATABASE_URL="$DATABASE_URL" pnpm tsx scripts/insert-app-user.mts
```

---

This app was built for Replit but already uses Azure-native pieces
(`@azure/msal-node` for Entra ID login, `lib/db` handles Azure Postgres SSL
modes, `artifacts/api-server/src/lib/db.ts` defaults to an
`*.postgres.database.azure.com` host). The changes here (`Dockerfile`,
`.dockerignore`, and the `STATIC_DIR`/`CORS_ORIGIN`/`COOKIE_SAME_SITE` block
in `artifacts/api-server/src/app.ts`) make it deployable as a normal
container.

## Recommended shape: one container, one Azure resource

`Dockerfile` at the repo root builds the API server + the
`field-service-schedule-board` frontend, and the API server serves the built
frontend itself (`STATIC_DIR` env var — see `app.ts`). That means:

- One Azure resource to run (Web App for Containers **or** Container Apps).
- No CORS configuration needed (the browser never leaves the one origin).
- The production session cookie stays `sameSite: "lax"` (the default) — no
  cross-site cookie issues. (Dev keeps its separate `sameSite: "none"`
  behavior for the Replit preview iframe; that branch only applies when
  `NODE_ENV !== "production"`, which the `Dockerfile` sets, so it's
  untouched here.)

If you'd rather deploy `dynamics-write-back` or split frontend/API across two
Azure resources, see **"Split deployment"** at the bottom.

## ⚠️ Read this before touching the database: schema is not fully in Drizzle

Per this repo's own `replit.md`: most tables (`booking_writebacks`,
`sessions`, the CRM tables, and originally `schedule_blocks`) were created
**out of band via psql**, not declared in the Drizzle schema. Running
`drizzle-kit push` / `push-force` against a database that already has that
data will try to **drop** those undeclared tables.

Replit's own "Publish" flow avoids this by only ever creating/updating tables
that *are* declared in Drizzle, and never dropping anything undeclared — but
that diffing behavior is a Replit-specific mechanism, not something
`drizzle-kit push` does on its own. **When you set up the Azure database, do
not run `push`/`push-force` against it once it holds real data.** Instead:

1. For a **brand-new** Azure Postgres database with no data yet, `push` is
   safe (there's nothing undeclared to drop) — go ahead and run it once to
   create the Drizzle-declared tables, then provision the out-of-band tables
   below by hand.
2. For a database that's a **copy/migration of the existing production data**
   (out-of-band tables and all), skip `push` entirely and provision schema
   changes by hand (see below), or introduce `drizzle-kit generate` +
   `migrate` (versioned SQL migrations) instead of `push` so every change is
   reviewed before it runs.

## 1. Azure resources to create

| Resource | Purpose |
|---|---|
| Azure Container Registry (ACR) | Stores the built image (or use `az webapp up` / GitHub Actions to build+push in one step) |
| Azure App Service (Linux, "Web App for Containers") **or** Azure Container Apps | Runs the container |
| Azure Database for PostgreSQL – Flexible Server | The app's primary database (`DATABASE_URL`) |
| Azure App Registration (Entra ID) | Login (`CLIENT_ID`/`TENANT_ID`/`CLIENT_SECRET`) |

## 2. Build & push the image

```bash
az acr login --name <your-acr-name>
docker build -t <your-acr-name>.azurecr.io/field-service-calendar:latest .
docker push <your-acr-name>.azurecr.io/field-service-calendar:latest
```

Then point an App Service (Web App for Containers) or Container App at that
image. The container listens on `$PORT`, which Azure App Service sets to
`8080` for custom containers; Container Apps lets you declare the target port
explicitly.

## 3. Environment variables (App Settings / Container Apps secrets)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string for sessions + app data (`sslmode=require` for Azure Postgres) |
| `SESSION_SECRET` | Yes | Long random string; server refuses to boot in production without it |
| `ENTRA_CLIENT_ID` / `CLIENT_ID` | Yes | From the Azure App Registration |
| `ENTRA_TENANT_ID` / `TENANT_ID` | Yes | From the Azure App Registration |
| `ENTRA_CLIENT_SECRET` / `CLIENT_SECRET` | Yes | From the Azure App Registration ("Certificates & secrets") |
| `ENTRA_REDIRECT_URI` | Yes | e.g. `https://<your-app>.azurewebsites.net` — only the origin is used, `auth.ts` always forces the path to `/api/auth/callback` regardless of what path you include |
| `ADMIN_CONSOLE_URL` / `ADMIN_CONSOLE_API_KEY` | Recommended (see above) | Centralized login authorization via the Data Admin Suite; falls back to the local `app.app_user` table if unset |
| `PORT` | No | Azure sets this for you; the `Dockerfile` defaults it to `8080` |
| `STATIC_DIR` | No | Already set by the `Dockerfile`; only change if you rearrange the image |
| `FS_DB_HOST` / `FS_DB_PORT` / `FS_DB_NAME` / `FS_DB_USER` / `FS_DB_PASSWORD` | Only if used | Field Service Postgres data source (see `artifacts/api-server/src/lib/db.ts`) |
| `D365CRM_DATABASE_URL` | Optional | Enables the CRM mirror dual-write (see below); the app works fine without it |
| `CORS_ORIGIN`, `COOKIE_SAME_SITE=none` | Only for split deployment | See "Split deployment" below |

## 4. Provision tables that live outside the Drizzle schema

Run once per new database (see the schema warning above for why these aren't
just `push`ed):

```sql
-- Session store (connect-pg-simple, createTableIfMissing: false)
CREATE TABLE IF NOT EXISTS public.sessions (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   jsonb   NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public.sessions (expire);

-- placeholder_jobs gained this column via psql in dev; not yet in Drizzle.
ALTER TABLE placeholder_jobs ADD COLUMN IF NOT EXISTS service_location_id text;
```

Check `replit.md`'s "Gotchas" section for the current, authoritative list —
it's actively maintained as new out-of-band schema changes happen, and this
file may lag behind it.

## 5. Register the redirect URI in Entra ID

In the Azure App Registration → **Authentication**, add a Web platform
redirect URI of `https://<your-domain>/api/auth/callback` — must match
exactly.

## 6. Health check

`GET /api/healthz` returns `{ "status": "ok" }` — point Azure App Service's
health check path (or Container Apps' liveness probe) at `/api/healthz`.

## 7. About the new CRM mirror dual-write feature

Every write to `/wb/placeholder-jobs` and `/wb/schedule-blocks` also
fire-and-forget mirrors the row into `crm.placeholder_jobs` /
`crm.schedule_blocks` in the external `D365CRM_DATABASE_URL` database (see
`artifacts/api-server/src/lib/crmMirror.ts`). This is **best-effort and
optional**: if `D365CRM_DATABASE_URL` isn't set, or that database is
unreachable, the primary write still succeeds and only a warning is logged —
nothing about deploying to Azure requires this to be configured. If you do
want it working in Azure, the `crm.placeholder_jobs` / `crm.schedule_blocks`
tables need to already exist in that external database with matching
`integer` (non-serial) primary keys, since the mirror relies on reusing the
source row's own ID — including the `color_index` column now mirrored on
`schedule_blocks`, which is new in this export and in the local Drizzle
schema (`lib/db/src/schema/scheduleBlocks.ts`) but not automatically present
on the external CRM side.

Because the dual-write is fire-and-forget, the mirror can drift from the
primary database if a mirror write ever fails silently. Two reconciliation
tools ship with this export to catch/fix that:

- **`GET/POST /wb/admin/sync-mirror`** — an API endpoint (see the security
  warning above — make sure this ends up behind whatever auth/network
  restriction you put in place) that compares row counts/IDs and upserts any
  rows missing from the mirror.
- **`artifacts/api-server/sync-mirror-script.mjs`** — a standalone one-off
  script, not part of the running server or the Docker image. Run it
  manually, e.g. from a Cloud Shell or your workstation with network access
  to both databases:
  ```bash
  cd artifacts/api-server
  DATABASE_URL="<primary-db-url>" D365CRM_DATABASE_URL="<crm-db-url>" node sync-mirror-script.mjs
  ```
  Useful for an initial backfill or a one-time reconciliation without
  needing the API endpoint reachable at all.

## Split deployment (frontend and API as two Azure resources)

Only do this if you specifically need the frontend on Azure Static Web Apps
or want to deploy `dynamics-write-back` as a separate app rather than
`field-service-schedule-board` via `STATIC_DIR`. It requires:

1. Don't set `STATIC_DIR` on the API container — deploy the frontend's
   `dist/public` (built with `BASE_PATH=/` and any `PORT` value) to its own
   static host instead.
2. Set `CORS_ORIGIN` on the API to the frontend's exact origin (e.g.
   `https://myapp.azurestaticapps.net`) and `COOKIE_SAME_SITE=none` so the
   session cookie is accepted cross-site in production.
3. Frontend code change (not included in this repo edit): the generated API
   client (`lib/api-client-react`) needs `credentials: "include"` added to its
   `fetch` call in `custom-fetch.ts`, and `setBaseUrl(...)` called with the
   API's absolute URL at app startup (e.g. from a `VITE_API_URL` build-time
   env var) — otherwise requests still go to the frontend's own relative
   `/api/...` path instead of the API host.

## Things found while validating this export

- **Fixed (blocked the build):** `routes/writeback.ts` had several
  `req.params.xxx` usages typed as `string | string[]` failing `tsc` —
  narrowed with explicit casts at each site (e.g.
  `req.params as { bookingId: string }`) since these route params are always
  single path segments, never arrays. No behavior change, just satisfies the
  type checker so `pnpm run build` (and therefore the Docker build) succeeds.
- **Not fixed (does not block deployment):** `pnpm --filter @workspace/api-server test`
  has 9 pre-existing failures in `auth.test.ts` — malformed Admin Console
  responses (missing `allowed` field, wrong types, etc.) are expected to
  return `503`, but the route currently returns `500` in those cases. This is
  an application-level error-handling bug, not something introduced by or
  related to the Azure changes here, and doesn't affect whether the app
  boots or serves traffic — flagging it since it's worth fixing, not because
  it blocks anything in this guide.
