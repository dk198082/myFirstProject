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
(crm.account, crm.bookableresource) do NOT reliably contain the ids referenced** by
workorder/booking. As of this writing crm.bookableresource was empty and
`workorder.msdyn_serviceaccount` matched 0 rows in crm.account.
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
