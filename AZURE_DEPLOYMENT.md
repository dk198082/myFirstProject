# Deploying to Azure

This app already targets Azure heavily in its architecture: `azureDb.ts`
connects to Postgres with either a native password or an Entra ID (Azure AD)
service-principal token, `d365Odata.ts` writes back to Dynamics 365 F&O via
its OData API using the same service principal, and `graphMail.ts` sends
email through Microsoft Graph, also with that service principal. The changes
here (`Dockerfile`, `.dockerignore`, and the `STATIC_ROOT_DIR` block in
`artifacts/api-server/src/app.ts`) make the whole thing deployable as one
container — no auth-flow or DB code changes were needed.

## ⚠️ This API has no login of its own

Unlike the Field Service Calendar / Admin Console apps, this app's
`app.ts` has no session/cookie/login layer at all — `/api/*` is completely
open to anyone who can reach it, and it's protected only by whatever sits in
front of it on the network. Before exposing this in Azure, decide how that
gap gets closed — options, roughly cheapest to most involved:

- **Azure App Service Authentication ("Easy Auth")** — turn on built-in Entra
  ID auth at the App Service level; no application code changes needed.
- **Network restriction** — VNet integration + private endpoint, an IP
  allow-list, or putting it behind Azure Front Door / Application Gateway
  with a WAF, if it only ever needs to be reached from inside a corporate
  network.
- **API Management** in front of it, if you need per-client keys/quotas
  rather than a single shared boundary.

This is a decision for you/your security team, not something this project
guesses at — flagging it clearly since it's easy to miss when the app itself
never mentions auth anywhere.

## One container, four frontends

`Dockerfile` builds all four frontends — `shop-floor`, `shop-floor-mobile`,
`production-booking`, `new-booking-schedule` — each with
`BASE_PATH=/apps/<name>/`, and the API server serves all four itself
(`STATIC_ROOT_DIR` env var — see the block in `app.ts`) at:

- `https://<your-domain>/apps/shop-floor/`
- `https://<your-domain>/apps/shop-floor-mobile/`
- `https://<your-domain>/apps/production-booking/`
- `https://<your-domain>/apps/new-booking-schedule/`
- `https://<your-domain>/` — a plain landing page linking to the four above
  (there's no single "main" app among these four, so nothing owns the root
  by default; change the `app.get("/", ...)` handler in `app.ts` if you'd
  rather redirect straight to one of them)

This keeps it to one Azure resource instead of five. If you'd rather deploy
one or more of these separately (e.g. `shop-floor-mobile` as its own
Static Web App for a distinct mobile-friendly domain), skip
`STATIC_ROOT_DIR` and deploy that frontend's `dist/public` (built with its
own `BASE_PATH`, e.g. `/`) to wherever you want it — since there's no
session cookie in this app, there's no CORS/cookie complication either way.

## 1. Azure resources to create

| Resource | Purpose |
|---|---|
| Azure Container Registry (ACR) | Stores the built image |
| Azure App Service (Linux, "Web App for Containers") **or** Azure Container Apps | Runs the container |
| Azure Database for PostgreSQL – Flexible Server | Two logical connections: the app's own Drizzle-managed DB (`DATABASE_URL`) and the Azure AD-authenticated one (`AZURE_PG_*`) — these can be the same server/database or different ones depending on how your environment is laid out |
| Azure App Registration (Entra ID), service principal | Used for Postgres AAD auth (optional, see below), D365 F&O OData, and Microsoft Graph mail |
| Dynamics 365 F&O environment | The app registration must **also** be registered inside D365 under System administration → Setup → Microsoft Entra ID applications, or D365 rejects the call with 401/403 even with a valid token |
| Exchange Online / Microsoft Graph | The app registration needs the **application** permission `Mail.Send`, admin-consented, and ideally scoped to one mailbox via an Exchange Online Application Access Policy |

## 2. Build & push the image

```bash
az acr login --name <your-acr-name>
docker build -t <your-acr-name>.azurecr.io/production-calendar:latest .
docker push <your-acr-name>.azurecr.io/production-calendar:latest
```

## 3. Environment variables (App Settings / Container Apps secrets)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string for the Drizzle-managed tables (`bookingSlotsTable`, `productionGroupOverridesTable`, …) |
| `AZURE_PG_HOST` | Yes | Azure Postgres host for the AAD/native-password-authenticated pool (`lib/azureDb.ts`) |
| `AZURE_PG_DATABASE` | Yes | |
| `AZURE_PG_SP_USER` (or `AZURE_PG_USER`) | Yes | DB role name |
| `AZURE_PG_PORT` | No | Defaults to 5432 |
| `PG_NATIVE_PASSWORD` (or `AZURE_PG_PASSWORD`) | One of these two rows | **Preferred path**: native password auth — simplest, works with any Postgres role |
| `AZURE_TENANT_ID` + `AZURE_CLIENT_ID` + `AZURE_CLIENT_SECRET` | required if no native password | Used for Postgres AAD token auth (only works if the DB role is an Entra principal) **and** for D365 OData **and** for Graph mail — the same three values, three purposes |
| `D365_URL` | Yes, for D365 write-back | e.g. `https://yourorg.operations.dynamics.com` |
| `STOREROOM_EMAIL` | Yes, for parts-request email | Destination inbox |
| `STOREROOM_SENDER_MAILBOX` | Yes, for parts-request email | Mailbox the message is sent from (must be covered by the app registration's Graph `Mail.Send` grant / access policy) |
| `PORT` | No | Azure sets this for you; the `Dockerfile` defaults it to `8080` |
| `STATIC_ROOT_DIR` | No | Already set by the `Dockerfile`; only change if you rearrange the image |

## 4. Push the Drizzle schema

```bash
pnpm --filter @workspace/db run push
```

Against `DATABASE_URL` — this is the app's own DB, not the `AZURE_PG_*` one,
which this app only reads/writes ad hoc via `pg` directly and doesn't
manage through Drizzle.

## 5. Health check

`GET /api/healthz` returns `{ "status": "ok" }` — point Azure App Service's
health check path (or Container Apps' liveness probe) at `/api/healthz`.
Note this endpoint does **not** check connectivity to either Postgres, D365,
or Graph — it only confirms the process is up.
