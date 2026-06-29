import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { getCrmPool, isCrmConfigured, isCrmUnavailableError } from "../lib/crmDb.js";
import { localPool } from "../lib/localDb.js";
import { isDataverseConfigured, patchBooking, createBooking } from "../lib/dataverse.js";

// Shared error handler for /wb/* routes. When the failure is the CRM database
// being unreachable (e.g. a disabled/suspended Neon endpoint) we return 503 so
// the frontend can show a clear, retryable "temporarily unavailable" state
// instead of an opaque 500. Genuine errors still surface as 500.
//
// `source` distinguishes CRM-only handlers (where any connection-level failure
// is a CRM-DB outage) from "mixed" handlers that also call the Dataverse HTTP
// API or the local write-back DB. For mixed handlers we only honour the
// unambiguous Neon "endpoint disabled/suspended" messages, not bare socket
// codes, so a Dataverse/local outage isn't mislabeled as a CRM-DB outage.
function handleWbError(
  req: Request,
  res: Response,
  err: unknown,
  logMessage: string,
  errorMessage: string,
  opts: { logContext?: Record<string, unknown>; source?: "crm" | "mixed" } = {},
): void {
  const { logContext = {}, source = "crm" } = opts;
  if (isCrmUnavailableError(err, source === "crm")) {
    req.log.error({ ...logContext, err }, `${logMessage} (CRM database unavailable)`);
    res.status(503).json({
      error: "The CRM database is temporarily unavailable. Please try again in a moment.",
      code: "CRM_DB_UNAVAILABLE",
    });
    return;
  }
  req.log.error({ ...logContext, err }, logMessage);
  res.status(500).json({ error: errorMessage });
}

// Synthetic booking_id prefix for write-backs that schedule a brand-new booking
// for an unscheduled work order. There is no crm.booking row yet, but
// booking_writebacks.booking_id is NOT NULL, so we key these rows by
// `new:<workOrderId>`. The sync path detects this prefix and creates a booking
// in Dataverse instead of patching an existing one.
const NEW_BOOKING_PREFIX = "new:";

const isoOrNull = z
  .string()
  .refine((s: string) => !Number.isNaN(new Date(s).getTime()), { message: "Invalid ISO timestamp" })
  .nullable();

const bookingUpdateSchema = z
  .object({
    start_time: isoOrNull.optional(),
    end_time: isoOrNull.optional(),
    technician_id: z.string().min(1).nullable().optional(),
  })
  .refine(
    (v: { start_time?: string | null; end_time?: string | null; technician_id?: string | null }) =>
      v.start_time !== undefined || v.end_time !== undefined || v.technician_id !== undefined,
    { message: "At least one of start_time, end_time, or technician_id is required" },
  );

const router = Router();

type WritebackRow = {
  id: number;
  booking_id: string;
  work_order_id: string | null;
  start_time: Date | string | null;
  end_time: Date | string | null;
  technician_id: string | null;
  status: string;
  created_at: Date | string;
  synced_at: Date | string | null;
  error: string | null;
};

function toIso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function resolveTechNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const filtered = Array.from(new Set(ids.filter((v): v is string => !!v)));
  if (filtered.length === 0 || !isCrmConfigured()) return new Map();
  // Prefer the bookableresource name, but fall back to the formatted resource
  // name embedded in booking.raw_json so technicians still resolve while the
  // crm.bookableresource table is sparse/empty.
  const r = await getCrmPool().query(
    `SELECT DISTINCT ON (technician_id) technician_id, resource_name
     FROM (
       SELECT bookableresourceid::text AS technician_id, name AS resource_name, 0 AS pri
       FROM crm.bookableresource
       WHERE bookableresourceid::text = ANY($1::text[])
       UNION ALL
       SELECT DISTINCT resource::text AS technician_id,
              raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue' AS resource_name,
              1 AS pri
       FROM crm.booking
       WHERE resource::text = ANY($1::text[])
     ) u
     WHERE resource_name IS NOT NULL
     ORDER BY technician_id, pri`,
    [filtered],
  );
  const m = new Map<string, string>();
  for (const row of r.rows) {
    if (row.resource_name) m.set(row.technician_id, row.resource_name);
  }
  return m;
}

function shapeWriteback(
  row: WritebackRow,
  techNames: Map<string, string>,
) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    work_order_id: row.work_order_id,
    start_time: toIso(row.start_time),
    end_time: toIso(row.end_time),
    technician_id: row.technician_id,
    technician_name: row.technician_id ? techNames.get(row.technician_id) ?? null : null,
    status: row.status,
    created_at: toIso(row.created_at) ?? "",
    synced_at: toIso(row.synced_at),
    error: row.error ?? null,
  };
}

router.get("/wb/work-orders", async (req, res) => {
  const search = ((req.query.search as string | undefined) ?? "").trim();
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;

  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    const params: unknown[] = [];
    let whereSearch = "";
    if (search) {
      params.push(`%${search}%`);
      whereSearch = `AND (wo.msdyn_name ILIKE $${params.length}
                          OR COALESCE(wo.new_customerrequirement, wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue') ILIKE $${params.length}
                          OR COALESCE(a.name, wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue') ILIKE $${params.length})`;
    }
    params.push(limit);

    const r = await getCrmPool().query(
      `
      SELECT
        wo.msdyn_workorderid::text AS work_order_id,
        wo.msdyn_name AS work_order_number,
        COALESCE(
          wo.new_customerrequirement,
          wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue'
        ) AS title,
        wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' AS system_status,
        COALESCE(
          a.name,
          wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
        ) AS customer_name,
        b.booking_id,
        b.booking_status,
        b.start_time,
        b.end_time,
        b.technician_id,
        COALESCE(br.name, b.resource_name) AS technician_name
      FROM crm.workorder wo
      LEFT JOIN crm.account a ON a.accountid = wo.msdyn_serviceaccount
      LEFT JOIN LATERAL (
        SELECT
          bookableresourcebookingid::text AS booking_id,
          bookingstatus::text AS booking_status,
          starttime AS start_time,
          endtime AS end_time,
          resource::text AS technician_id,
          raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue' AS resource_name
        FROM crm.booking
        WHERE msdyn_workorder = wo.msdyn_workorderid AND COALESCE(is_deleted, false) = false
        ORDER BY starttime ASC NULLS LAST
        LIMIT 1
      ) b ON true
      LEFT JOIN crm.bookableresource br ON br.bookableresourceid::text = b.technician_id
      WHERE COALESCE(wo.is_deleted, false) = false ${whereSearch}
      ORDER BY b.start_time DESC NULLS LAST, wo.msdyn_name ASC NULLS LAST
      LIMIT $${params.length}
      `,
      params,
    );

    const bookingIds = r.rows.map((row) => row.booking_id).filter((v): v is string => !!v);
    let pendingByBooking = new Map<string, WritebackRow>();
    if (bookingIds.length > 0) {
      const pending = await localPool.query<WritebackRow>(
        `
        SELECT DISTINCT ON (booking_id)
               id, booking_id, work_order_id, start_time, end_time, technician_id, status, created_at, synced_at, error
        FROM booking_writebacks
        WHERE booking_id = ANY($1::text[]) AND status = 'queued'
        ORDER BY booking_id, created_at DESC
        `,
        [bookingIds],
      );
      pendingByBooking = new Map(pending.rows.map((p) => [p.booking_id, p]));
    }

    const techIds = [
      ...r.rows.map((row) => row.technician_id as string | null),
      ...Array.from(pendingByBooking.values()).map((p) => p.technician_id),
    ];
    const techNames = await resolveTechNames(techIds);

    const out = r.rows.map((row) => {
      const pending = row.booking_id ? pendingByBooking.get(row.booking_id) ?? null : null;
      return {
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        title: row.title,
        system_status: row.system_status,
        customer_name: row.customer_name,
        booking_id: row.booking_id,
        booking_status: row.booking_status,
        start_time: toIso(row.start_time),
        end_time: toIso(row.end_time),
        technician_id: row.technician_id,
        technician_name: row.technician_id
          ? techNames.get(row.technician_id) ?? row.technician_name ?? null
          : row.technician_name ?? null,
        pending_writeback: pending ? shapeWriteback(pending, techNames) : null,
      };
    });

    res.json(out);
  } catch (err) {
    handleWbError(req, res, err, "Failed to list write-back work orders", "Failed to list work orders");
  }
});

