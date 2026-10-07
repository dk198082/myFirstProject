# Calendar CRM ingestion

`crm-calendar-ingest-state.sql` creates the checkpoint table in the **external d365crm PostgreSQL mirror**, not the Replit app database. Apply it before enabling the API worker. The table was provisioned in the connected development mirror on September 23, 2026.

Set `CRM_INGESTION_ENABLED=true` for the API server's production environment and publish the API and calendar together. Development deliberately leaves the worker disabled to avoid running a second live writer. The API also starts a cycle when the schedule board is read, so an autoscaled process waking up for an active calendar does not depend on a previous timer.

Monitor `GET /api/wb/ingestion-status` with an authorized session. `healthy` requires both work orders and bookings to have a checkpoint at most 30 seconds behind and no recent error. The calendar shows a warning if ingestion is unhealthy or disabled.

```sql
SELECT entity, checkpoint, last_attempt, last_success, row_count, last_error
FROM crm.calendar_ingest_state ORDER BY entity;
```

The default initial scan covers the preceding seven days. Subsequent scans resume from the saved checkpoint with a ten-minute overlap; every complete page must succeed before the checkpoint advances. Upserts are guarded by source `modifiedon` and serialized with a PostgreSQL advisory lock. Throttling and outages leave the checkpoint unchanged and trigger retries; they can exceed the normal 20-second visibility target. Autoscaling does not run the timer while the API is asleep, but an active calendar read triggers a scan. A strict always-on background SLA requires an always-running deployment or separate scheduler. Hard-deleted Dataverse entities cannot be recovered from `modifiedon` polling alone.