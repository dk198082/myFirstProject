import type pg from "pg";
import { getCrmPool, isCrmConfigured } from "./crmDb.js";
import { DataverseThrottleError, fetchBookingById, fetchModifiedEntities, fetchWorkOrderById, isDataverseConfigured } from "./dataverse.js";
import type { BookingPatch } from "./dataverse.js";
import { logger } from "./logger.js";

const INTERVAL_MS = 8_000;
const OVERLAP_MS = 10 * 60_000;
const FIRST_RUN_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const LOCK_ID = 92368413;
const ENTITIES = ["msdyn_workorders", "bookableresourcebookings"] as const;
let retryAt = 0;
type Entity = typeof ENTITIES[number];
type Row = Record<string, unknown>;

export function windowStart(checkpoint: Date | null, now: Date): string {
  return new Date((checkpoint?.getTime() ?? now.getTime() - FIRST_RUN_LOOKBACK_MS) - OVERLAP_MS).toISOString();
}

function value(row: Row, key: string): string | null {
  return typeof row[key] === "string" ? row[key] as string : null;
}

function timestamp(row: Row, key: string): string | null {
  return value(row, key);
}

async function workOrder(client: pg.PoolClient, row: Row): Promise<void> {
  const id = value(row, "msdyn_workorderid");
  if (!id) throw new Error("Dataverse work order has no ID");
  // PoolClient owns a single connection; do not issue concurrent queries on it.
  const territory = await client.query("SELECT EXISTS(SELECT 1 FROM crm.territory WHERE territoryid = $1::uuid) AS found", [value(row, "_msdyn_serviceterritory_value")]);
  const account = await client.query("SELECT EXISTS(SELECT 1 FROM crm.account WHERE accountid = $1::uuid) AS found", [value(row, "_msdyn_serviceaccount_value")]);
  const location = await client.query("SELECT EXISTS(SELECT 1 FROM crm.cf_servicelocation WHERE cf_servicelocationid = $1::uuid) AS found", [value(row, "_cf_servicelocation_value")]);
  await client.query(
    `INSERT INTO crm.workorder (
       msdyn_workorderid, msdyn_name, msdyn_systemstatus,
       msdyn_serviceterritory, msdyn_serviceaccount, cf_servicelocation,
       msdyn_workordertype, msdyn_city, msdyn_stateorprovince,
       new_customerrequirement, ownerid, createdon, modifiedon,
       is_deleted, synced_on, raw_json
     ) VALUES (
       $1::uuid, $2, $3, $4::uuid, $5::uuid, $6::uuid,
       $7::uuid, $8, $9, $10, $11::uuid, $12::timestamptz, $13::timestamptz,
       false, now(), $14::jsonb
     ) ON CONFLICT (msdyn_workorderid) DO UPDATE SET
       msdyn_name = EXCLUDED.msdyn_name, msdyn_systemstatus = EXCLUDED.msdyn_systemstatus,
       msdyn_serviceterritory = EXCLUDED.msdyn_serviceterritory,
       msdyn_serviceaccount = EXCLUDED.msdyn_serviceaccount,
       cf_servicelocation = EXCLUDED.cf_servicelocation,
       msdyn_workordertype = EXCLUDED.msdyn_workordertype,
       msdyn_city = EXCLUDED.msdyn_city, msdyn_stateorprovince = EXCLUDED.msdyn_stateorprovince,
       new_customerrequirement = EXCLUDED.new_customerrequirement, ownerid = EXCLUDED.ownerid,
       modifiedon = EXCLUDED.modifiedon, is_deleted = false,
       synced_on = now(), raw_json = EXCLUDED.raw_json
     WHERE crm.workorder.modifiedon IS NULL OR crm.workorder.modifiedon < EXCLUDED.modifiedon`,
    [
      id, value(row, "msdyn_name"), row["msdyn_systemstatus"] ?? null,
      territory.rows[0]?.found ? value(row, "_msdyn_serviceterritory_value") : null,
      account.rows[0]?.found ? value(row, "_msdyn_serviceaccount_value") : null,
      location.rows[0]?.found ? value(row, "_cf_servicelocation_value") : null,
      value(row, "_msdyn_workordertype_value"), value(row, "msdyn_city"),
      value(row, "msdyn_stateorprovince"), value(row, "new_customerrequirement"),
      value(row, "_ownerid_value"), timestamp(row, "createdon"), timestamp(row, "modifiedon"),
      JSON.stringify(row),
    ],
  );
}

