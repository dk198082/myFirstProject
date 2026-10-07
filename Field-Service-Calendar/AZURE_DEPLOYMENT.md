# Deploying to Azure

## 🆕 Highlighted new change: ingestion status no longer races the first post-idle sync

`GET /api/wb/ingestion-status` now calls `refreshCrmIngestion()` itself
before reading `crm.calendar_ingest_state`, instead of only relying on the
board's own read to have triggered a cycle first. This closes the gap noted
in `.agents/memory/autoscaled-crm-ingestion.md`: on an autoscaled cold
start, a status poll could previously land *before* the board's
ingestion-triggering read and cache a stale "unhealthy/lagging" warning even
after the mirror had actually caught up. No new environment variables or
deployment steps — this is a same-endpoint behavior fix. Tests
(`writeback-role.test.ts`) were updated in this export to assert
`refreshCrmIngestion` is called on status checks; all 172 tests pass.

## 🔧 Fixed in this round: SPA fallback route crashed the server on boot with `STATIC_DIR` set

This export's `app.ts` had been reset to Replit's un-patched baseline again
(as happens most rounds — see the recurring env-var/CORS/static-serving
notes throughout this doc), so I reapplied the standard Azure patches:
`trust proxy` for the reverse proxy, `CORS_ORIGIN`-driven CORS, and the
`STATIC_DIR` static-file + SPA-fallback block that lets this API server also
serve the built frontend as one Azure App Service / Container Apps
container.

While reapplying it I caught something I'd have otherwise shipped broken:
this repo is on **Express 5**, and Express 5's router (path-to-regexp v8)
**rejects a bare `"*"` wildcard route** — `app.get("*", ...)` throws
`PathError: Missing parameter name at index 1: *` at startup and the process
exits immediately. I only found this because I boot-tested the built server
with `STATIC_DIR` set rather than trusting the code by itself; the earlier
boot test without `STATIC_DIR` looked completely healthy and would have
hidden this. Fixed by replacing the `app.get("*", …)` fallback with a
path-less `app.use((req, res, next) => { … })` middleware, which Express 5
has no trouble with. Reverified after the fix: `/`, `/schedule/whatever`
(client-side route), `/api/healthz`, an unknown `/api/*` path, and the
protected `/api/wb/ingestion-status` all now return the expected
200/200/200/404/401 with `STATIC_DIR` pointed at the real build output — the
SPA fallback serves `index.html` for real, and `/api/*` paths still 404
correctly instead of being swallowed by it.

## 📁 Answering "what filename needs to change": `main.py` at the repo root

There's a leftover `main.py` at the repo root — Replit's default
`nodejs-24, python-3.11, postgresql-16` template hello-world script (`print("Hello
from repl-nix-workspace!")`), not used anywhere by this Node/TypeScript app.
It's not a file this app needs renamed for Azure — it should simply be
**deleted**. It's been flagged in earlier rounds too (see
`.agents/memory/node-publish-python-remnants.md`): a stray Python project
manifest at the root has previously caused Replit's own publish pipeline to
run `uv lock` and Python dependency installation before any Node build step
even starts, which is irrelevant work at best and a source of publish
failures at worst. It has no bearing on the Azure Docker build in this repo
(the Dockerfile only builds the Node workspaces), so it's not blocking
Azure, but it's dead weight worth removing at the source.

The one other file name that's arguably generic rather than wrong: the root
`package.json` declares `"name": "workspace"` rather than something
app-specific like `"field-service-calendar"`. This is cosmetic only — it
doesn't affect the Azure build or runtime — so I left it as-is rather than
renaming it without being asked, but happy to rename it if you'd like the
package name to be more identifiable.

## ⚠️ Worth confirming: `fs-training-deck` and `dynamics-write-back` are gone from this export