router.patch("/wb/bookings/:bookingId", async (req, res) => {
  const { bookingId } = req.params;
  const parsed = bookingUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    const existing = await getCrmPool().query<{ booking_id: string; work_order_id: string | null }>(
      `SELECT bookableresourcebookingid::text AS booking_id,
              msdyn_workorder::text AS work_order_id
       FROM crm.booking WHERE bookableresourcebookingid = $1 LIMIT 1`,
      [bookingId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    const workOrderId = existing.rows[0].work_order_id;

    const insert = await localPool.query<WritebackRow>(
      `INSERT INTO booking_writebacks
        (booking_id, work_order_id, start_time, end_time, technician_id, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       RETURNING id, booking_id, work_order_id, start_time, end_time, technician_id, status, created_at, synced_at, error`,
      [
        bookingId,
        workOrderId,
        body.start_time ?? null,
        body.end_time ?? null,
        body.technician_id ?? null,
      ],
    );

    const row = insert.rows[0];
    const techNames = await resolveTechNames([row.technician_id]);
    res.json(shapeWriteback(row, techNames));
  } catch (err) {
    handleWbError(req, res, err, "Failed to queue booking write-back", "Failed to queue write-back", {
      logContext: { bookingId },
      source: "mixed",
    });
  }
});

router.post("/wb/work-orders/:workOrderId/booking", async (req, res) => {
  const { workOrderId } = req.params;
  const parsed = bookingUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    const existing = await getCrmPool().query<{ work_order_id: string }>(
      `SELECT msdyn_workorderid::text AS work_order_id
       FROM crm.workorder
       WHERE msdyn_workorderid = $1 AND COALESCE(is_deleted, false) = false
       LIMIT 1`,
      [workOrderId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Work order not found" });
      return;
    }

    const insert = await localPool.query<WritebackRow>(
      `INSERT INTO booking_writebacks
        (booking_id, work_order_id, start_time, end_time, technician_id, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       RETURNING id, booking_id, work_order_id, start_time, end_time, technician_id, status, created_at, synced_at, error`,
      [
        `${NEW_BOOKING_PREFIX}${workOrderId}`,
        workOrderId,
        body.start_time ?? null,
        body.end_time ?? null,
        body.technician_id ?? null,
      ],
    );

    const row = insert.rows[0];
    const techNames = await resolveTechNames([row.technician_id]);
    res.json(shapeWriteback(row, techNames));
  } catch (err) {
    handleWbError(req, res, err, "Failed to queue new-booking write-back", "Failed to queue write-back", {
      logContext: { workOrderId },
      source: "mixed",
    });
  }
});

// View-only detail for a single d365crm work order. Mirrors the FS-backed
// GET /work-orders/:id response (WorkOrderDetail schema) but sourced from the
// crm.* mirror so the dynamics-write-back app can show details for its own jobs.
// Note: the crm mirror has no work-order product/service line tables, so those
// arrays are always empty (the page renders them conditionally).
router.get("/wb/work-orders/:workOrderId/detail", async (req, res) => {
  const { workOrderId } = req.params;

  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  const FV = "@OData.Community.Display.V1.FormattedValue";

  try {
    const woRes = await getCrmPool().query(
      `SELECT
         wo.msdyn_workorderid::text AS work_order_id,
         wo.msdyn_name              AS work_order_number,
         wo.raw_json->>'_msdyn_workordertype_value${FV}' AS work_order_type,
         wo.raw_json->>'msdyn_systemstatus${FV}'         AS system_status,
         wo.raw_json->>'_msdyn_substatus_value${FV}' AS sub_status_raw,
         wo.raw_json->>'_cf_servicelocation_value${FV}'  AS servicelocation,
         wo.raw_json->>'_msdyn_pricelist_value${FV}'     AS pricelistname,
         wo.raw_json->>'_cf_project_value${FV}'          AS cf_projectname,
         wo.cf_ponumber             AS cf_ponumber,
         wo.cf_axserviceorderid     AS cf_axserviceorderid,
         wo.msdyn_address1          AS msdyn_address1,
         wo.msdyn_addressname       AS msdyn_addressname,
         wo.msdyn_city              AS city,
         wo.msdyn_stateorprovince   AS state,
         wo.msdyn_country           AS country,
         wo.msdyn_postalcode        AS postalcode,
         wo.createdon               AS created_on,
         wo.modifiedon              AS modified_on,
         wo.msdyn_serviceaccount    AS account_id,
         wo.cf_contactperson        AS contact_id
       FROM crm.workorder wo
       WHERE wo.msdyn_workorderid = $1 AND COALESCE(wo.is_deleted, false) = false
       LIMIT 1`,
      [workOrderId],
    );
    const wo = woRes.rows[0];
    if (!wo) {
      res.status(404).json({ error: "Work order not found" });
      return;
    }

    const [accountRes, contactRes, bookingRes, equipmentRes] = await Promise.all([
      wo.account_id
        ? getCrmPool().query(
            `SELECT accountid::text AS customer_id, name AS customer_name,
                    emailaddress1 AS email, telephone1 AS phone,
                    address1_line1 AS address, address1_city AS city,
                    address1_stateorprovince AS state, address1_country AS country,
                    address1_postalcode AS postal_code
             FROM crm.account WHERE accountid = $1 LIMIT 1`,
            [wo.account_id],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      wo.contact_id
        ? getCrmPool().query(
            `SELECT contactid::text AS contact_id, fullname, firstname, lastname,
                    emailaddress1 AS email, telephone1 AS businessphone,
                    mobilephone, NULL::text AS homephone, NULL::text AS street1,
                    NULL::text AS city, NULL::text AS state, NULL::text AS country
             FROM crm.contact WHERE contactid = $1 LIMIT 1`,
            [wo.contact_id],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      getCrmPool().query(
        `SELECT
           bookableresourcebookingid::text AS booking_id,
           raw_json->>'_bookingstatus_value${FV}' AS booking_status,
           starttime AS start_time,
           endtime AS end_time,
           msdyn_actualarrivaltime AS actual_arrival_time,
           raw_json->>'msdyn_estimatedarrivaltime' AS estimated_arrival_time,
           NULL::timestamptz AS actual_start_time,
           NULL::timestamptz AS actual_end_time,
           CASE WHEN starttime IS NOT NULL AND endtime IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (endtime - starttime)) / 60)::int
                ELSE NULLIF(duration, 0)::int END AS duration_minutes,
           resource::text AS technician_id,
           modifiedon AS modifiedon
         FROM crm.booking
         WHERE msdyn_workorder = $1 AND COALESCE(is_deleted, false) = false
         ORDER BY starttime ASC NULLS LAST
         LIMIT 1`,
        [workOrderId],
      ),
      getCrmPool().query(
        `SELECT
           cf_workordercustomerequipmentid::text AS equipmentid,
           cf_name AS name,
           cf_serialnumber AS serialnumber,
           cf_lastcalibrationdate AS lastcalibrationdate,
           cf_nextcalibrationdate AS nextcalibrationdate,
           cf_calibrationdate AS calibrationdate,
           NULL::int AS calinterval,
           NULL::text AS machinecapacity
         FROM crm.cf_workordercustomerequipment
         WHERE workorderid = $1 AND COALESCE(is_deleted, false) = false
         ORDER BY cf_nextcalibrationdate ASC NULLS LAST`,
        [workOrderId],
      ),
    ]);

    const toDateOnly = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null);
    const toIso = (v: unknown) =>
      v instanceof Date ? v.toISOString() : (v ?? null);

    const equipment = equipmentRes.rows.map((e) => ({
      ...e,
      lastcalibrationdate: toDateOnly(e.lastcalibrationdate),
      nextcalibrationdate: toDateOnly(e.nextcalibrationdate),
      calibrationdate: toDateOnly(e.calibrationdate),
    }));

    const serviceaddress =
      [wo.msdyn_addressname, wo.msdyn_address1, wo.city, wo.state, wo.postalcode, wo.country]
        .filter((s) => s != null && String(s).trim() !== "")
        .join(", ") || null;

    const booking = bookingRes.rows[0] ?? null;
    if (booking) {
      booking.start_time = toIso(booking.start_time);
      booking.end_time = toIso(booking.end_time);
      booking.actual_arrival_time = toIso(booking.actual_arrival_time);
      booking.actual_start_time = toIso(booking.actual_start_time);
      booking.actual_end_time = toIso(booking.actual_end_time);
      booking.modifiedon = toIso(booking.modifiedon);
    }

    res.json({
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      title: wo.work_order_type,
      description: null,
      service_address: wo.msdyn_address1 ?? null,
      serviceaddress,
      priority: null,
      system_status: wo.system_status,
      sub_status: wo.sub_status_raw,
      incident_type: null,
      servicelocation: wo.servicelocation,
      pricelistname: wo.pricelistname,
      cf_projectname: wo.cf_projectname,
      cf_ponumber: wo.cf_ponumber,
      cf_axserviceorderid: wo.cf_axserviceorderid,
      servicetype: wo.work_order_type,
      created_on: toIso(wo.created_on),
      modified_on: toIso(wo.modified_on),
      customer: accountRes.rows[0] ?? null,
      contact: contactRes.rows[0] ?? null,
      booking,
      products: [],
      services: [],
      equipment,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to get d365crm work order detail", "Failed to get work order detail", {
      logContext: { workOrderId },
    });
  }
});

router.get("/wb/writebacks", async (req, res) => {
  try {
    const r = await localPool.query<WritebackRow>(
      `SELECT id, booking_id, work_order_id, start_time, end_time, technician_id, status, created_at, synced_at, error
       FROM booking_writebacks
       ORDER BY created_at DESC
       LIMIT 200`,
    );
    const techNames = await resolveTechNames(r.rows.map((row) => row.technician_id));
    res.json(r.rows.map((row) => shapeWriteback(row, techNames)));
  } catch (err) {
    handleWbError(req, res, err, "Failed to list write-backs", "Failed to list write-backs", { source: "mixed" });
  }
});

router.get("/wb/technicians", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  try {
    // Source from crm.bookableresource, but also include resources referenced by
    // bookings (with their formatted name from raw_json) so the reassign dropdown
    // remains usable while crm.bookableresource is sparse/empty.
    const r = await getCrmPool().query<{ technician_id: string; resource_name: string | null }>(
      `SELECT technician_id, resource_name
       FROM (
         SELECT DISTINCT ON (technician_id) technician_id, resource_name
         FROM (
           SELECT bookableresourceid::text AS technician_id, name AS resource_name, 0 AS pri
           FROM crm.bookableresource
           WHERE COALESCE(is_deleted, false) = false
           UNION ALL
           SELECT DISTINCT resource::text AS technician_id,
                  raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue' AS resource_name,
                  1 AS pri
           FROM crm.booking
           WHERE resource IS NOT NULL AND COALESCE(is_deleted, false) = false
         ) u
         WHERE technician_id IS NOT NULL
         ORDER BY technician_id, pri
       ) d
       ORDER BY resource_name ASC NULLS LAST`,
    );
    res.json(r.rows);
  } catch (err) {
    handleWbError(req, res, err, "Failed to list write-back technicians", "Failed to list technicians");
  }
});

function tsParts(v: Date | string | null | undefined): {
  date: string | null;
  time: string | null;
  iso: string | null;
} {
  if (v == null) return { date: null, time: null, iso: null };
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return { date: null, time: null, iso: null };
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19), iso };
}

function slugifyLocation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