async function booking(client: pg.PoolClient, row: Row, allowEqualModifiedOn = false): Promise<void> {
  const id = value(row, "bookableresourcebookingid");
  if (!id) throw new Error("Dataverse booking has no ID");
  const wo = value(row, "_msdyn_workorder_value");
  if (wo) {
    const found = await client.query("SELECT 1 FROM crm.workorder WHERE msdyn_workorderid = $1::uuid", [wo]);
    if (found.rowCount === 0) await workOrder(client, await fetchWorkOrderById(wo));
  }
  const resource = await client.query("SELECT EXISTS(SELECT 1 FROM crm.bookableresource WHERE bookableresourceid = $1::uuid) AS found", [value(row, "_resource_value")]);
  const status = await client.query("SELECT EXISTS(SELECT 1 FROM crm.bookingstatus WHERE bookingstatusid = $1::uuid) AS found", [value(row, "_bookingstatus_value")]);
  if (value(row, "_resource_value") && !resource.rows[0]?.found) {
    throw new Error(`Missing mirror resource for booking ${id}`);
  }
  await client.query(
    `INSERT INTO crm.booking (
       bookableresourcebookingid, name, starttime, endtime, duration, resource, bookingstatus, msdyn_workorder,
       msdyn_actualarrivaltime, msdyn_actualtravelduration, msdyn_estimatedtravelduration,
       cf_actualarrivaltime, cf_endtime, cf_durationschedule, cf_duration, cf_fieldnotes, cf_internalfieldnotes,
       createdon, modifiedon, is_deleted, synced_on, raw_json
     ) VALUES (
       $1::uuid, $2, $3::timestamptz, $4::timestamptz, $5, $6::uuid, $7::uuid, $8::uuid,
       $9::timestamptz, $10, $11, $12, $13, $14, $15, $16, $17,
       $18::timestamptz, $19::timestamptz, false, now(), $20::jsonb
     ) ON CONFLICT (bookableresourcebookingid) DO UPDATE SET
       name = EXCLUDED.name, starttime = EXCLUDED.starttime, endtime = EXCLUDED.endtime,
       duration = EXCLUDED.duration, resource = EXCLUDED.resource, bookingstatus = EXCLUDED.bookingstatus,
       msdyn_workorder = EXCLUDED.msdyn_workorder,
       msdyn_actualarrivaltime = EXCLUDED.msdyn_actualarrivaltime,
       msdyn_actualtravelduration = EXCLUDED.msdyn_actualtravelduration,
       msdyn_estimatedtravelduration = EXCLUDED.msdyn_estimatedtravelduration,
       cf_actualarrivaltime = EXCLUDED.cf_actualarrivaltime, cf_endtime = EXCLUDED.cf_endtime,
       cf_durationschedule = EXCLUDED.cf_durationschedule, cf_duration = EXCLUDED.cf_duration,
       cf_fieldnotes = EXCLUDED.cf_fieldnotes, cf_internalfieldnotes = EXCLUDED.cf_internalfieldnotes,
       modifiedon = EXCLUDED.modifiedon, is_deleted = false, synced_on = now(), raw_json = EXCLUDED.raw_json
      WHERE crm.booking.modifiedon IS NULL OR crm.booking.modifiedon < EXCLUDED.modifiedon
         OR ($21::boolean AND crm.booking.modifiedon = EXCLUDED.modifiedon)`,
    [
      id, value(row, "name"), timestamp(row, "starttime"), timestamp(row, "endtime"), row["duration"] ?? null,
      resource.rows[0]?.found ? value(row, "_resource_value") : null,
      status.rows[0]?.found ? value(row, "_bookingstatus_value") : null, wo,
      timestamp(row, "msdyn_actualarrivaltime"), row["msdyn_actualtravelduration"] ?? null,
      row["msdyn_estimatedtravelduration"] ?? null, value(row, "cf_actualarrivaltime"),
      value(row, "cf_endtime"), row["cf_durationschedule"] ?? null, row["cf_duration"] ?? null,
      value(row, "cf_fieldnotes"), value(row, "cf_internalfieldnotes"),
      timestamp(row, "createdon"), timestamp(row, "modifiedon"), JSON.stringify(row),
      allowEqualModifiedOn,
    ],
  );
}