Both were present as recently as the last export processed here.
`fs-training-deck` had real, previously-documented Azure deployment
infrastructure built for it across several earlier rounds (a
`STATIC_TRAINING_DECK_DIR` mount served at `/fs-training-deck/`, its own
Dockerfile build step). This export's own source shows awareness of the
removal, not just an accidental gap — `routes/auth.ts`'s comments and
`auth.test.ts` were both updated to stop referencing
`/dynamics-write-back/` — but flagging it clearly anyway, since this
removes real functionality that isn't obviously optional from the outside:

- **`fs-training-deck`** was a dispatcher training slide deck, served
  alongside the main app.
- **`dynamics-write-back`** was a separate Vite frontend (never actually
  built into this Docker image in prior rounds either, so its absence
  doesn't change anything deployment-wise on its own).

**What I did about it:** removed the `STATIC_TRAINING_DECK_DIR` mount from
`app.ts` and the corresponding build step from `Dockerfile` — leaving them
in would have made the Docker build fail outright (`pnpm --filter
@workspace/fs-training-deck` errors when that package doesn't exist). If
this removal wasn't intentional, the fix is to restore
`artifacts/fs-training-deck` from the last export that had it and let me
know — the STATIC_TRAINING_DECK_DIR block is a quick, proven re-add (was
present and working across many prior rounds, so this isn't new work if it
comes back — just reapplying the earlier known-good version).

## ✅ Update: the "no auth enforcement" gap from previous exports is fixed

Earlier exports of this app had a login flow that didn't actually gate any
data routes — I flagged this prominently a few rounds back. That's still
fixed in this export: every route in `writeback.ts` and the other data
routers has `requireLogin` (any logged-in user) or `requireRole("editor")`
(write access) applied per-route (see `lib/auth.ts` for the middleware) —
including the `/wb/admin/sync-mirror` endpoints called out previously.

## ✅ Update: the local-fallback login bug is also fixed — and the design changed

Last round I traced the 9 failing `auth.test.ts` tests to a real bug: a
malformed Admin Console response fell through to a local `app.app_user`
table query that the tests didn't mock properly, and the whole thing was
swallowed by one generic `catch` that always returned `500`. **This export
removes the local fallback path entirely** rather than fixing the test mock —
a bigger, deliberate design change:

- `routes/auth.ts` no longer imports `localPool` or queries `app.app_user` at
  all. The Data Admin Suite's `/api/access-check` is now the **only**
  authorization source — there is no fallback.
- Every failure mode now gets its own explicit, distinct HTTP status instead
  of falling through to a generic catch-all:
  - `ADMIN_CONSOLE_URL` / `ADMIN_CONSOLE_API_KEY` not set → `500` ("Auth not
    configured") — a deployment misconfiguration, not a per-request failure.
  - Admin Console reachable but returns non-2xx → `503` ("Authorisation
    service unavailable").
  - Response isn't valid JSON, or fails the Zod schema check → `503`
    ("Unexpected response from authorisation service").
  - Network/fetch error (Admin Console unreachable) → `503`.
  - Reachable and valid, but `allowed: false` → `403`, with the reason from
    the Admin Console.
- **`ADMIN_CONSOLE_URL` and `ADMIN_CONSOLE_API_KEY` are now required, not
  optional.** Without them, `/api/login` and `/api/auth/callback` will
  return `500` for every single user — there is no way to log in without a
  working Data Admin Suite deployment configured. This is a real deployment
  **ordering** requirement: deploy and configure the Data Admin Suite first,
  confirm its `/api/access-check` works, *then* deploy this app.

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_CONSOLE_URL` | **Yes** | Base URL of the deployed Data Admin Suite, e.g. `https://admin.yourorg.azurewebsites.net`. No fallback if unset — every login attempt returns `500`. |
| `ADMIN_CONSOLE_API_KEY` | **Yes** | Matches an API key configured on that Admin Console deployment for its `/api/access-check` endpoint (see that app's own `AZURE_DEPLOYMENT.md`). |

**Cleanup worth doing, not done here:** `app.app_user` (the Drizzle table)
and `scripts/insert-app-user.mts` (the seeding script) are now dead code —
nothing in the running app reads that table anymore. I didn't delete them
since removing a database table is a one-way decision I'd rather you make
deliberately, but flagging it so the table/script don't get mistaken for
something that still matters, and so the earlier advice about needing at
least one `app.app_user` row no longer applies — the current design has no
concept of a local account at all.

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
| `ADMIN_CONSOLE_URL` / `ADMIN_CONSOLE_API_KEY` | **Yes** (see above) | Centralized login authorization via the Data Admin Suite — the only authorization source as of this export, no local fallback |
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

- **Fixed since last round:** the `auth.test.ts` failures I root-caused last
  time (9 tests expecting `503`, getting `500`) are resolved in this export —
  and via option (a) from my suggestion last round, not (b): the local
  `app.app_user` fallback was removed entirely, and every failure mode
  (misconfiguration, non-2xx, non-JSON, failed schema validation, network
  error) now returns its own explicit status (`500` for missing config,
  `503` for the rest) instead of falling through to one generic catch-all.
  Confirmed: the full test suite is now 123/123 passing (was 114/123). See
  the "local-fallback login bug is also fixed" section above for the
  env var / deployment-ordering implications of this change.

## New in this export: Calendar Report (PDF/DOCX generation + email)

Frontend-only PDF/DOCX generation (`@react-pdf/renderer`, `docx`, `jszip` —
new dependencies in `field-service-schedule-board/package.json`, all pure
client-side libraries) with a `CalendarReportDialog.tsx` that lets a
coordinator download a technician's schedule as a PDF/DOCX, or email it
directly. No Dockerfile changes needed — nothing here requires a headless
browser or server-side rendering.

The **email path does add a new Azure requirement**, though: `POST
/wb/calendar-report/email` sends via Microsoft Graph using the same
`ENTRA_CLIENT_ID`/`ENTRA_TENANT_ID`/`ENTRA_CLIENT_SECRET` (or
`CLIENT_ID`/`TENANT_ID`/`CLIENT_SECRET`) credentials already required for
login — no new environment variables — but the **App Registration itself
needs two additional Microsoft Graph *application* permissions, admin-
consented**, that login alone doesn't require:

- **`Mail.Send`** — required to send the email at all.
- **`User.Read.All`** — only needed as a fallback, to resolve a technician's
  mailbox by their stored Entra object ID when the CRM record's email field
  is blank (see `.agents/memory/technician-mailbox-resolution.md` for the
  exact resolution order). If every technician's CRM record already has an
  email on file, this permission is optional, but the safer default is to
  grant it up front — this is a "fails closed" design (an unresolvable
  technician mailbox is treated as an error, not guessed), so you'll notice
  quickly in testing if it's needed rather than silently emailing the wrong
  person.

Also worth noting: `express.json()`'s body size limit was raised to `5mb` in
`app.ts` to accommodate the base64-encoded PDF this endpoint accepts — already
reflected in the current `app.ts`, no action needed, just flagging it since
it's a meaningful change from the default 100kb limit if you're used to
Express's defaults.

## New in this export: `fs-training-deck` (dispatcher training slides)

A completely separate, static, API-free Vite app — a 10-slide training
presentation for dispatchers — with its own `.replit-artifact/artifact.toml`
showing Replit already publishes it at `/fs-training-deck/` via the same
path-router pattern the multi-frontend Production Calendar app uses. I
extended `app.ts` and `Dockerfile` to match:

- New optional `STATIC_TRAINING_DECK_DIR` env var — if set, serves the built
  deck at `/fs-training-deck/`, mounted *before* the main app's catch-all so
  it isn't shadowed. Leave it unset to skip building/serving it at all.
- `Dockerfile` now builds it as a second step, specifically with
  `BASE_PATH=/fs-training-deck/` — the root `pnpm run build` already builds
  it once with `BASE_PATH=/` (correct for the main SPA, wrong for a
  subpath-mounted one), so it needs a second, explicitly-based rebuild
  afterward or its asset URLs would 404 under `/fs-training-deck/`.

Purely a convenience mount — since it makes zero API calls, there's no
CORS/cookie interaction with the main app either way, so it's just as valid
to deploy it separately (e.g. as its own Azure Static Web App) if you'd
rather keep it out of this container.

**Fixed (blocked the build):** `fs-training-deck/src/widgets/ImportedChart.tsx`
had a `values.reduce((sum: number, value) => sum + Math.abs(value ?? 0), 0)`
call where TypeScript inferred the result (`total`) as `number | null`
instead of `number`, despite the explicit `sum: number` annotation on the
callback — failing the build with "'total' is possibly 'null'" where it's
later used in a division. Fixed by moving the type onto `reduce`'s own
generic parameter (`values.reduce<number>(...)`) instead of the callback
argument, which resolves the overload ambiguity cleanly. No behavior change,
confirmed by rerunning the full build (now passes) and the existing test
suite (144/144, unaffected — this file has no tests of its own).

Also new: `scripts/generate-training-doc.mjs`/`.cjs` — a standalone,
build-time-only script (uses the `docx` package, pure JS, already used
elsewhere in this repo) that regenerates
`docs/field-service-schedule-board-guide.docx`. Not part of the running app
or the Docker image; run it manually (`node scripts/generate-training-doc.mjs`)
if the guide ever needs updating.

## 🔧 Highlighted fix in this export: Custom-range Calendar Reports were silently dropping the last day

Per the team's own new memory note
(`.agents/memory/calendar-report-date-boundaries.md`), the Calendar Report
pipeline treats `endDate` as **exclusive** everywhere internally (SQL filter
`starttime < $endDate`, the week-builder loop, the label builder) — but
`CalendarReportDialog.tsx`'s "Custom range" mode was passing the user's
picked end date straight through as `endDate` without converting it. A user
picking "Aug 1 to Sept 4" meaning *inclusive* of Sept 4 would silently get a
report missing every booking/block on Sept 4, with no error or indication
anything was cut off. Month-range mode was unaffected (it already computed
its own exclusive end via `addMonths()`).

This export fixes it: the dialog now computes
`customEndDateExclusive = addDays(customEnd, 1)` and sends that as `endDate`,
while fixing the displayed date-range label to show the actual inclusive
range the user picked (previously reused `buildDateRangeLabel`, which expects
an exclusive end and would have mis-labeled a custom range's last day too).
No deployment changes needed — this is entirely a frontend date-arithmetic
fix, no new env vars or routes. Worth knowing if any custom-range Calendar
Report was ever generated and appeared to be "missing the last day" before
this export — this is almost certainly why.

**Also reapplied here** (reverted again in this export, same as previous
rounds): the `fs-training-deck/ImportedChart.tsx` `reduce<number>` type fix
from the last round — see that section above for the original explanation.
Re-confirmed the build passes with it back in place.

## New in this export: chip color palette, and booking notes on the report

**New chip color option.** `ChipColorPicker.tsx` appends one new palette
entry (`#fca5a5`, a light red) to the shared color list. This correctly
follows the constraint documented in the team's own new memory note
(`.agents/memory/persisted-chip-color-indexes.md`): color overrides are
stored as a numeric `color_index` alongside schedule blocks/placeholder
jobs, so inserting or reordering existing entries would silently recolor
already-saved records — this export only **appends**, which is the safe
operation. No deployment impact; confirmed by diffing the palette array
directly rather than assuming the convention was followed.

**Booking notes now appear in Calendar Reports.** `writeback.ts`'s booking
list query gains a `notes` column (was already stored, just not selected
before), and `calendarReportApi.ts` includes it as a `Notes: ...` line in
generated report entries for potential-job bookings that have one. No schema
change (the column already existed), no new env vars.

## 🆕 New in this export: coordinator default region filter

`GET` on the schedule board's booking-list route now calls the new
`lib/coordinatorDefault.ts`, which looks up the logged-in user's CRM
territory assignment (matching their session email against
`crm.systemuser`/`crm.territory`, restricted to regions R1–R5) and returns
their default region(s) plus their manager display name — used to
pre-populate the board's region filter for coordinators instead of showing
everything unfiltered by default.

**No deployment changes needed.** It reuses the existing `getCrmPool()`
connection (`D365CRM_DATABASE_URL`, already documented above) and is
correctly guarded behind the same `isCrmConfigured()` check the rest of the
CRM-backed booking route already uses — if `D365CRM_DATABASE_URL` isn't set,
this whole route (not just the new lookup) already returns `503` as before,
so there's no new failure mode to account for. Ships with its own unit test
(`coordinatorDefault.test.ts`).

## 🆕 New in this export: "Include custom blocks" option for Calendar Reports

Calendar Reports previously always excluded custom schedule blocks (the
manually-added, non-CRM-sourced calendar entries) from the generated
PDF/DOCX — `eventsForExport()` filtered them out unconditionally.
`CalendarReportDialog.tsx` now has an opt-in checkbox
("Include custom blocks"), defaulting to **off**, so existing report output
is unchanged unless a user explicitly turns it on. `eventsForExport()` and
the new `eventKindsForExport()` both take an `includeCustomBlocks` parameter
that defaults to the previous (exclude) behavior.

No deployment changes needed — this is a frontend-only filtering change, no
new routes, no new env vars, no schema changes. Ships with a new backend
test (`writeback-calendar.test.ts`) covering that Travel Time/PTO/Custom
blocks are correctly included as report-eligible events.

## 🆕 New in this export: postal code on jobs and bookings

Placeholder jobs, bookings, and work orders now carry a `postal_code` field,
shown alongside city/state everywhere the schedule board already displays
location and included in the board's search/filter matching. Sourced from
`msdyn_postalcode` (work orders) or `cf_zippostalcode` (CRM service
locations), enriched into the placeholder-jobs list via a lookup that's
correctly **defensive**: it's wrapped in its own try/catch that logs a
warning and leaves `postal_code: null` on failure rather than breaking the
whole booking list if that one lookup query fails, and it's gated behind the
existing `isCrmConfigured()` check like the rest of the CRM-backed
functionality. No new environment variables, no schema changes — reuses the
existing CRM database connection and adds a plain nullable column to
existing response shapes.

**Related, same export:** the chip color palette gained one more entry
(`color_index` validation bumped from max 15 to max 18 across every Zod
schema in `writeback.ts`, consistently). Checked this against the same
append-only constraint documented a few rounds back
(`.agents/memory/persisted-chip-color-indexes.md`) — confirmed via diff that
the new color was appended, not inserted or reordered, so no existing saved
records get silently recolored.

## New in this export: region R5's default color reassigned

`ScheduleBoard.tsx`'s region-default color map changes `R5` from palette
index 18 to index 10 (pink). Checked this specifically against the same
persisted-color-index constraint: this changes which **existing** palette
entry is used as the fallback color for region R5 — it does not modify the
palette array itself or repurpose what any index *means*, so it's exactly
the kind of change the team's own convention describes as safe ("point the
region default map at the new index"). It also **cannot** silently recolor
any already-saved schedule block or placeholder job, since those store
their own explicit `color_index` independent of the region default — this
only affects the color a *new, unset* block in region R5 gets by default.
No deployment impact.

## 🆕 New in this export: UK-only postcode display

Per the team's new memory note (`.agents/memory/uk-only-postcode-display.md`),
postal codes now only show on schedule chips and Calendar Report output when
the associated CRM country is explicitly the UK (or a UK constituent
country) — US ZIP codes stay hidden. Well-implemented, worth calling out:
the country check lives in **one shared function**
(`postalCodeForDisplay()` in `calendarReportApi.ts`), imported by
`ScheduleBoard.tsx`, `calendarReportPdf.tsx`, and `calendarReportDocx.ts`
rather than duplicated — confirmed by grepping for the logic, not assumed.
It matches on country name/code (`uk`, `gb`, `gbr`, "united kingdom", "great
britain", and the four constituent countries), never infers country from
postcode format. No deployment changes — reuses the existing CRM
connection, adds a plain `country` field alongside the existing
`postal_code` enrichment from a few rounds back.

**Also in this export:** a new Zod `.refine()` validation on block
create/update requires `end_time` to be strictly after `start_time` — a
genuine bug-prevention fix, not just a new feature. Before this, a block
could be saved with an end time earlier than its start time with no
server-side rejection.

**And:** Calendar Report typography/formatting rules were standardized per
`.agents/memory/calendar-report-text-treatment.md` (11pt black text
throughout, no truncation, no redundant "Notes:" prefixes, Custom Blocks
sorted after other same-day events, untitled blocks show "Block" not
"Custom") — consistently applied across the PDF, Word, and emailed-PDF
renderers. No deployment impact, purely visual/formatting.

## 🆕 New in this export: multi-day CRM bookings now expand across weekdays correctly

New `lib/scheduleSpan.ts` (with its own 95-line test file) computes which
calendar days a multi-day CRM booking's chip should appear on, and its
`D#/#` day-counter label — used from `writeback.ts` in both the
technician-grouped and the region/service-location-grouped booking list
queries, per `.agents/memory/multiday-booking-weekdays.md`.

**The rule, and why it's non-trivial:** a booking spanning a weekend doesn't
mean the technician is scheduled to work that weekend — so Saturday/Sunday
chips are only shown when the booking itself *starts or effectively ends*
on that specific weekend date, not merely passes through it. The `D#/#`
counter only counts included working days, and — this is the part worth
knowing about if this is ever debugged later — the counter must stay
*stable* across week/month view boundaries: opening a later week must show
the correct continuing count (e.g. "D6/10"), not restart at "D1", and a
skipped weekend must not inflate the total. `scheduleSpan.ts`'s tests cover
this directly; if a future change to booking display logic doesn't route
through this shared utility, this exact numbering could silently regress
per-query.

No deployment changes needed — this is a query-logic and rendering change,
no new routes, no new env vars, no schema changes.

## 🆕 Highlighted new change: Potential Job technician selection is now access-scoped, not board-filter-scoped

Adding or editing a Potential Job now requires an explicit technician
selection (previously inferred silently from the row clicked), and — this
is the part worth understanding — the dropdown itself is scoped by access,
per `.agents/memory/potential-job-technician-scope.md`:

- **Coordinators with assigned regions** (the same `coordinator_default`
  region assignment introduced a few rounds back) see only technicians in
  those regions.
- **Everyone else** sees only technicians in the region of the row they
  clicked (create) or the job's currently-assigned technician (edit).
- **Critically: the board's own "All regions" display filter is explicitly
  NOT treated as permission to see every technician.** The memory note
  documents this was confirmed behavior, verified against a real scenario
  (adding a Potential Job from an R99 technician row correctly showed only
  R99 technicians) — this is a deliberate access-scoping decision, not an
  oversight to "fix" later by widening the list.

Backed by a new `service_location_id` field added to several booking
queries in `writeback.ts` and the `ScheduleJob` API type, used to match
scheduled jobs' CRM service location back to Potential Jobs. No deployment
changes needed — additive column selection, no schema change, no new env
vars.

## New in this export: Purchase Order badge repositioned

The "Purchase Order Received" badge on Potential Job cards moved from an
absolute-positioned accent bar + badge above the card content to a plain
badge below it — visual polish only, no functional or deployment change.
`fs-training-deck` and `dynamics-write-back` remain absent from this export,
consistent with last round.

## 🆕 Highlighted new change: CRM ingestion — with a real Azure autoscaling consideration

New background CRM (Dataverse) ingestion pipeline (`lib/crmIngestion.ts`)
that keeps the calendar's CRM mirror current. **Read this before deploying
to an autoscaled Azure target** — the team's own memory note
(`.agents/memory/autoscaled-crm-ingestion.md`) documents exactly why this
needed careful design, and it applies to Azure the same way it applied to
Replit's autoscaled deployment:

> "The API is published on an autoscaled deployment. In-process intervals
> do not run when there are no requests... Do not claim a hard wall-clock
> latency guarantee for closed calendars or during Dataverse throttling; an
> always-on worker/scheduler is required for that."

**What this means concretely for Azure:** if you deploy this to Azure
Container Apps with `minReplicas: 0` (true scale-to-zero) or Azure App
Service with "Always On" disabled, the in-process periodic ingestion timer
will stop running whenever the instance is idle — same as it does on
Replit's autoscaled tier. The app already compensates for this: every
active calendar read (`GET` on the booking list) also triggers a
single-flight ingestion check (`refreshCrmIngestion()`, called from
`writeback.ts`), so the common case (someone has the board open) still
gets fresh data. What this does **not** give you is a guaranteed sync
latency for a calendar nobody is actively viewing — if that matters for
your use case, either keep at least one instance always running
(`minReplicas: 1` on Container Apps, or enable "Always On" on App Service)
so the periodic timer keeps running, or accept that sync only happens on
next access.

**Cross-instance safety is already handled**: ingestion uses a Postgres
advisory lock (`pg_try_advisory_lock`) so running multiple Azure instances
concurrently won't cause duplicate/overlapping ingestion runs — no special
configuration needed for horizontal scaling beyond the usual shared
`DATABASE_URL`.

### Enabling this feature (and how to tell if it's actually on)

`CRM_INGESTION_ENABLED` must be set to exactly `"true"` — anything else
(unset, `"1"`, `"True"`, etc.) leaves the feature inert. **Confirmed via a
live boot test**: the server does log a clear line at startup either way —
`"CRM ingestion disabled; set CRM_INGESTION_ENABLED=true on the deployed API
server"` when it's off, so this isn't actually silent the way it might look
from the code alone; check the startup logs after deploying to confirm
which state you're in. New required env vars for this feature:

| Variable | Required | Notes |
|---|---|---|
| `CRM_INGESTION_ENABLED` | Yes, to enable the feature | Must be the literal string `"true"` |
| `DATAVERSE_URL` | Yes, if enabling | Dataverse Web API base URL |
| `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` | Already required | Reused for Dataverse's own OAuth — same App Registration credentials already documented above for Entra login |
| `D365CRM_DATABASE_URL` | Already required if using CRM features at all | Same variable documented in earlier rounds — ingestion writes into the same CRM mirror |

New monitoring endpoint: `GET /api/wb/ingestion-status` (behind
`requireLogin`) reports whether ingestion is enabled/healthy and each
entity's sync lag — useful for confirming this actually turned on correctly
after deploying, rather than only discovering it's off when data looks
stale.

### Also new: partial-success reporting for direct CRM saves

When a user saves a booking directly to CRM, the app now immediately tries
to read the confirmed result back into the local mirror. If CRM accepted
the save but that read-back fails, the app reports **partial success**
(`mirror_synced: false`) rather than a failure — deliberately, per the
memory note, to avoid inviting a retry that could apply the same write
twice. No deployment changes needed for this specifically.

## Also found: a harmless leftover file, not needed for deployment

A root-level `main.py` (a template "Hello from repl-nix-workspace!" script)
is present — per `.agents/memory/node-publish-python-remnants.md`, a
similar stray Python manifest previously caused Replit's *own* publishing
pipeline to attempt Python dependency installation before the Node build
ran. This `main.py` alone (no `pyproject.toml` found alongside it in this
export) doesn't affect the Azure Docker build here — the Dockerfile never
invokes any Python tooling — but it's dead weight worth deleting to avoid
confusing a future Replit publish attempt the same way again.
