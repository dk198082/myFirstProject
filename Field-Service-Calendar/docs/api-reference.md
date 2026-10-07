# Field Service Calendar API Reference

**Status:** Implemented API inventory  
**Last reviewed:** 2026-07-31  
**API base path:** `/api`  
**Applications served:** Field Service Schedule Board and Dynamics Write Back

This document describes the APIs implemented in this repository. It is intended
as an operational reference for application developers, integration owners, and
support teams. It does not contain credentials or connection-string values.

## 1. Architecture and systems

The project has one Express API server. The two web applications call that
server through the `/api` path.

| System | How this project uses it | Configuration |
|---|---|---|
| Field Service PostgreSQL | Main Field Service data source for the original technician dashboard, work-order, booking, and utilization APIs | `FS_DB_HOST`, `FS_DB_PORT`, `FS_DB_NAME`, `FS_DB_USER`, `FS_DB_PASSWORD` |
| Local application PostgreSQL | Sessions, staged booking write-backs, placeholder jobs, and schedule blocks | `DATABASE_URL` |
| `d365crm` PostgreSQL mirror | Read model for the Dynamics Write Back app; also stores dispatcher booking notes and mirrors locally-created placeholder jobs and schedule blocks | `D365CRM_DATABASE_URL` |
| Microsoft Entra ID | Interactive user sign-in through OAuth 2.0 authorization code flow | `CLIENT_ID`/`TENANT_ID`/`CLIENT_SECRET` or `ENTRA_*` equivalents |
| Admin Console | Server-side authorization check after Entra sign-in; determines whether a user may use Field Service Calendar and which role they have | `ADMIN_CONSOLE_URL`, `ADMIN_CONSOLE_API_KEY` |
| Microsoft Dataverse / Dynamics 365 | Direct booking updates, new booking creation, and targeted CRM mirror backfills | `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `DATAVERSE_URL` |

### Data ownership

- The Field Service routes read from the Field Service PostgreSQL database.
- The `/wb/*` routes read primarily from the `d365crm` mirror and use the
  local application database for staged changes.
- A queued write-back is not in Dynamics until `POST /api/wb/sync` succeeds.
- Direct-save routes call Dataverse immediately and do not create a queued
  `booking_writebacks` row.
- Placeholder jobs and schedule blocks are local application records. Their
  writes are mirrored best-effort into `crm.placeholder_jobs` and
  `crm.schedule_blocks`.
- Dispatcher booking notes are stored in `crm.booking_notes`; they are not
  written back to Dynamics.

## 2. Authentication and authorization

### Internal API authentication

All application routes except the health check and login start require the
Express session established by Microsoft Entra sign-in. The browser sends the
session cookie automatically.

| Middleware | Meaning |
|---|---|
| Public | No session required |
| `requireLogin` | Any authenticated Field Service Calendar user |
| `requireRole("editor")` | A user with the editor/read-write role; viewers receive `403` |

The Admin Console is the authorization source of truth. The server calls its
access-check endpoint after Entra returns an ID token. A successful role mapping
is:

- Admin Console role containing `Read / Write` → local `editor`
- Other allowed Field Service Calendar roles → local `viewer`

If the Admin Console is unavailable, the implementation has a local
`app.app_user` fallback for active users. This fallback is a resilience
mechanism, not the primary user-management workflow.

### Standard status codes

| Status | Meaning |
|---|---|
| `200` | Successful read or mutation |
| `201` | Resource created |
| `204` | Resource deleted; no response body |
| `400` | Invalid query parameter, path parameter, or JSON body |
| `401` | No valid login session |
| `403` | Authenticated but not permitted, or invalid OAuth state |
| `404` | Requested record does not exist |
| `500` | Unexpected application or database error |
| `503` | Required external system is not configured or temporarily unavailable |

When the `d365crm` database is unavailable, `/wb/*` routes normally return:

```json
{
  "error": "The CRM database is temporarily unavailable. Please try again in a moment.",
  "code": "CRM_DB_UNAVAILABLE"
}
```

## 3. Internal REST API

All paths in the following tables are relative to `/api`.

### 3.1 Health and authentication

| Method and path | Access | Purpose | Success response |
|---|---|---|---|
| `GET /healthz` | Public | Liveness/health check | Health status JSON |
| `GET /login?returnTo=/path` | Public | Starts Microsoft Entra authorization-code login; `returnTo` is restricted to a safe local path | `302` redirect to Microsoft |
| `GET /auth/callback?code=...&state=...` | OAuth callback | Exchanges the Entra code, checks Admin Console authorization, creates the session, and redirects to the saved local path | `302` to the application |
| `GET /me` | Login required | Returns the current session user | `{ entraOid, email, displayName, role }` |
| `POST /logout` | Public/session-aware | Destroys the local session and redirects to the Entra logout endpoint | `302` |

### 3.2 Field Service dashboard APIs

These routes read from the Field Service PostgreSQL database.

| Method and path | Access | Query/path parameters | Purpose and response |
|---|---|---|---|
| `GET /technicians` | Login required | — | Active technicians: `technician_id`, `resource_name`, `user_email`, `phone`, `resource_type`, `is_active` |
| `GET /technicians/by-email` | Login required | Required `email` | Technician identity plus assigned jobs: `{ jobs, technicianEmail, technicianName }` |
| `GET /technicians/:technicianId/work-orders` | Login required | Required technician ID | Assigned jobs plus technician name/email |
| `GET /technicians/:technicianId/summary` | Login required | Required technician ID | Counts by status, priority, and today: `{ technician_id, total, by_status, by_priority, upcoming_today }` |
| `GET /work-orders/:workOrderId` | Login required | Required work-order ID | Work-order detail, customer, contact, booking, products, services, and equipment |
| `GET /dashboard/summary` | Login required | — | Overall counts, work-order status/priority breakdowns, and top technicians |
| `GET /scheduled-jobs` | Login required | — | Scheduled jobs grouped by region/state and technician |
| `GET /jobs-by-region` | Login required | Optional `status` | All jobs grouped by region and technician; optional work-order status filter |
| `GET /schedule-board` | Login required | Required `start` (`YYYY-MM-DD`); optional `view=week\|month`; optional `groupBy=tech-region\|service-location` | Date-bounded board data with regions, technicians, and jobs |
| `GET /unscheduled-jobs` | Login required | — | Unscheduled work orders enriched with due date, duration, contact, and up to two ranked best-fit technicians |
| `GET /resource-utilization` | Login required | Required `start` (`YYYY-MM-DD`); optional `view=week\|month\|quarter` | Region/technician capacity and utilization percentages; default capacity is 40 hours/week |

### 3.3 Dynamics Write Back work-order and booking APIs

These routes use the `d365crm` mirror for reads and the local database for
queued write-backs. Editor routes validate their body with Zod.

The common booking update body is:

```json
{
  "start_time": "2026-08-06T09:00:00.000Z",
  "end_time": "2026-08-06T10:30:00.000Z",
  "technician_id": "bookable-resource-guid"
}
```

At least one of `start_time`, `end_time`, or `technician_id` must be supplied.
The timestamp fields may be `null`; `technician_id` may be `null`.

| Method and path | Access | Purpose | Success response |
|---|---|---|---|
| `GET /wb/work-orders` | Login required | List mirror work orders with their primary booking and any pending local write-back | JSON array; optional `search`, optional `limit` from 1 to 500, default 100 |
| `PATCH /wb/bookings/:bookingId` | Editor | Queue an edit to an existing booking; does not call Dynamics immediately | Staged write-back record with `status: "queued"` |
| `POST /wb/work-orders/:workOrderId/booking` | Editor | Queue a new booking for an unscheduled work order | Staged write-back using synthetic booking ID `new:<workOrderId>` |
| `POST /wb/bookings/:bookingId/save` | Editor | Directly patch an existing booking in Dataverse; bypasses queue | `{ "message": "Booking saved to CRM" }` |
| `POST /wb/work-orders/:workOrderId/booking/save` | Editor | Directly create a Dataverse booking for an unscheduled work order; bypasses queue | `{ "message": "Booking created in CRM" }` |
| `GET /wb/work-orders/:workOrderId/detail` | Login required | Detailed mirror work order with account/contact, booking, and equipment | Work-order detail object; product/service arrays are empty in the mirror |
| `POST /wb/sync` | Editor | Push queued or failed staged write-backs to Dataverse | `{ processed, synced, failed, results }`; optional body `{ "ids": [123, 124] }` |
| `GET /wb/writebacks` | Login required | List up to the 200 most recent staged write-backs | Array including status, timestamps, technician name, and error |
| `DELETE /wb/writebacks/queued` | Editor | Delete all queued unsaved write-backs | `{ "deleted": number }` |

Write-back statuses are normally `queued`, `processing`, `synced`, or `failed`.
The sync operation atomically claims eligible rows and supports both existing
booking PATCH operations and new booking POST operations.

### 3.4 Scheduling, service location, and search APIs

| Method and path | Access | Parameters/body | Purpose |
|---|---|---|---|
| `GET /wb/schedule-board` | Login required | Required `start`; `view=week\|month\|stacked`; `groupBy=tech-region\|service-location` | CRM-backed schedule board with queued write-back overlays |
| `GET /wb/schedule-blocks` | Login required | Optional `start_date`, `end_date` | Lists overlapping local Drive Time, PTO, and custom blocks |
| `POST /wb/schedule-blocks` | Editor | `technician_id`, `block_type` (`drive_time`, `pto`, `custom`), `start_time`, `end_time`; optional `title`, `notes`, `color_index` 0–15 | Creates a schedule block; returns `201` |
| `PATCH /wb/schedule-blocks/:id` | Editor | Any non-empty subset of the create fields | Updates a schedule block |
| `DELETE /wb/schedule-blocks/:id` | Editor | Integer block ID | Deletes a schedule block; returns `204` |
| `GET /wb/service-locations` | Login required | Optional `search`, `limit` 1–100 (default 20) | Searches CRM service locations by service-location ID, name, city, or state |
| `GET /wb/service-locations/:locationId` | Login required | Required service-location ID | Service location plus primary contact and related equipment |
| `GET /wb/search` | Login required | Required `q`, minimum two characters | Searches future potential, scheduled, and unscheduled jobs |
| `GET /wb/technicians` | Login required | — | Active CRM bookable resources linked to enabled system users |
| `GET /wb/unscheduled-jobs` | Login required | — | CRM unscheduled work orders with due date, duration, contact, and ranked best-fit technicians |
| `GET /wb/jobs-by-region` | Login required | Optional `status` | All CRM bookings grouped by territory and technician |
| `GET /wb/resource-utilization` | Login required | Required `start`; optional `view=week\|month\|quarter` | CRM utilization including local placeholder-job minutes; default capacity is 40 hours/week |

For date-range list endpoints, `start_date` is inclusive and `end_date` is
exclusive. Overlap queries include records that began before the requested
window but extend into it.

### 3.5 Placeholder jobs

Placeholder jobs are speculative/unconfirmed local jobs. They count toward
utilization and are mirrored best-effort to the CRM database.

Allowed `status` values:

- `Reminder Letter Sent`
- `Quoted – No Purchase Order`
- `Have Purchase Order`
- `Have Credit Card`
- `Cash in Advance`
- `Credit Hold`

| Method and path | Access | Body/parameters | Success response |
|---|---|---|---|
| `GET /wb/placeholder-jobs` | Login required | Optional `start_date`, `end_date` | Array of overlapping placeholder jobs |
| `POST /wb/placeholder-jobs` | Editor | Required `technician_id`, `title`, `start_time`, `end_time`; optional customer/location/color/notes/status fields | Created placeholder job, `201` |
| `PATCH /wb/placeholder-jobs/:id` | Editor | Any non-empty subset of the create fields | Updated placeholder job |
| `DELETE /wb/placeholder-jobs/:id` | Editor | Integer placeholder ID | Deletes the job; returns `204` |

### 3.6 Dispatcher booking notes

Booking notes are local CRM-mirror annotations. They are not sent to
Dataverse.

| Method and path | Access | Parameters/body | Success response |
|---|---|---|---|
| `GET /wb/booking-notes` | Login required | Optional comma-separated `bookingIds` | Array of notes found for those CRM booking IDs; empty array when no IDs are supplied |
| `GET /wb/booking-notes/:bookingId` | Login required | Required CRM booking ID | `{ booking_id, note, updated_at }`; `note` is `null` when absent |
| `PUT /wb/booking-notes/:bookingId` | Editor | `{ "note": "Dispatcher note text" }` | Upserted note object |
| `DELETE /wb/booking-notes/:bookingId` | Editor | Required CRM booking ID | Deletes the note; returns `204` |

### 3.7 Reports

All report routes read from the CRM mirror and return JSON for the report UI to
render/export.

| Method and path | Access | Filters | Response |
|---|---|---|---|
| `GET /wb/reports/filters` | Login required | — | `{ regions, years, approvers }` filter options |
| `GET /wb/reports/completed-not-approved` | Login required | Optional `region`, `year`, `month` | `{ total, by_region, rows }`, capped at 1,000 detail rows |
| `GET /wb/reports/approved-not-invoiced` | Login required | Optional `region` | `{ total, by_region, rows }`, capped at 1,000 detail rows |
| `GET /wb/reports/weekly-approved` | Login required | Optional `region`, `approved_by`, `year`, `month` | `{ total, week_numbers, approvers }` |

Report detail rows use these common fields where available:
`fsa_srv_num`, `ax_srv_num`, `company`, `region`, `location`,
`customer_name`, `technician`, `completed_on`, `approved_on`, `approved_by`,
and `order_status`.

### 3.8 Mirror administration and Dynamics backfill

These endpoints are operational/admin capabilities exposed on the shared API.
They currently use the same `editor` role as other write operations; they
should be treated as privileged operations.

| Method and path | Access | Body/parameters | Purpose |
|---|---|---|---|
| `GET /wb/admin/sync-mirror` | Login required | Optional `dry_run=true` (comparison response is read-only) | Compares local placeholder/schedule-block source rows with CRM mirror rows and reports missing IDs |
| `POST /wb/admin/sync-mirror` | Editor | — | Idempotently upserts all local placeholder jobs and schedule blocks into the CRM mirror and reports counts/errors |
| `POST /wb/admin/backfill-from-dynamics` | Editor | `{ "woNames": ["839247"] }`; 1–50 non-empty work-order names | Fetches named work orders/bookings from Dataverse and idempotently upserts them into `crm.workorder` and `crm.booking` |

The backfill response includes `not_found_in_dynamics`, per-work-order results,
and per-booking results.

## 4. External APIs called by this project

These are outbound calls made by the API server. They are not browser-facing
routes.

### 4.1 Admin Console authorization API

**Request**

```http
GET {ADMIN_CONSOLE_URL}/api/access-check
    ?entraObjectId={Entra object ID}
    &app=Field%20Service%20Calendar
X-API-Key: {server-side ADMIN_CONSOLE_API_KEY}
```

The project accepts a response containing:

```json
{
  "allowed": true,
  "reason": null,
  "roles": ["Field Service Calendar - Read / Write"]
}
```

The live service may also return `userName`, `status`, and `permissions`; those
additional fields are currently ignored by this project. Non-2xx, non-JSON, or
schema-invalid responses trigger the local authorization fallback.

### 4.2 Microsoft Entra token endpoint

The interactive login uses MSAL against:

```http
GET/redirect authorization: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
POST token exchange:        https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
GET logout redirect:        https://login.microsoftonline.com/{tenant}/oauth2/v2.0/logout
```

The server uses the OAuth 2.0 authorization-code flow with the configured
client ID, tenant ID, and client secret. The application callback is:

```text
/api/auth/callback
```

The exact public origin is environment-dependent and must match the Entra app
registration.

### 4.3 Microsoft Dataverse Web API

The project uses API version `v9.2` and obtains an app-only token with the
client-credentials flow. The token request uses:

```text
scope={DATAVERSE_URL}/.default
```

Outbound Dataverse operations implemented in
`artifacts/api-server/src/lib/dataverse.ts` are:

| HTTP operation | Dataverse path | Used for |
|---|---|---|
| `GET` | `/api/data/v9.2/msdyn_workorders?$filter=...` | Backfill work orders by `msdyn_name` |
| `GET` | `/api/data/v9.2/bookableresourcebookings?$filter=...` | Backfill bookings for work orders |
| `PATCH` | `/api/data/v9.2/bookableresourcebookings({bookingId})` | Directly update start time, end time, and/or resource |
| `POST` | `/api/data/v9.2/bookableresourcebookings` | Create a booking bound to a work order and optionally a resource |

Common headers include `Authorization: Bearer {token}`,
`OData-MaxVersion: 4.0`, `OData-Version: 4.0`, and
`Accept: application/json`. Booking writes use `If-Match: *`.

Dataverse binding fields used by this project:

```json
{
  "starttime": "2026-08-06T09:00:00.000Z",
  "endtime": "2026-08-06T10:30:00.000Z",
  "Resource@odata.bind": "/bookableresources({resourceId})",
  "msdyn_WorkOrder@odata.bind": "/msdyn_workorders({workOrderId})"
}
```

Only non-empty patch fields are sent for an existing booking. New bookings
require both start and end times.

## 5. Database and mirror interfaces

These are not HTTP APIs, but they are important integration boundaries in the
project.

### Field Service database

The original dashboard routes query tables including:

- `technicians`
- `work_orders`
- `bookings`
- `customers`
- `contact`
- `equipment`
- `work_order_products`
- `work_order_services`
- `regions`

### Local application database

The API uses the local PostgreSQL database for:

- Express `sessions`
- `booking_writebacks`
- `placeholder_jobs`
- `schedule_blocks`

### CRM mirror database

The `/wb/*` routes query the `crm` schema, including:

- `workorder`
- `booking`
- `bookableresource`
- `systemuser`
- `territory`
- `msdyn_resourceterritory`
- `account`
- `contact`
- `cf_servicelocation`
- `cf_workordercustomerequipment`
- `booking_notes`
- `placeholder_jobs`
- `schedule_blocks`

The mirror stores raw Dataverse payloads in `raw_json` for formatted-value
lookups and parity handling.

## 6. Contract source files and maintenance

When changing an endpoint, update the implementation and the contract
documentation together.

| Source | Contents |
|---|---|
| `artifacts/api-server/src/routes/*.ts` | Runtime route and validation behavior |
| `artifacts/api-server/src/lib/dataverse.ts` | Outbound Dataverse contract |
| `artifacts/api-server/src/routes/auth.ts` | Admin Console authorization contract |
| `lib/api-spec/openapi.yaml` | OpenAPI contract used for generated API types/hooks |
| `docs/api-reference.md` | Human-readable cross-system reference (this document) |

The OpenAPI file is the machine-readable contract for the routes represented
there. This document also lists operational/admin/reporting routes that may be
newer or more implementation-specific than the generated client contract.

## 7. Implementation caveats

- The API server is mounted under `/api`; do not use a bare `/auth/callback` or
  `/healthz` URL from the browser.
- Session cookies are required for internal API calls; these are not bearer-token
  endpoints for third-party clients.
- The API server never exposes Dataverse client secrets or the Admin Console API
  key to the browser.
- A CRM mirror outage returns a retryable `503` for most `/wb/*` routes.
- Queued write-backs are overlays in the Write Back UI until synchronization
  completes; they are not authoritative Dynamics records.
- The CRM mirror and local source tables can be reconciled with the admin mirror
  endpoints, but those endpoints should not be used as a replacement for the
  upstream Dynamics synchronization pipeline.