router.get("/wb/schedule-board", async (req, res) => {
  const viewRaw = (req.query.view as string | undefined) ?? "week";
  const view: "week" | "month" = viewRaw === "month" ? "month" : "week";

  const groupByRaw = (req.query.groupBy as string | undefined) ?? "tech-region";
  const groupBy: "tech-region" | "service-location" =
    groupByRaw === "service-location" ? "service-location" : "tech-region";

  const startRaw = ((req.query.start as string | undefined) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    res.status(400).json({ error: "start query param required (YYYY-MM-DD)" });
    return;
  }

  const seed = new Date(startRaw + "T00:00:00Z");
  let start: Date;
  let endDate: Date;
  if (view === "month") {
    start = new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth(), 1));
    endDate = new Date(Date.UTC(seed.getUTCFullYear(), seed.getUTCMonth() + 1, 1));
  } else {
    start = seed;
    endDate = new Date(start);
    endDate.setUTCDate(endDate.getUTCDate() + 7);
  }
  const rangeStart = start.toISOString().slice(0, 10);
  const rangeEnd = endDate.toISOString().slice(0, 10);
  const dayCount = Math.round((endDate.getTime() - start.getTime()) / 86_400_000);

  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    // Set of bookable resources linked to an enabled (active) system user. The SQL
    // queries below already filter base rows to these, but a queued write-back can
    // reassign a booking to another resource — guard those overlay reassignments so
    // an inactive/non-user resource can never re-surface on the board.
    const activeResResult = await getCrmPool().query<{ bookableresourceid: string }>(
      `
      SELECT br.bookableresourceid::text AS bookableresourceid
      FROM crm.bookableresource br
      JOIN crm.systemuser su ON su.systemuserid = br.userid
      WHERE COALESCE(br.is_deleted, false) = false
        AND COALESCE(su.is_deleted, false) = false
        AND COALESCE(su.isdisabled, false) = false
      `,
    );
    const activeResourceIds = new Set(activeResResult.rows.map((r) => r.bookableresourceid));

    // ── Service-location mode ─────────────────────────────────────────────────
    // Group by work order state/city rather than territory. Each technician can
    // appear in multiple location groups (one per distinct location of their jobs).
    // Idle-tech rows are omitted — location groups are derived from actual bookings.
    if (groupBy === "service-location") {
      const locResult = await getCrmPool().query(
        `
        WITH active_res AS (
          -- Only bookable resources linked to an enabled (active) system user.
          SELECT br.bookableresourceid
          FROM crm.bookableresource br
          JOIN crm.systemuser su ON su.systemuserid = br.userid
          WHERE COALESCE(br.is_deleted, false) = false
            AND COALESCE(su.is_deleted, false) = false
            AND COALESCE(su.isdisabled, false) = false
        )
        SELECT
          b.bookableresourcebookingid AS booking_id,
          b.resource                  AS resource_id,
          b.starttime                 AS start_time,
          b.endtime                   AS end_time,
          b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue' AS booking_status,
          wo.msdyn_workorderid::text  AS work_order_id,
          wo.msdyn_name               AS work_order_number,
          COALESCE(
            wo.new_customerrequirement,
            wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue'
          )                           AS title,
          wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' AS system_status,
          wo.msdyn_city               AS city,
          wo.msdyn_stateorprovince    AS state,
          COALESCE(
            acc.name,
            wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
          )                           AS customer_name,
          COALESCE(br.name, b.raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue') AS resource_name,
          br.msdyn_primaryemail       AS user_email,
          eq.equipment_names
        FROM crm.booking b
        LEFT JOIN crm.workorder wo ON wo.msdyn_workorderid = b.msdyn_workorder
        LEFT JOIN crm.account acc ON acc.accountid = wo.msdyn_serviceaccount
        LEFT JOIN crm.bookableresource br
          ON br.bookableresourceid = b.resource
         AND COALESCE(br.is_deleted, false) = false
        LEFT JOIN LATERAL (
          SELECT array_agg(woce.label ORDER BY woce.cf_name ASC) AS equipment_names
          FROM (
            SELECT
              cf_name,
              cf_name
                || CASE
                     WHEN NULLIF(BTRIM(cf_serialnumber), '') IS NOT NULL
                     THEN ' / ' || BTRIM(cf_serialnumber)
                     ELSE ''
                   END AS label
            FROM crm.cf_workordercustomerequipment
            WHERE workorderid = wo.msdyn_workorderid
              AND COALESCE(is_deleted, false) = false
              AND cf_name IS NOT NULL
            ORDER BY cf_name ASC
            LIMIT 5
          ) woce
        ) eq ON true
        WHERE b.starttime >= $1::date
          AND b.starttime <  $2::date
          AND COALESCE(b.is_deleted, false) = false
          AND b.resource IN (SELECT bookableresourceid FROM active_res)
        ORDER BY
          COALESCE(NULLIF(BTRIM(wo.msdyn_stateorprovince), ''), NULLIF(BTRIM(wo.msdyn_city), ''), 'Unknown Location') ASC,
          resource_name ASC,
          b.starttime ASC NULLS LAST
        `,
        [rangeStart, rangeEnd],
      );

      // Collect queued write-back overlays for the returned booking ids
      const locBookingIds = locResult.rows
        .map((r) => r.booking_id as string | null)
        .filter((v): v is string => !!v);
      const locOverlayByBooking = new Map<
        string,
        { start_time: Date | string | null; end_time: Date | string | null; technician_id: string | null }
      >();
      if (locBookingIds.length > 0) {
        const queued = await localPool.query<{
          booking_id: string;
          start_time: Date | string | null;
          end_time: Date | string | null;
          technician_id: string | null;
        }>(
          `
          SELECT DISTINCT ON (booking_id)
                 booking_id, start_time, end_time, technician_id
          FROM booking_writebacks
          WHERE booking_id = ANY($1::text[]) AND status = 'queued'
          ORDER BY booking_id, created_at DESC
          `,
          [locBookingIds],
        );
        for (const q of queued.rows) {
          locOverlayByBooking.set(q.booking_id, {
            start_time: q.start_time,
            end_time: q.end_time,
            technician_id: q.technician_id,
          });
        }
      }

      type LocTechRow = { technician_id: string; resource_name: string | null; user_email: string | null; jobs: unknown[] };
      type LocRegionRow = { regionid_id: string; region: string; company: null; technicians: Map<string, LocTechRow> };

      // Key: locationId + "|" + technicianId so same tech in two locations gets two entries
      const locMap = new Map<string, LocRegionRow>();
      const rangeStartMs = start.getTime();
      const maxDayIndex = dayCount - 1;

      for (const row of locResult.rows) {
        if (!row.booking_id || !row.start_time) continue;

        const overlay = locOverlayByBooking.get(row.booking_id as string);
        const effStart = overlay?.start_time ?? row.start_time;
        const effEnd = overlay?.end_time ?? row.end_time;

        const stateVal = row.state != null && String(row.state).trim() !== "" ? String(row.state).trim() : null;
        const cityVal = row.city != null && String(row.city).trim() !== "" ? String(row.city).trim() : null;
        const locationLabel = stateVal ?? cityVal ?? "Unknown Location";
        const locationId = slugifyLocation(locationLabel);

        // Only honor an overlay reassignment to an active resource; otherwise keep
        // the booking on its original (already active-filtered) resource.
        const overlayTechId =
          overlay?.technician_id && activeResourceIds.has(overlay.technician_id)
            ? overlay.technician_id
            : null;
        const techId = (overlayTechId ?? row.resource_id) as string | null;
        if (!techId) continue;

        const techName = row.resource_name as string | null;
        const userEmail = row.user_email as string | null;

        if (!locMap.has(locationId)) {
          locMap.set(locationId, { regionid_id: locationId, region: locationLabel, company: null, technicians: new Map() });
        }
        const loc = locMap.get(locationId)!;
        if (!loc.technicians.has(techId)) {
          loc.technicians.set(techId, { technician_id: techId, resource_name: techName, user_email: userEmail, jobs: [] });
        }

        const startParts = tsParts(effStart);
        const endParts = tsParts(effEnd);
        const startDate = effStart instanceof Date ? effStart : new Date(effStart as string);
        const startDayIndex = Math.floor(
          (Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) - rangeStartMs) / 86_400_000,
        );
        let endDayIndex = startDayIndex;
        if (effEnd != null) {
          const endDate = effEnd instanceof Date ? effEnd : new Date(effEnd as string);
          let ei = Math.floor(
            (Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) - rangeStartMs) / 86_400_000,
          );
          if (endDate.getUTCHours() === 0 && endDate.getUTCMinutes() === 0 && endDate.getUTCSeconds() === 0 && ei > startDayIndex) ei -= 1;
          if (ei > endDayIndex) endDayIndex = ei;
        }
        const spanStartDay = Math.max(0, Math.min(maxDayIndex, startDayIndex));
        const spanEndDay = Math.max(spanStartDay, Math.min(maxDayIndex, endDayIndex));

        for (let d = spanStartDay; d <= spanEndDay; d++) {
          loc.technicians.get(techId)!.jobs.push({
            booking_id: row.booking_id,
            work_order_id: row.work_order_id,
            work_order_number: row.work_order_number,
            title: row.title,
            system_status: row.system_status,
            booking_status: row.booking_status,
            customer_name: row.customer_name,
            technician_name: techName,
            contact_name: null,
            contact_businessphone: null,
            crmstart_time: startParts.date,
            crmstarttime: startParts.time,
            crmend_time: endParts.date,
            crmendtime: endParts.time,
            start_time: startParts.iso,
            end_time: endParts.iso,
            city: row.city ?? null,
            state: row.state ?? null,
            day_index: d,
            span_start_day: spanStartDay,
            span_end_day: spanEndDay,
            equipment_names: (row.equipment_names as string[] | null) ?? [],
          });
        }
      }

      const locRegions = Array.from(locMap.values()).map((loc) => ({
        regionid_id: loc.regionid_id,
        region: loc.region,
        company: loc.company,
        technicians: Array.from(loc.technicians.values()),
      }));

      res.json({
        view,
        group_by: "service-location",
        range_start: rangeStart,
        range_end: rangeEnd,
        day_count: dayCount,
        week_start: rangeStart,
        week_end: rangeEnd,
        regions: locRegions,
      });
      return;
    }

    // ── Tech-region mode (original) ───────────────────────────────────────────
    // Group by territory (region) -> resource (technician) -> bookings.
    //
    // A resource is normally mapped to a territory via crm.msdyn_resourceterritory
    // (DISTINCT ON keeps one mapping when a resource spans multiple territories).
    // When a booking's resource has no such mapping, the booking falls back to its
    // work order's service territory (wo.msdyn_serviceterritory) so it still lands
    // on the board instead of disappearing.
    //
    // Resource names fall back to the formatted name embedded in booking.raw_json,
    // and customer names fall back to the workorder's formatted serviceaccount value,
    // to cope with sparse crm.bookableresource / crm.account rows.
    //
    // The query is a UNION of:
    //   (A) every in-range booking, region resolved per the rule above; and
    //   (B) mapped resources that have no in-range bookings, so technician rows
    //       still render with an empty schedule (parity with the FS board).
    const result = await getCrmPool().query(
      `
      WITH active_res AS (
        -- Only bookable resources linked to an enabled (active) system user.
        SELECT br.bookableresourceid
        FROM crm.bookableresource br
        JOIN crm.systemuser su ON su.systemuserid = br.userid
        WHERE COALESCE(br.is_deleted, false) = false
          AND COALESCE(su.is_deleted, false) = false
          AND COALESCE(su.isdisabled, false) = false
      ),
      res_terr AS (
        SELECT DISTINCT ON (rt.msdyn_resource)
               rt.msdyn_resource AS resource_id,
               rt.msdyn_territory AS territory_id
        FROM crm.msdyn_resourceterritory rt
        WHERE rt.msdyn_resource IS NOT NULL
          AND rt.msdyn_territory IS NOT NULL
          AND COALESCE(rt.is_deleted, false) = false
        ORDER BY rt.msdyn_resource, rt.msdyn_territory
      ),
      bk AS (
        SELECT
          b.bookableresourcebookingid AS booking_id,
          b.resource                  AS resource_id,
          b.starttime                 AS start_time,
          b.endtime                   AS end_time,
          b.raw_json                  AS b_raw,
          COALESCE(rt.territory_id, wo.msdyn_serviceterritory) AS territory_id,
          wo.msdyn_workorderid        AS wo_id,
          wo.msdyn_name               AS wo_number,
          COALESCE(
            wo.new_customerrequirement,
            wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue'
          )                           AS title,
          wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' AS system_status,
          wo.msdyn_city               AS city,
          wo.msdyn_stateorprovince    AS state,
          COALESCE(
            acc.name,
            wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
          )                           AS customer_name
        FROM crm.booking b
        LEFT JOIN res_terr rt ON rt.resource_id = b.resource
        LEFT JOIN crm.workorder wo ON wo.msdyn_workorderid = b.msdyn_workorder
        LEFT JOIN crm.account acc ON acc.accountid = wo.msdyn_serviceaccount
        WHERE b.starttime >= $1::date
          AND b.starttime <  $2::date
          AND COALESCE(b.is_deleted, false) = false
          AND b.resource IN (SELECT bookableresourceid FROM active_res)
      )
      SELECT
        ter.territoryid::text                        AS regionid_id,
        ter.name                                     AS region,
        COALESCE(br.bookableresourceid::text, bk.resource_id::text) AS technician_id,
        COALESCE(
          br.name,
          bk.b_raw->>'_resource_value@OData.Community.Display.V1.FormattedValue'
        )                                            AS resource_name,
        br.msdyn_primaryemail                        AS user_email,
        bk.booking_id::text                          AS booking_id,
        bk.start_time                                AS start_time,
        bk.end_time                                  AS end_time,
        bk.b_raw->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue' AS booking_status,
        bk.wo_id::text                               AS work_order_id,
        bk.wo_number                                 AS work_order_number,
        bk.title                                     AS title,
        bk.system_status                             AS system_status,
        bk.city                                      AS city,
        bk.state                                     AS state,
        bk.customer_name                             AS customer_name,
        eq.equipment_names                           AS equipment_names
      FROM bk
      JOIN crm.territory ter ON ter.territoryid = bk.territory_id
      LEFT JOIN crm.bookableresource br
        ON br.bookableresourceid = bk.resource_id
       AND COALESCE(br.is_deleted, false) = false
      LEFT JOIN LATERAL (
        SELECT array_agg(woce.label ORDER BY woce.cf_name ASC) AS equipment_names
        FROM (
          SELECT
            cf_name,
            cf_name
              || CASE
                   WHEN NULLIF(BTRIM(cf_serialnumber), '') IS NOT NULL
                   THEN ' / ' || BTRIM(cf_serialnumber)
                   ELSE ''
                 END AS label
          FROM crm.cf_workordercustomerequipment
          WHERE workorderid = bk.wo_id
            AND COALESCE(is_deleted, false) = false
            AND cf_name IS NOT NULL
          ORDER BY cf_name ASC
          LIMIT 5
        ) woce
      ) eq ON true

      UNION ALL

      SELECT
        ter.territoryid::text                        AS regionid_id,
        ter.name                                     AS region,
        br.bookableresourceid::text                  AS technician_id,
        br.name                                      AS resource_name,
        br.msdyn_primaryemail                        AS user_email,
        NULL::text                                   AS booking_id,
        NULL::timestamp                              AS start_time,
        NULL::timestamp                              AS end_time,
        NULL::text                                   AS booking_status,
        NULL::text                                   AS work_order_id,
        NULL::text                                   AS work_order_number,
        NULL::text                                   AS title,
        NULL::text                                   AS system_status,
        NULL::text                                   AS city,
        NULL::text                                   AS state,
        NULL::text                                   AS customer_name,
        NULL::text[]                                 AS equipment_names
      FROM res_terr rterr
      JOIN crm.territory ter ON ter.territoryid = rterr.territory_id
      JOIN crm.bookableresource br
        ON br.bookableresourceid = rterr.resource_id
       AND COALESCE(br.is_deleted, false) = false
      WHERE NOT EXISTS (SELECT 1 FROM bk WHERE bk.resource_id = rterr.resource_id)
        AND rterr.resource_id IN (SELECT bookableresourceid FROM active_res)

      ORDER BY region ASC, resource_name ASC, start_time ASC NULLS LAST
      `,
      [rangeStart, rangeEnd],
    );

    type TechRow = {
      technician_id: string;
      resource_name: string | null;
      user_email: string | null;
      jobs: unknown[];
    };
    type RegionRow = {
      regionid_id: string;
      region: string;
      company: string | null;
      technicians: Map<string, TechRow>;
    };

    // Overlay queued (not-yet-synced) booking write-backs so the board optimistically
    // reflects staged reschedules: a queued move shifts a booking's start/end and can
    // reassign it to another technician. booking_writebacks lives in the app DB
    // (localPool), separate from the CRM mirror (getCrmPool()), so it is fetched here
    // and merged in JS rather than joined in SQL.
    const boardBookingIds = result.rows
      .map((row) => row.booking_id as string | null)
      .filter((v): v is string => !!v);
    const overlayByBooking = new Map<
      string,
      { start_time: Date | string | null; end_time: Date | string | null; technician_id: string | null }
    >();
    if (boardBookingIds.length > 0) {
      const queued = await localPool.query<{
        booking_id: string;
        start_time: Date | string | null;
        end_time: Date | string | null;
        technician_id: string | null;
      }>(
        `
        SELECT DISTINCT ON (booking_id)
               booking_id, start_time, end_time, technician_id
        FROM booking_writebacks
        WHERE booking_id = ANY($1::text[]) AND status = 'queued'
        ORDER BY booking_id, created_at DESC
        `,
        [boardBookingIds],
      );
      for (const q of queued.rows) {
        overlayByBooking.set(q.booking_id, {
          start_time: q.start_time,
          end_time: q.end_time,
          technician_id: q.technician_id,
        });
      }
    }

    const regionMap = new Map<string, RegionRow>();
    const rangeStartMs = start.getTime();
    const maxDayIndex = dayCount - 1;

    // Map each technician to its region/display info so a write-back that reassigns a
    // booking to another technician can re-home it under the correct row/region.
    type TechInfo = { regionid_id: string; resource_name: string | null; user_email: string | null };
    const techInfo = new Map<string, TechInfo>();
    for (const row of result.rows) {
      const tid = row.technician_id as string | null;
      if (tid && !techInfo.has(tid)) {
        techInfo.set(tid, {
          regionid_id: row.regionid_id as string,
          resource_name: row.resource_name,
          user_email: row.user_email,
        });
      }
    }

    const ensureTechRow = (
      regionid_id: string,
      region: string,
      tech: { technician_id: string; resource_name: string | null; user_email: string | null },
    ): TechRow => {
      if (!regionMap.has(regionid_id)) {
        regionMap.set(regionid_id, {
          regionid_id,
          region,
          company: null,
          technicians: new Map(),
        });
      }
      const rg = regionMap.get(regionid_id)!;
      if (!rg.technicians.has(tech.technician_id)) {
        rg.technicians.set(tech.technician_id, {
          technician_id: tech.technician_id,
          resource_name: tech.resource_name,
          user_email: tech.user_email,
          jobs: [],
        });
      }
      return rg.technicians.get(tech.technician_id)!;
    };

    // Pass 1: materialize all regions and technician rows (including empty ones).
    for (const row of result.rows) {
      const rid = row.regionid_id as string;
      if (!regionMap.has(rid)) {
        regionMap.set(rid, {
          regionid_id: rid,
          region: row.region,
          company: null,
          technicians: new Map(),
        });
      }
      const tid = row.technician_id as string | null;
      if (tid) {
        ensureTechRow(rid, row.region, {
          technician_id: tid,
          resource_name: row.resource_name,
          user_email: row.user_email,
        });
      }
    }

    // Pass 2: place each booking, applying any queued write-back overlay.
    for (const row of result.rows) {
      if (!row.booking_id || !row.start_time) continue;

      const overlay = overlayByBooking.get(row.booking_id as string);
      const effStart = overlay?.start_time ?? row.start_time;
      const effEnd = overlay?.end_time ?? row.end_time;

      let targetRegionId = row.regionid_id as string;
      let targetRegion = row.region as string;
      let targetTechId = row.technician_id as string;
      let targetTechName = row.resource_name as string | null;
      let targetUserEmail = row.user_email as string | null;
      if (
        overlay?.technician_id &&
        overlay.technician_id !== targetTechId &&
        activeResourceIds.has(overlay.technician_id)
      ) {
        const info = techInfo.get(overlay.technician_id);
        targetTechId = overlay.technician_id;
        if (info) {
          targetRegionId = info.regionid_id;
          const tr = regionMap.get(info.regionid_id);
          targetRegion = tr?.region ?? targetRegion;
          targetTechName = info.resource_name;
          targetUserEmail = info.user_email;
        } else {
          targetTechName = null;
          targetUserEmail = null;
        }
      }

      const techRow = ensureTechRow(targetRegionId, targetRegion, {
        technician_id: targetTechId,
        resource_name: targetTechName,
        user_email: targetUserEmail,
      });

      const startParts = tsParts(effStart);
      const endParts = tsParts(effEnd);
      const startDate = effStart instanceof Date ? effStart : new Date(effStart);
      const startDayIndex = Math.floor(
        (Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) -
          rangeStartMs) /
          86_400_000,
      );

      // A booking that spans multiple days must appear on EVERY day it covers,
      // not just its start day. Derive the end day index from the (effective)
      // end timestamp. A booking ending exactly at midnight occupies up to the
      // previous day, so it does not leak an empty trailing chip.
      let endDayIndex = startDayIndex;
      if (effEnd != null) {
        const endDate = effEnd instanceof Date ? effEnd : new Date(effEnd);
        let ei = Math.floor(
          (Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()) -
            rangeStartMs) /
            86_400_000,
        );
        const endsAtMidnight =
          endDate.getUTCHours() === 0 &&
          endDate.getUTCMinutes() === 0 &&
          endDate.getUTCSeconds() === 0;
        if (endsAtMidnight && ei > startDayIndex) ei -= 1;
        if (ei > endDayIndex) endDayIndex = ei;
      }

      // The SQL filter guarantees the start lands inside the visible range; clamp
      // the span to the visible window so out-of-range continuation days drop off.
      const spanStartDay = Math.max(0, Math.min(maxDayIndex, startDayIndex));
      const spanEndDay = Math.max(spanStartDay, Math.min(maxDayIndex, endDayIndex));

      for (let d = spanStartDay; d <= spanEndDay; d++) {
        techRow.jobs.push({
          booking_id: row.booking_id,
          work_order_id: row.work_order_id,
          work_order_number: row.work_order_number,
          title: row.title,
          system_status: row.system_status,
          booking_status: row.booking_status,
          customer_name: row.customer_name,
          technician_name: targetTechName,
          contact_name: null,
          contact_businessphone: null,
          crmstart_time: startParts.date,
          crmstarttime: startParts.time,
          crmend_time: endParts.date,
          crmendtime: endParts.time,
          start_time: startParts.iso,
          end_time: endParts.iso,
          city: row.city ?? null,
          state: row.state ?? null,
          day_index: d,
          span_start_day: spanStartDay,
          span_end_day: spanEndDay,
          equipment_names: (row.equipment_names as string[] | null) ?? [],
        });
      }
    }

    const regions = Array.from(regionMap.values()).map((rg) => ({
      regionid_id: rg.regionid_id,
      region: rg.region,
      company: rg.company,
      technicians: Array.from(rg.technicians.values()),
    }));

    res.json({
      view,
      range_start: rangeStart,
      range_end: rangeEnd,
      day_count: dayCount,
      week_start: rangeStart,
      week_end: rangeEnd,
      regions,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to get write-back schedule board", "Failed to get schedule board");
  }
});

