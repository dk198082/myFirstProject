# Deploying to Azure

This app was built for Replit but was already written with Azure in mind
(`@azure/msal-node` for Entra ID login, `lib/db` handles Azure Postgres SSL
modes, `artifacts/api-server/src/lib/db.ts` defaults to an
`*.postgres.database.azure.com` host). The changes in this repo (`Dockerfile`,
`.dockerignore`, and the `STATIC_DIR`/`CORS_ORIGIN`/`COOKIE_SAME_SITE` block in
`artifacts/api-server/src/app.ts`) make it deployable as a normal container.

## Recommended shape: one container, one Azure resource

`Dockerfile` at the repo root builds the API server **and** the
`field-service-schedule-board` frontend, and the API server serves the built
frontend itself (`STATIC_DIR` env var — see `app.ts`). That means:

- One Azure resource to run (Web App for Containers **or** Container Apps).
- No CORS configuration needed (browser never leaves the one origin).
- The session cookie stays `sameSite: "lax"` (the default) — no cross-site
  cookie issues.

If you'd rather deploy `dynamics-write-back` (the fuller internal dashboard)
or run the frontend and API as two separate Azure resources (e.g. frontend on
Azure Static Web Apps, API on App Service), see **"Split deployment"** below —
it needs two extra env vars (`CORS_ORIGIN`, `COOKIE_SAME_SITE=none`) and one
frontend code change (not included here, since it depends which artifact and
domain layout you pick).

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
image. (`az webapp create --deployment-container-image-name ...` or
`az containerapp create --image ...` — either works; the container listens on
`$PORT`, which Azure App Service sets to `8080` for custom containers, and
Container Apps lets you declare the target port explicitly.)

## 3. Environment variables (App Settings / Container Apps secrets)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string for sessions + app data (`sslmode=require` for Azure Postgres) |
| `SESSION_SECRET` | Yes | Long random string; server refuses to boot in production without it |
| `ENTRA_CLIENT_ID` / `CLIENT_ID` | Yes | From the Azure App Registration |
| `ENTRA_TENANT_ID` / `TENANT_ID` | Yes | From the Azure App Registration |
| `ENTRA_CLIENT_SECRET` / `CLIENT_SECRET` | Yes | From the Azure App Registration ("Certificates & secrets") |
| `ENTRA_REDIRECT_URI` | Yes | e.g. `https://<your-app>.azurewebsites.net/api/auth/callback` — must exactly match the redirect URI registered on the App Registration |
| `PORT` | No | Azure sets this for you; the `Dockerfile` defaults it to `8080` |
| `STATIC_DIR` | No | Already set by the `Dockerfile`; only change if you rearrange the image |
| `FS_DB_HOST` / `FS_DB_PORT` / `FS_DB_NAME` / `FS_DB_USER` / `FS_DB_PASSWORD` | Only if used | Field Service Postgres data source (see `artifacts/api-server/src/lib/db.ts`) |
| `D365CRM_DATABASE_URL` | Only if used | Dynamics CRM writeback Postgres connection (see `crmDb.ts`) |
| `CORS_ORIGIN`, `COOKIE_SAME_SITE=none` | Only for split deployment | See "Split deployment" below |

## 4. Provision the `sessions` table

`connect-pg-simple` is configured with `createTableIfMissing: false` (its
bundled `table.sql` isn't available after the esbuild bundle), so every new
database needs this run once, manually, against `DATABASE_URL`:

```sql
CREATE TABLE IF NOT EXISTS public.sessions (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   jsonb   NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON public.sessions (expire);
```

## 5. Push the Drizzle schema

From a machine with `DATABASE_URL` pointed at the Azure Postgres instance:

```bash
pnpm --filter @workspace/db run push
```

## 6. Register the redirect URI in Entra ID

In the Azure App Registration → **Authentication**, add a Web platform
redirect URI matching `ENTRA_REDIRECT_URI` exactly (including `/api/auth/callback`).

## 7. Health check

`GET /api/healthz` returns `{ "status": "ok" }` — point Azure App Service's
health check path (or Container Apps' liveness probe) at `/api/healthz`.

## Split deployment (frontend and API as two Azure resources)

Only do this if you specifically need the frontend on Azure Static Web Apps
or want to deploy `dynamics-write-back` as a separate app rather than
`field-service-schedule-board` via `STATIC_DIR`. It requires:

1. Don't set `STATIC_DIR` on the API container — deploy the frontend's
   `dist/public` (built with `BASE_PATH=/` and any `PORT` value) to its own
   static host instead.
2. Set `CORS_ORIGIN` on the API to the frontend's exact origin (e.g.
   `https://myapp.azurestaticapps.net`) and `COOKIE_SAME_SITE=none` so the
   session cookie is accepted cross-site.
3. Frontend code change (not included in this repo edit): the generated API
   client (`lib/api-client-react`) needs `credentials: "include"` added to its
   `fetch` call in `custom-fetch.ts`, and `setBaseUrl(...)` called with the
   API's absolute URL at app startup (e.g. from a `VITE_API_URL` build-time
   env var) — otherwise requests still go to the frontend's own relative
   `/api/...` path instead of the API host.
