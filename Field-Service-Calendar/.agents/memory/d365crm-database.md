---
name: d365crm database (crm schema)
description: How the dynamics-write-back app reads from the external d365crm Postgres (crm.* tables), and the non-obvious data quirks.
---

# d365crm database (crm schema)

The `dynamics-write-back` app sources its work-order/booking reads from an external Postgres
named `d365crm` (schema `crm`), connected via `D365CRM_DATABASE_URL`. The shared
`technician-dashboard` still reads the FS Azure DB (`pool` in `lib/db.ts`); only the
`/wb/*` read routes use the crm pool (`lib/crmDb.ts`).

## Connection-string parsing quirk
**The d365crm password contains characters (`%`, `#`, `!`, `^`) that break URL percent-decoding.**
`new URL()` and pg's `connectionString` both fail (`#` truncates, `%` → invalid percent token).
**How to apply:** parse the connection string with a regex into discrete `{user,password,host,port,database}`
and pass those to `pg.Pool` — never pass the raw string as `connectionString`. See `crmDb.ts`.

## Lookup tables are sparse — names live in raw_json
crm.* tables mirror Dynamics; lookups are stored as raw uuids, and the **lookup tables
(crm.account, crm.bookableresource) do NOT always contain every id referenced** by
workorder/booking, so keep the raw_json FormattedValue fallbacks. (crm.bookableresource
is now populated — ~142 rows — but historically was empty; crm.account still has gaps.)
**Why:** the human-readable name is embedded in each row's `raw_json` jsonb under
`_<lookup>_value@OData.Community.Display.V1.FormattedValue` (e.g.
`_msdyn_serviceaccount_value@...FormattedValue` = customer name,
`_resource_value@...FormattedValue` = technician name).
**How to apply:** for any lookup name, `COALESCE(<lookuptable>.name, raw_json->>'_<x>_value@...FormattedValue')`.
For the `/wb/technicians` dropdown and tech-name resolution, UNION crm.bookableresource with
distinct `crm.booking.resource` + its formatted name so it stays usable while bookableresource is empty.

## Optionset (integer) status → display string
`crm.workorder.msdyn_systemstatus` is an integer optionset; the readable label
("Scheduled"/"Unscheduled"/"In Progress"/"Completed"/"Invoiced") is in
`raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue'`. The write-back UI
gates editability on status === "scheduled"/"unscheduled", so emit the formatted string, not the int.

## Table → entity mapping
crm.workorder=work order, crm.booking=bookableresourcebooking, crm.bookableresource=resource,
crm.account=account, crm.contact=contact, crm.transactioncurrency=currency.
Join keys: booking.msdyn_workorder = workorder.msdyn_workorderid; booking.resource = bookableresource.bookableresourceid;
workorder.msdyn_serviceaccount = account.accountid.

## Active-technician filter & id-column types
- **"Active in systemuser" = `crm.bookableresource.userid` → `crm.systemuser.systemuserid` with `su.isdisabled = false`** (and both rows `is_deleted=false`). bookableresource also has `useridname`. Resources with NULL userid are non-user resources (equipment/crew/pool) and have no systemuser.
- **All `*id` columns in the mirror are real `uuid`** — including `crm.cf_workordercustomerequipment.workorderid`. Do NOT `::text`-cast one side of a uuid join (e.g. `workorderid = wo.msdyn_workorderid::text` throws `operator does not exist: uuid = text`); compare uuid=uuid.
- **Why:** the schedule board (`/wb/schedule-board`) must only show active techs; filtering by `is_deleted` alone leaves disabled users on the board. Also guard queued write-back overlay reassignments (`booking_writebacks.technician_id`) against the active set, or an inactive resource re-surfaces via an overlay.