// ── Unscheduled jobs (d365crm parity with the FS /unscheduled-jobs endpoint) ──
//
// Returns crm.workorder rows with system status "Unscheduled", enriched with a
// calibration due date, estimated duration, contact, and a ranked best-fit tech
// list. Best-fit ranking mirrors the FS endpoint: there is no geo data, so techs
// are scored by region match and historical familiarity with the job's city/state
// and region (derived from past bookings).
type WbFamRow = {
  technician_id: string;
  resource_name: string | null;
  region: string | null;
  city_key: string | null;
  state_key: string | null;
  region_key: string | null;
  city_jobs: number;
};

function keyCS(city: string | null | undefined, state: string | null | undefined): string {
  return `${(city ?? "").toLowerCase().trim()}|${(state ?? "").toLowerCase().trim()}`;
}
function keyR(r: string | null | undefined): string {
  return (r ?? "").toLowerCase().trim();
}

router.get("/wb/unscheduled-jobs", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    // 1. Unscheduled work orders enriched.
    const woResult = await getCrmPool().query(`
      SELECT
        wo.msdyn_workorderid::text AS work_order_id,
        wo.msdyn_name              AS work_order_number,
        wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue' AS work_order_type,
        NULLIF(wo.cf_axsalesorder, '') AS sales_order_number,
        COALESCE(
          wo.raw_json->>'_cf_servicelocation_value@OData.Community.Display.V1.FormattedValue',
          NULLIF(wo.msdyn_address1, '')
        )                          AS servicelocation,
        COALESCE(
          acc.name,
          wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
        )                          AS customer_name,
        wo.msdyn_city              AS city,
        wo.msdyn_stateorprovince   AS state,
        COALESCE(
          ter.name,
          wo.raw_json->>'_msdyn_serviceterritory_value@OData.Community.Display.V1.FormattedValue'
        )                          AS region,
        NULLIF(wo.cf_ponumber, '') AS po_number,
        COALESCE(
          ct.fullname,
          wo.raw_json->>'_cf_contactperson_value@OData.Community.Display.V1.FormattedValue'
        )                          AS contact_name,
        COALESCE(ct.telephone1, ct.mobilephone) AS contact_phone,
        due.due_date,
        NULLIF(wo.raw_json->>'msdyn_totalestimatedduration', '')::int AS duration_minutes
      FROM crm.workorder wo
      LEFT JOIN crm.account acc ON acc.accountid = wo.msdyn_serviceaccount
      LEFT JOIN crm.territory ter ON ter.territoryid = wo.msdyn_serviceterritory
      LEFT JOIN crm.contact ct ON ct.contactid = wo.cf_contactperson
      LEFT JOIN LATERAL (
        SELECT MIN(woce.cf_nextcalibrationdate) AS due_date
        FROM crm.cf_workordercustomerequipment woce
        WHERE woce.workorderid = wo.msdyn_workorderid
          AND COALESCE(woce.is_deleted, false) = false
      ) due ON true
      WHERE wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' = 'Unscheduled'
        AND COALESCE(wo.is_deleted, false) = false
        -- Exclude Calibration/Service jobs whose calibration due date is before 2026.
        -- Jobs with no due date (or due in 2026+) are kept.
        AND (
          COALESCE(wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue', '') <> 'Calibration/Service'
          OR due.due_date IS NULL
          OR due.due_date >= DATE '2026-01-01'
        )
      ORDER BY due.due_date ASC NULLS LAST, region ASC NULLS LAST, wo.msdyn_name ASC NULLS LAST
    `);

    // 2. Familiarity: per resource, count past bookings grouped by city+state and
    //    region (territory of the booking's work order).
    const famResult = await getCrmPool().query(`
      SELECT
        br.bookableresourceid::text AS technician_id,
        COALESCE(br.name, b.raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue') AS resource_name,
        ter.name                    AS region,
        LOWER(TRIM(wo.msdyn_city))  AS city_key,
        LOWER(TRIM(wo.msdyn_stateorprovince)) AS state_key,
        LOWER(TRIM(rter.name))      AS region_key,
        COUNT(*)::int               AS city_jobs
      FROM crm.booking b
      JOIN crm.workorder wo ON wo.msdyn_workorderid = b.msdyn_workorder
      LEFT JOIN crm.bookableresource br ON br.bookableresourceid = b.resource
      LEFT JOIN crm.msdyn_resourceterritory rt
        ON rt.msdyn_resource = b.resource AND COALESCE(rt.is_deleted, false) = false
      LEFT JOIN crm.territory ter ON ter.territoryid = rt.msdyn_territory
      LEFT JOIN crm.territory rter ON rter.territoryid = wo.msdyn_serviceterritory
      WHERE b.resource IS NOT NULL
        AND b.starttime IS NOT NULL
        AND b.starttime < NOW()
        AND COALESCE(b.is_deleted, false) = false
      GROUP BY br.bookableresourceid,
               COALESCE(br.name, b.raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue'),
               ter.name,
               LOWER(TRIM(wo.msdyn_city)),
               LOWER(TRIM(wo.msdyn_stateorprovince)),
               LOWER(TRIM(rter.name))
    `);

    type TechMeta = { resource_name: string | null; region: string | null };
    const techMeta = new Map<string, TechMeta>();
    const cityCount = new Map<string, number>();
    const regionCount = new Map<string, number>();
    for (const row of famResult.rows as WbFamRow[]) {
      if (!row.technician_id) continue;
      // Keep the first region seen (a resource may have past jobs across regions);
      // prefer one where the resource has a territory mapping.
      const existing = techMeta.get(row.technician_id);
      if (!existing || (existing.region == null && row.region != null)) {
        techMeta.set(row.technician_id, { resource_name: row.resource_name, region: row.region });
      }
      const ck = `${row.technician_id}::${row.city_key ?? ""}|${row.state_key ?? ""}`;
      cityCount.set(ck, (cityCount.get(ck) ?? 0) + row.city_jobs);
      const rk = `${row.technician_id}::${row.region_key ?? ""}`;
      regionCount.set(rk, (regionCount.get(rk) ?? 0) + row.city_jobs);
    }

    // Also include every resource with a territory mapping (some may have no past
    // bookings yet) so the best-fit pool isn't limited to historically active techs.
    const allTechsResult = await getCrmPool().query(`
      SELECT DISTINCT ON (br.bookableresourceid)
             br.bookableresourceid::text AS technician_id,
             br.name                     AS resource_name,
             ter.name                    AS region
      FROM crm.msdyn_resourceterritory rt
      JOIN crm.bookableresource br
        ON br.bookableresourceid = rt.msdyn_resource AND COALESCE(br.is_deleted, false) = false
      JOIN crm.territory ter ON ter.territoryid = rt.msdyn_territory
      WHERE COALESCE(rt.is_deleted, false) = false
      ORDER BY br.bookableresourceid
    `);
    for (const t of allTechsResult.rows) {
      if (!techMeta.has(t.technician_id)) {
        techMeta.set(t.technician_id, { resource_name: t.resource_name, region: t.region });
      }
    }

    // 3. Build best-fit list per job.
    const jobs = woResult.rows.map((r) => {
      const cityKey = keyCS(r.city, r.state);
      const regionKey = keyR(r.region);
      const scored = Array.from(techMeta.entries()).map(([techId, meta]) => {
        const cityJobs = cityCount.get(`${techId}::${cityKey}`) ?? 0;
        const regionJobs = regionCount.get(`${techId}::${regionKey}`) ?? 0;
        const sameRegion = keyR(meta.region) === regionKey && regionKey !== "";
        const rank = (sameRegion ? 1_000_000 : 0) + cityJobs * 1000 + regionJobs;
        return { techId, meta, cityJobs, regionJobs, sameRegion, rank };
      });

      const best = scored
        .filter((s) => s.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, 2)
        .map((s) => ({
          technician_id: s.techId,
          resource_name: s.meta.resource_name,
          region: s.meta.region,
          city_jobs: s.cityJobs,
          region_jobs: s.regionJobs,
          same_region: s.sameRegion,
        }));

      const due =
        r.due_date instanceof Date
          ? r.due_date.toISOString().slice(0, 10)
          : r.due_date != null
            ? String(r.due_date).slice(0, 10)
            : null;

      return {
        work_order_id: r.work_order_id,
        work_order_number: r.work_order_number,
        work_order_type: r.work_order_type ?? null,
        sales_order_number: r.sales_order_number ?? null,
        servicelocation: r.servicelocation,
        customer_name: r.customer_name,
        city: r.city,
        state: r.state,
        region: r.region,
        po_number: r.po_number,
        contact_name: r.contact_name,
        contact_phone: r.contact_phone,
        due_date: due,
        duration_minutes: r.duration_minutes ?? null,
        best_fit_techs: best,
      };
    });

    res.json({ jobs });
  } catch (err) {
    handleWbError(req, res, err, "Failed to get write-back unscheduled jobs", "Failed to get unscheduled jobs");
  }
});