/** Read a confirmed save back from Dataverse and mirror it before the board refetches. */
export async function mirrorSavedBooking(bookingId: string, expected: BookingPatch): Promise<void> {
  const row = await fetchBookingById(bookingId);
  if (value(row, "bookableresourcebookingid")?.toLowerCase() !== bookingId.toLowerCase()) {
    throw new Error("Dataverse returned a different booking");
  }
  // A successful PATCH can precede a fresh GET. Do not mark an old read-back
  // as mirrored; let the caller report that the calendar refresh is pending.
  if ((expected.startTime && Date.parse(value(row, "starttime") ?? "") !== Date.parse(expected.startTime))
    || (expected.endTime && Date.parse(value(row, "endtime") ?? "") !== Date.parse(expected.endTime))
    || (expected.resourceId && value(row, "_resource_value")?.toLowerCase() !== expected.resourceId.toLowerCase())) {
    throw new Error("Dataverse read-back has not reflected the saved booking yet");
  }
  const client = await getCrmPool().connect();
  try {
    await client.query("BEGIN");
    await booking(client, row, true);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** One serialized cycle across API instances. Checkpoints only advance on a full successful fetch and commit. */
export async function ingestCrmChanges(): Promise<void> {
  let client: pg.PoolClient | null = null;
  let locked = false;
  let currentEntity: Entity | null = null;
  try {
    client = await getCrmPool().connect();
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_ID]);
    if (!lock.rows[0]?.locked) return;
    locked = true;
    const through = new Date(Date.now() - 2_000).toISOString();
    for (const entity of ENTITIES) {
      currentEntity = entity;
      await client.query(
        `INSERT INTO crm.calendar_ingest_state(entity, last_attempt)
         VALUES ($1, now()) ON CONFLICT(entity) DO UPDATE SET last_attempt = now()`,
        [entity],
      );
      const state = await client.query<{ checkpoint: Date | null }>(
        "SELECT checkpoint FROM crm.calendar_ingest_state WHERE entity = $1", [entity],
      );
      const from = windowStart(state.rows[0]?.checkpoint ?? null, new Date(through));
      const rows = await fetchModifiedEntities(entity, from, through);
      // A booking created for a pre-existing (but absent from the mirror) work
      // order needs its parent; fail visibly rather than silently losing it.
      await client.query("BEGIN");
      try {
        for (const row of rows) {
          if (entity === "msdyn_workorders") await workOrder(client, row);
          else await booking(client, row);
        }
        await client.query(
          `INSERT INTO crm.calendar_ingest_state (entity, checkpoint, last_success, row_count, last_error)
           VALUES ($1, $2::timestamptz, now(), $3, NULL)
           ON CONFLICT (entity) DO UPDATE SET checkpoint = EXCLUDED.checkpoint,
             last_success = now(), row_count = EXCLUDED.row_count, last_error = NULL`,
          [entity, through, rows.length],
        );
        await client.query("COMMIT");
        if (rows.length) logger.info({ entity, rows: rows.length, through }, "CRM ingestion succeeded");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof DataverseThrottleError) retryAt = Date.now() + error.retryAfterMs;
    logger.error({ err: error, entity: currentEntity }, "CRM ingestion failed; checkpoint unchanged for failed entity");
    try {
      if (currentEntity && client) await client.query(
        "UPDATE crm.calendar_ingest_state SET last_error = $2 WHERE entity = $1",
        [currentEntity, error instanceof Error ? error.message.slice(0, 500) : "Unknown error"],
      );
    } catch (stateError) {
      logger.error({ err: stateError }, "CRM ingestion failure could not be recorded");
    }
  } finally {
    if (locked && client) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch((err: unknown) => {
      logger.error({ err }, "Failed to release CRM ingestion lock");
    });
    client?.release();
  }
}

let lastTick = 0;
let activeTick: Promise<void> | null = null;

/** Called by board reads too: an autoscaled API may have slept between visits. */
export function refreshCrmIngestion(): Promise<void> {
  if (process.env.CRM_INGESTION_ENABLED !== "true" || !isCrmConfigured() || !isDataverseConfigured()) {
    return Promise.resolve();
  }
  if (activeTick) return activeTick;
  if (Date.now() < retryAt) return Promise.resolve();
  if (Date.now() - lastTick < INTERVAL_MS) return Promise.resolve();
  lastTick = Date.now();
  activeTick = ingestCrmChanges().finally(() => { activeTick = null; });
  return activeTick;
}

export function startCrmIngestion(): void {
  if (process.env.CRM_INGESTION_ENABLED !== "true") {
    logger.info("CRM ingestion disabled; set CRM_INGESTION_ENABLED=true on the deployed API server");
    return;
  }
  if (!isCrmConfigured() || !isDataverseConfigured()) {
    logger.error("CRM ingestion enabled but Dataverse or mirror configuration is missing");
    return;
  }
  void refreshCrmIngestion();
  setInterval(() => void refreshCrmIngestion(), INTERVAL_MS).unref();
}