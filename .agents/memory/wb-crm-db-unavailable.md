---
name: /wb/* CRM-DB-unavailable handling
description: How the api-server /wb/* routes distinguish a CRM-database outage from a real 500, and why mixed handlers are scoped.
---

# /wb/* CRM database unavailability → 503

The `/wb/*` routes read from the d365crm Neon Postgres via `getCrmPool()`. When that
Neon compute endpoint is disabled/suspended, pg surfaces `"The endpoint has been
disabled. Enable it using the API and retry."` (SQLSTATE `XX000`). Routes detect this
with `isCrmUnavailableError(err, includeConnectionCodes)` (crmDb.ts) and return **503
with body `{ error, code: "CRM_DB_UNAVAILABLE" }`** via `handleWbError(...)` in
writeback.ts, instead of an opaque 500. Frontends should branch on the `code`, not the
message text.

**Why:** a disabled/suspended endpoint is transient + retryable; a raw 500 hid that and
made the deployed schedule board look broken with no signal.

**How to apply:** new `/wb/*` handlers should wrap their catch in `handleWbError`. Pass
`source: "mixed"` for handlers that ALSO call the Dataverse HTTP API or the local
write-back DB (e.g. `/wb/sync`, `/wb/writebacks`, the booking POST/PATCH). Mixed handlers
only honor the unambiguous Neon "endpoint disabled" *messages*, NOT bare socket codes
(ECONNREFUSED/ETIMEDOUT/...), so a Dataverse/local outage isn't mislabeled as a CRM-DB
outage. Pure CRM-read handlers use the default `source: "crm"` (honors connection codes
too, since the only dependency is the CRM pool).

**Note:** the secret `D365CRM_DATABASE_URL` is correctly set; re-enabling the disabled
Neon endpoint is an operational fix on the database side, not a code/secret change.
