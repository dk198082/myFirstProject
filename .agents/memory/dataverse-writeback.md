---
name: Dynamics Dataverse write-back
description: How the api-server pushes staged booking edits to Dynamics, plus the credential/auth gotchas.
---

# Dataverse write-back (api-server)

Staged booking edits live in local Postgres `booking_writebacks` (status: queued → processing → synced/failed, plus an `error` column). `POST /api/wb/sync` claims rows atomically (`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` → `processing`) then PATCHes each to Dataverse. Claiming this way is required because there is no scheduler — sync is on-demand and can be triggered concurrently.

## Dataverse mapping
- PATCH `{DATAVERSE_URL}/api/data/v9.2/bookableresourcebookings({bookingId})`.
- Fields: `starttime`, `endtime` (ISO), and the resource lookup `Resource@odata.bind = /bookableresources({technician_id})`.
- `technician_id` in the field-service replica DB **is** the Dataverse bookableresource GUID, so it binds directly.
- Only non-null fields are sent (so staged edits never wipe required booking values). Unassigning a technician (null) is intentionally NOT pushed — Resource is required on a booking.
- Uses `If-Match: *` (unconditional overwrite) — intended for a write-back tool, but it can clobber edits made directly in Dynamics after queueing.

## OAuth (client credentials)
- Token: `POST https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token`, scope `{DATAVERSE_URL}/.default`.
- **Diagnostic:** a `404` from the token endpoint means `TENANT_ID` is malformed (e.g. it holds the Dataverse URL). A bad-but-well-formed tenant returns 400, not 404. We hit this twice because TENANT_ID and DATAVERSE_URL were entered swapped.

## Known gap
- The entire api-server has **no auth layer** — every endpoint, including the production-write `/wb/sync` and `PATCH /wb/bookings/:id`, is unauthenticated. Flag before exposing publicly.