// ── Resource utilization (d365crm parity with the FS endpoint) ───────────────
const WB_DEFAULT_WEEKLY_CAPACITY_HOURS = 40;
// A working day is the weekly capacity spread over a 5-day week (40h / 5 = 8h).
// Used to clamp a single booking's contribution to utilization so that outlier
// multi-day spans (some bookings span thousands of wall-clock hours in the CRM
// mirror) cannot inflate a technician past a realistic per-day workload.
const WB_WORKING_MINUTES_PER_DAY = (WB_DEFAULT_WEEKLY_CAPACITY_HOURS / 5) * 60;
type WbUtilView = "week" | "month" | "quarter";

function wbComputeRange(startRaw: string, view: WbUtilView) {
  const d = new Date(startRaw + "T00:00:00Z");
  let rangeStart: Date;
  let rangeEnd: Date;

  if (view === "month") {
    rangeStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    rangeEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  } else if (view === "quarter") {
    const quarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
    rangeStart = new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth, 1));
    rangeEnd = new Date(Date.UTC(d.getUTCFullYear(), quarterStartMonth + 3, 1));
  } else {
    rangeStart = new Date(startRaw + "T00:00:00Z");
    rangeEnd = new Date(rangeStart);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 7);
  }

  const daysInRange = (rangeEnd.getTime() - rangeStart.getTime()) / (1000 * 60 * 60 * 24);
  const periodWeeks = Math.round((daysInRange / 7) * 10) / 10;
  const capacityMinutes = Math.round((daysInRange / 7) * WB_DEFAULT_WEEKLY_CAPACITY_HOURS * 60);

  return {
    rangeStart: rangeStart.toISOString().slice(0, 10),
    rangeEnd: rangeEnd.toISOString().slice(0, 10),
    periodWeeks,
    capacityMinutes,
  };
}

router.get("/wb/resource-utilization", async (req, res) => {
  const startRaw = ((req.query.start as string | undefined) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    res.status(400).json({ error: "start query param required (YYYY-MM-DD)" });
    return;
  }

  const viewRaw = ((req.query.view as string | undefined) ?? "week").trim();
  const view: WbUtilView =
    viewRaw === "month" ? "month" : viewRaw === "quarter" ? "quarter" : "week";

  const { rangeStart, rangeEnd, periodWeeks, capacityMinutes } = wbComputeRange(startRaw, view);

  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    // Each region (territory) lists its mapped resources (technicians) with the
    // minutes booked inside the range. Duration is derived from booking start/end
    // (the CRM booking has no stored duration column). Resources are mapped to
    // territories via crm.msdyn_resourceterritory (DISTINCT ON keeps one mapping).
    //
    // Two safeguards keep the percentages realistic:
    //   1. Cancelled / no-show bookings are excluded (their booked time was never
    //      actually worked), filtered on the booking status formatted value.
    //   2. A job's booked duration is the difference between its start and end
    //      time, but it is capped at WB_WORKING_MINUTES_PER_DAY (8h) PER JOB PER
    //      DAY: each booking is split across every calendar day it spans, each
    //      day's portion is clamped to the query window and capped at 8h, then
    //      summed. This caps a single job to 8h/day (so an outlier multi-day CRM
    //      booking can't blow past 100% from one row) while still letting two
    //      separate jobs on the same day combine past 8h to surface overbooking.
    const result = await getCrmPool().query(
      `
      WITH res_terr AS (
        SELECT DISTINCT ON (rt.msdyn_resource)
               rt.msdyn_resource  AS resource_id,
               rt.msdyn_territory AS territory_id
        FROM crm.msdyn_resourceterritory rt
        WHERE rt.msdyn_resource IS NOT NULL
          AND rt.msdyn_territory IS NOT NULL
          AND COALESCE(rt.is_deleted, false) = false
        ORDER BY rt.msdyn_resource, rt.msdyn_territory
      )
      SELECT
        ter.territoryid::text         AS regionid_id,
        ter.name                      AS region,
        br.bookableresourceid::text   AS technician_id,
        br.name                       AS resource_name,
        COALESCE(SUM(
          CASE WHEN b.bookableresourcebookingid IS NULL THEN 0 ELSE (
            SELECT COALESCE(SUM(
              LEAST(
                GREATEST(0, EXTRACT(EPOCH FROM (
                  LEAST(b.endtime, gs.day + interval '1 day', $2::timestamp)
                  - GREATEST(b.starttime, gs.day, $1::timestamp)
                )) / 60),
                $3::numeric
              )
            ), 0)
            FROM generate_series(
              GREATEST(b.starttime, $1::timestamp)::date::timestamp,
              (LEAST(b.endtime, $2::timestamp) - interval '1 second')::date::timestamp,
              interval '1 day'
            ) AS gs(day)
          ) END
        ), 0)::int AS utilized_minutes,
        COUNT(b.bookableresourcebookingid)::int AS job_count
      FROM res_terr rterr
      JOIN crm.territory ter ON ter.territoryid = rterr.territory_id
      JOIN crm.bookableresource br
        ON br.bookableresourceid = rterr.resource_id AND COALESCE(br.is_deleted, false) = false
      LEFT JOIN crm.booking b
        ON b.resource = br.bookableresourceid
       AND b.starttime >= $1::date
       AND b.starttime <  $2::date
       AND b.endtime IS NOT NULL
       AND COALESCE(b.is_deleted, false) = false
       AND COALESCE(b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue', '') NOT ILIKE 'cancel%'
       AND COALESCE(b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue', '') NOT ILIKE '%no show%'
       AND COALESCE(b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue', '') NOT ILIKE '%no-show%'
      GROUP BY ter.territoryid, ter.name, br.bookableresourceid, br.name
      ORDER BY ter.name ASC, br.name ASC NULLS LAST
      `,
      [rangeStart, rangeEnd, WB_WORKING_MINUTES_PER_DAY],
    );

    type RegionRow = {
      regionid_id: string;
      region: string;
      technicians: Array<{
        technician_id: string;
        resource_name: string | null;
        utilized_minutes: number;
        capacity_minutes: number;
        utilization_pct: number;
        job_count: number;
      }>;
    };

    const regionMap = new Map<string, RegionRow>();
    for (const row of result.rows) {
      const rid = row.regionid_id as string;
      if (!regionMap.has(rid)) {
        regionMap.set(rid, { regionid_id: rid, region: row.region, technicians: [] });
      }
      if (!row.technician_id) continue;
      regionMap.get(rid)!.technicians.push({
        technician_id: row.technician_id,
        resource_name: row.resource_name,
        utilized_minutes: row.utilized_minutes,
        capacity_minutes: capacityMinutes,
        utilization_pct: capacityMinutes
          ? Math.round((row.utilized_minutes / capacityMinutes) * 1000) / 10
          : 0,
        job_count: row.job_count,
      });
    }

    res.json({
      view,
      range_start: rangeStart,
      range_end: rangeEnd,
      period_weeks: periodWeeks,
      default_weekly_capacity_hours: WB_DEFAULT_WEEKLY_CAPACITY_HOURS,
      regions: Array.from(regionMap.values()),
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to get write-back resource utilization", "Failed to get resource utilization");
  }
});

// ── Jobs by region (d365crm parity with the FS /jobs-by-region endpoint) ──
//
// Region (territory) -> technician (resource) -> jobs (bookings + work order
// details). Mirrors /wb/schedule-board grouping but is not date-bounded and
// returns every booking (optionally filtered by work-order system status).
// Resources mapped to a territory but with no bookings still render as empty
// technician rows (parity with the FS board). Region owner/company metadata is
// not modeled in the CRM mirror, so those fields are returned null.
router.get("/wb/jobs-by-region", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  const statusFilter = ((req.query.status as string | undefined) ?? "").trim();
  const params: string[] = [];
  const statusClause = statusFilter
    ? `AND wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' = $${params.push(statusFilter)}`
    : "";

  try {
    const result = await getCrmPool().query(
      `
      WITH res_terr AS (
        SELECT DISTINCT ON (rt.msdyn_resource)
               rt.msdyn_resource  AS resource_id,
               rt.msdyn_territory AS territory_id
        FROM crm.msdyn_resourceterritory rt
        WHERE rt.msdyn_resource IS NOT NULL
          AND rt.msdyn_territory IS NOT NULL
          AND COALESCE(rt.is_deleted, false) = false
        ORDER BY rt.msdyn_resource, rt.msdyn_territory
      ),
      bk AS (
        SELECT
          b.bookableresourcebookingid AS booking_id,
          b.resource                  AS resource_id,
          b.starttime                 AS start_time,
          b.endtime                   AS end_time,
          b.raw_json                  AS b_raw,
          COALESCE(rt.territory_id, wo.msdyn_serviceterritory) AS territory_id,
          wo.msdyn_workorderid        AS wo_id,
          wo.msdyn_name               AS wo_number,
          COALESCE(
            wo.new_customerrequirement,
            wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue'
          )                           AS title,
          wo.raw_json->>'_msdyn_priority_value@OData.Community.Display.V1.FormattedValue' AS priority,
          wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue'    AS system_status,
          wo.raw_json->>'msdyn_substatus@OData.Community.Display.V1.FormattedValue'       AS sub_status,
          COALESCE(
            wo.raw_json->>'_cf_servicelocation_value@OData.Community.Display.V1.FormattedValue',
            NULLIF(wo.msdyn_address1, '')
          )                           AS service_address,
          wo.msdyn_city               AS city,
          wo.msdyn_stateorprovince    AS state,
          COALESCE(
            acc.name,
            wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
          )                           AS customer_name
        FROM crm.booking b
        LEFT JOIN res_terr rt ON rt.resource_id = b.resource
        LEFT JOIN crm.workorder wo ON wo.msdyn_workorderid = b.msdyn_workorder
        LEFT JOIN crm.account acc ON acc.accountid = wo.msdyn_serviceaccount
        WHERE COALESCE(b.is_deleted, false) = false
          ${statusClause}
      )
      SELECT
        ter.territoryid::text                        AS regionid_id,
        ter.name                                     AS region,
        COALESCE(br.bookableresourceid::text, bk.resource_id::text) AS technician_id,
        COALESCE(
          br.name,
          bk.b_raw->>'_resource_value@OData.Community.Display.V1.FormattedValue'
        )                                            AS resource_name,
        br.msdyn_primaryemail                        AS user_email,
        bk.booking_id::text                          AS booking_id,
        bk.wo_id::text                               AS work_order_id,
        bk.wo_number                                 AS work_order_number,
        bk.title                                     AS title,
        bk.priority                                  AS priority,
        bk.system_status                             AS system_status,
        bk.sub_status                                AS sub_status,
        bk.b_raw->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue' AS booking_status,
        bk.service_address                           AS service_address,
        bk.customer_name                             AS customer_name,
        bk.city                                      AS city,
        bk.state                                     AS state,
        bk.start_time                                AS start_time,
        bk.end_time                                  AS end_time,
        CASE
          WHEN bk.start_time IS NOT NULL AND bk.end_time IS NOT NULL
          THEN ROUND(EXTRACT(EPOCH FROM (bk.end_time - bk.start_time)) / 60)::int
          ELSE NULL
        END                                          AS duration_minutes
      FROM bk
      JOIN crm.territory ter ON ter.territoryid = bk.territory_id
      LEFT JOIN crm.bookableresource br
        ON br.bookableresourceid = bk.resource_id
       AND COALESCE(br.is_deleted, false) = false

      UNION ALL

      SELECT
        ter.territoryid::text                        AS regionid_id,
        ter.name                                     AS region,
        br.bookableresourceid::text                  AS technician_id,
        br.name                                      AS resource_name,
        br.msdyn_primaryemail                        AS user_email,
        NULL::text                                   AS booking_id,
        NULL::text                                   AS work_order_id,
        NULL::text                                   AS work_order_number,
        NULL::text                                   AS title,
        NULL::text                                   AS priority,
        NULL::text                                   AS system_status,
        NULL::text                                   AS sub_status,
        NULL::text                                   AS booking_status,
        NULL::text                                   AS service_address,
        NULL::text                                   AS customer_name,
        NULL::text                                   AS city,
        NULL::text                                   AS state,
        NULL::timestamp                              AS start_time,
        NULL::timestamp                              AS end_time,
        NULL::int                                    AS duration_minutes
      FROM res_terr rterr
      JOIN crm.territory ter ON ter.territoryid = rterr.territory_id
      JOIN crm.bookableresource br
        ON br.bookableresourceid = rterr.resource_id
       AND COALESCE(br.is_deleted, false) = false
      WHERE NOT EXISTS (SELECT 1 FROM bk WHERE bk.resource_id = rterr.resource_id)

      ORDER BY region ASC, resource_name ASC NULLS LAST, start_time ASC NULLS LAST
      `,
      params,
    );

    type TechRow = {
      technician_id: string;
      resource_name: string | null;
      user_email: string | null;
      jobs: unknown[];
    };
    type RegionRow = {
      regionid_id: string;
      region: string;
      owner_name: string | null;
      owner_email: string | null;
      company: string | null;
      technicians: Map<string, TechRow>;
    };

    const regionMap = new Map<string, RegionRow>();
    for (const row of result.rows) {
      const rid = row.regionid_id as string;
      if (!regionMap.has(rid)) {
        regionMap.set(rid, {
          regionid_id: rid,
          region: row.region,
          owner_name: null,
          owner_email: null,
          company: null,
          technicians: new Map(),
        });
      }
      const rg = regionMap.get(rid)!;
      const tid = row.technician_id as string | null;
      if (!tid) continue;
      if (!rg.technicians.has(tid)) {
        rg.technicians.set(tid, {
          technician_id: tid,
          resource_name: row.resource_name,
          user_email: row.user_email,
          jobs: [],
        });
      }
      if (!row.booking_id) continue;
      rg.technicians.get(tid)!.jobs.push({
        booking_id: row.booking_id,
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        title: row.title,
        priority: row.priority,
        system_status: row.system_status,
        sub_status: row.sub_status,
        booking_status: row.booking_status,
        service_address: row.service_address,
        customer_name: row.customer_name,
        city: row.city,
        state: row.state,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_minutes: row.duration_minutes,
      });
    }

    const response = Array.from(regionMap.values()).map((rg) => ({
      regionid_id: rg.regionid_id,
      region: rg.region,
      owner_name: rg.owner_name,
      owner_email: rg.owner_email,
      company: rg.company,
      technicians: Array.from(rg.technicians.values()),
    }));

    res.json(response);
  } catch (err) {
    handleWbError(req, res, err, "Failed to get write-back jobs by region", "Failed to get jobs by region");
  }
});

// ─── Service Management Dashboard reports (PDF pages 1, 2, 4) ────────────────
// All reports are at work-order grain. Region = service territory name;
// "(Blank)" denotes a work order with no service territory.

const REPORT_ROW_SELECT = `
  SELECT
    wo.msdyn_name                                                                   AS fsa_srv_num,
    wo.raw_json->>'cf_axserviceorderid'                                             AS ax_srv_num,
    wo.raw_json->>'_cf_companystructure_value@OData.Community.Display.V1.FormattedValue' AS company,
    t.name                                                                          AS region,
    wo.raw_json->>'_cf_servicelocation_value@OData.Community.Display.V1.FormattedValue'  AS location,
    COALESCE(
      a.name,
      wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
    )                                                                               AS customer_name,
    tech.resource_name                                                              AS technician,
    NULLIF(wo.raw_json->>'msdyn_completedon', '')::timestamptz                      AS completed_on,
    NULLIF(wo.raw_json->>'cf_approvedon', '')::timestamptz                          AS approved_on,
    wo.raw_json->>'_cf_approvedby_value@OData.Community.Display.V1.FormattedValue'   AS approved_by,
    wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue'     AS order_status
  FROM crm.workorder wo
  LEFT JOIN crm.territory t ON t.territoryid = wo.msdyn_serviceterritory
  LEFT JOIN crm.account a ON a.accountid = wo.msdyn_serviceaccount
  LEFT JOIN LATERAL (
    SELECT raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue' AS resource_name
    FROM crm.booking
    WHERE msdyn_workorder = wo.msdyn_workorderid AND COALESCE(is_deleted, false) = false
    ORDER BY starttime ASC NULLS LAST
    LIMIT 1
  ) tech ON true
`;

type ReportRow = {
  fsa_srv_num: string | null;
  ax_srv_num: string | null;
  company: string | null;
  region: string | null;
  location: string | null;
  customer_name: string | null;
  technician: string | null;
  completed_on: Date | string | null;
  approved_on: Date | string | null;
  approved_by: string | null;
  order_status: string | null;
};

function shapeReportRow(row: ReportRow) {
  return {
    fsa_srv_num: row.fsa_srv_num,
    ax_srv_num: row.ax_srv_num,
    company: row.company,
    region: row.region ?? "(Blank)",
    location: row.location,
    customer_name: row.customer_name,
    technician: row.technician,
    completed_on: toIso(row.completed_on),
    approved_on: toIso(row.approved_on),
    approved_by: row.approved_by,
    order_status: row.order_status,
  };
}

// Append an optional region filter; "(Blank)" means no service territory.
function appendRegionFilter(region: string, params: unknown[]): string {
  if (!region) return "";
  if (region === "(Blank)") return ` AND wo.msdyn_serviceterritory IS NULL`;
  return ` AND t.name = $${params.push(region)}`;
}

const REPORT_DETAIL_LIMIT = 1000;

// Filter dropdown options drawn from the full work-order universe.
router.get("/wb/reports/filters", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  try {
    const pool = getCrmPool();
    const [regionsR, yearsR, approversR] = await Promise.all([
      pool.query<{ region: string; has_blank: boolean }>(`
        SELECT t.name AS region, false AS has_blank
        FROM crm.workorder wo
        JOIN crm.territory t ON t.territoryid = wo.msdyn_serviceterritory
        WHERE COALESCE(wo.is_deleted, false) = false
        GROUP BY t.name
        ORDER BY t.name`),
      pool.query<{ yr: number }>(`
        SELECT DISTINCT EXTRACT(YEAR FROM NULLIF(raw_json->>'createdon', '')::timestamptz)::int AS yr
        FROM crm.workorder
        WHERE COALESCE(is_deleted,false)=false
          AND NULLIF(raw_json->>'createdon', '') IS NOT NULL
        ORDER BY yr DESC`),
      pool.query<{ approver: string }>(`
        SELECT DISTINCT raw_json->>'_cf_approvedby_value@OData.Community.Display.V1.FormattedValue' AS approver
        FROM crm.workorder
        WHERE COALESCE(is_deleted,false)=false
          AND raw_json->>'_cf_approvedby_value@OData.Community.Display.V1.FormattedValue' IS NOT NULL
        ORDER BY approver`),
    ]);

    const hasBlank = await pool.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM crm.workorder
      WHERE COALESCE(is_deleted,false)=false AND msdyn_serviceterritory IS NULL`);

    const regions = regionsR.rows.map((r) => r.region);
    if (Number(hasBlank.rows[0]?.n ?? "0") > 0) regions.unshift("(Blank)");

    res.json({
      regions,
      years: yearsR.rows.map((r) => r.yr),
      approvers: approversR.rows.map((r) => r.approver),
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to load report filters", "Failed to load report filters");
  }
});

// PDF page 1: Service Orders Completed not Approved.
router.get("/wb/reports/completed-not-approved", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const region = ((req.query.region as string | undefined) ?? "").trim();
  const year = Number(req.query.year);
  const month = Number(req.query.month);

  try {
    const params: unknown[] = [];
    let where = `
      WHERE COALESCE(wo.is_deleted, false) = false
        AND NULLIF(wo.raw_json->>'msdyn_completedon', '') IS NOT NULL
        AND NULLIF(wo.raw_json->>'cf_approvedon', '') IS NULL`;
    where += appendRegionFilter(region, params);
    if (Number.isFinite(year) && year > 0) {
      where += ` AND EXTRACT(YEAR FROM NULLIF(wo.raw_json->>'createdon', '')::timestamptz) = $${params.push(year)}`;
    }
    if (Number.isFinite(month) && month >= 1 && month <= 12) {
      where += ` AND EXTRACT(MONTH FROM NULLIF(wo.raw_json->>'createdon', '')::timestamptz) = $${params.push(month)}`;
    }
    res.json(await runServiceOrderReport(where, params, "completed_on"));
  } catch (err) {
    handleWbError(req, res, err, "Failed to run completed-not-approved report", "Failed to run report");
  }
});

// PDF page 2: Service Orders Completed and Approved not Invoiced.
router.get("/wb/reports/approved-not-invoiced", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const region = ((req.query.region as string | undefined) ?? "").trim();

  try {
    const params: unknown[] = [];
    let where = `
      WHERE COALESCE(wo.is_deleted, false) = false
        AND NULLIF(wo.raw_json->>'cf_approvedon', '') IS NOT NULL
        AND COALESCE(wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue', '') <> 'Invoiced'`;
    where += appendRegionFilter(region, params);
    res.json(await runServiceOrderReport(where, params, "approved_on"));
  } catch (err) {
    handleWbError(req, res, err, "Failed to run approved-not-invoiced report", "Failed to run report");
  }
});

// Shared executor for the page-1/2 service-order reports: total, count by
// region, and a capped set of detail rows.
async function runServiceOrderReport(
  where: string,
  params: unknown[],
  orderColumn: "completed_on" | "approved_on",
) {
  const pool = getCrmPool();
  const aggSql = `
    SELECT COALESCE(t.name, '(Blank)') AS region, count(*)::int AS count
    FROM crm.workorder wo
    LEFT JOIN crm.territory t ON t.territoryid = wo.msdyn_serviceterritory
    ${where}
    GROUP BY COALESCE(t.name, '(Blank)')
    ORDER BY count DESC`;
  const orderExpr =
    orderColumn === "completed_on"
      ? `(wo.raw_json->>'msdyn_completedon')::timestamptz`
      : `(wo.raw_json->>'cf_approvedon')::timestamptz`;
  const detailSql = `${REPORT_ROW_SELECT} ${where} ORDER BY ${orderExpr} DESC NULLS LAST LIMIT ${REPORT_DETAIL_LIMIT}`;

  const [agg, detail] = await Promise.all([
    pool.query<{ region: string; count: number }>(aggSql, params),
    pool.query<ReportRow>(detailSql, params),
  ]);

  const total = agg.rows.reduce((s, r) => s + Number(r.count), 0);
  return {
    total,
    by_region: agg.rows.map((r) => ({ region: r.region, count: Number(r.count) })),
    rows: detail.rows.map(shapeReportRow),
  };
}

// PDF page 4: Weekly Approved Summary — count of approvals by approver and
// ISO week of the approval date.
router.get("/wb/reports/weekly-approved", async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const region = ((req.query.region as string | undefined) ?? "").trim();
  const approvedBy = ((req.query.approved_by as string | undefined) ?? "").trim();
  const year = Number(req.query.year);
  const month = Number(req.query.month);

  try {
    const params: unknown[] = [];
    let where = `
      WHERE COALESCE(wo.is_deleted, false) = false
        AND NULLIF(wo.raw_json->>'cf_approvedon', '') IS NOT NULL
        AND wo.raw_json->>'_cf_approvedby_value@OData.Community.Display.V1.FormattedValue' IS NOT NULL`;
    where += appendRegionFilter(region, params);
    if (approvedBy) {
      where += ` AND wo.raw_json->>'_cf_approvedby_value@OData.Community.Display.V1.FormattedValue' = $${params.push(approvedBy)}`;
    }
    if (Number.isFinite(year) && year > 0) {
      where += ` AND EXTRACT(YEAR FROM NULLIF(wo.raw_json->>'createdon', '')::timestamptz) = $${params.push(year)}`;
    }
    if (Number.isFinite(month) && month >= 1 && month <= 12) {
      where += ` AND EXTRACT(MONTH FROM NULLIF(wo.raw_json->>'createdon', '')::timestamptz) = $${params.push(month)}`;
    }

    const sql = `
      SELECT
        wo.raw_json->>'_cf_approvedby_value@OData.Community.Display.V1.FormattedValue' AS approved_by,
        EXTRACT(WEEK FROM (wo.raw_json->>'cf_approvedon')::timestamptz)::int           AS week_no,
        count(*)::int                                                                  AS cnt
      FROM crm.workorder wo
      LEFT JOIN crm.territory t ON t.territoryid = wo.msdyn_serviceterritory
      ${where}
      GROUP BY 1, 2`;
    const result = await getCrmPool().query<{ approved_by: string; week_no: number; cnt: number }>(sql, params);

    const weekSet = new Set<number>();
    const byApprover = new Map<string, { approved_by: string; total: number; weeks: Record<string, number> }>();
    let total = 0;
    for (const row of result.rows) {
      const wk = Number(row.week_no);
      const cnt = Number(row.cnt);
      weekSet.add(wk);
      total += cnt;
      if (!byApprover.has(row.approved_by)) {
        byApprover.set(row.approved_by, { approved_by: row.approved_by, total: 0, weeks: {} });
      }
      const a = byApprover.get(row.approved_by)!;
      a.total += cnt;
      a.weeks[String(wk)] = (a.weeks[String(wk)] ?? 0) + cnt;
    }

    const week_numbers = Array.from(weekSet).sort((x, y) => x - y);
    const approvers = Array.from(byApprover.values()).sort((x, y) => y.total - x.total);
    res.json({ total, week_numbers, approvers });
  } catch (err) {
    handleWbError(req, res, err, "Failed to run weekly-approved report", "Failed to run report");
  }
});

const syncRequestSchema = z
  .object({
    ids: z.array(z.number().int().positive()).optional(),
  })
  .optional();

router.post("/wb/sync", async (req, res) => {
  if (!isDataverseConfigured()) {
    res.status(503).json({
      error:
        "Dataverse is not configured. Set TENANT_ID, CLIENT_ID, CLIENT_SECRET, and DATAVERSE_URL.",
    });
    return;
  }

  const parsed = syncRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const ids = parsed.data?.ids;

  try {
    // Atomically claim eligible rows so concurrent sync calls never process the
    // same write-back twice. Setting status to 'processing' removes them from the
    // eligibility set; SKIP LOCKED avoids blocking between concurrent claims.
    const params: unknown[] = [];
    let eligibility = `status IN ('queued', 'failed')`;
    if (ids && ids.length > 0) {
      params.push(ids);
      // Keep the status guard even when specific ids are requested, so an
      // already-synced row can never be re-pushed to production.
      eligibility = `status IN ('queued', 'failed') AND id = ANY($1::int[])`;
    }

    const queued = await localPool.query<WritebackRow>(
      `UPDATE booking_writebacks
       SET status = 'processing'
       WHERE id IN (
         SELECT id FROM booking_writebacks
         WHERE ${eligibility}
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, booking_id, work_order_id, start_time, end_time, technician_id, status, created_at, synced_at, error`,
      params,
    );

    const results: Array<{ id: number; status: "synced" | "failed"; error: string | null }> = [];
    let syncedCount = 0;
    let failedCount = 0;

    for (const row of queued.rows) {
      try {
        if (row.booking_id.startsWith(NEW_BOOKING_PREFIX)) {
          // New-booking write-back: there is no booking to patch yet, so create
          // one in Dataverse bound to the work order.
          if (!row.work_order_id) {
            throw new Error("Cannot create a booking without a work order id.");
          }
          await createBooking({
            workOrderId: row.work_order_id,
            startTime: toIso(row.start_time),
            endTime: toIso(row.end_time),
            resourceId: row.technician_id,
          });
        } else {
          await patchBooking(row.booking_id, {
            startTime: toIso(row.start_time),
            endTime: toIso(row.end_time),
            resourceId: row.technician_id,
          });
        }
        await localPool.query(
          `UPDATE booking_writebacks SET status = 'synced', synced_at = now(), error = NULL WHERE id = $1`,
          [row.id],
        );
        syncedCount += 1;
        results.push({ id: row.id, status: "synced", error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        await localPool.query(
          `UPDATE booking_writebacks SET status = 'failed', error = $2 WHERE id = $1`,
          [row.id, message],
        );
        failedCount += 1;
        results.push({ id: row.id, status: "failed", error: message });
        req.log.error({ err, writebackId: row.id, bookingId: row.booking_id }, "Write-back sync failed");
      }
    }

    res.json({
      processed: queued.rows.length,
      synced: syncedCount,
      failed: failedCount,
      results,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to run write-back sync", "Failed to run write-back sync", { source: "mixed" });
  }
});

export default router;
