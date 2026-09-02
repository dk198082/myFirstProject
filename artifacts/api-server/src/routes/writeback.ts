import { Router } from "express";
import type { Request, Response } from "express";
import { requireRole, requireLogin } from "../lib/auth.js";
import { z } from "zod";
import { getCrmPool, isCrmConfigured, isCrmUnavailableError } from "../lib/crmDb.js";
import { getCoordinatorDefault } from "../lib/coordinatorDefault.js";
import { localPool } from "../lib/localDb.js";
import {
  mirrorPlaceholderJobUpsert,
  mirrorPlaceholderJobDelete,
  mirrorScheduleBlockUpsert,
  mirrorScheduleBlockDelete,
} from "../lib/crmMirror.js";
import {
  isDataverseConfigured,
  patchBooking,
  createBooking,
  fetchWorkOrdersByName,
  fetchBookingsForWorkOrders,
} from "../lib/dataverse.js";

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

router.get("/wb/work-orders", requireLogin, async (req, res) => {
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

router.patch("/wb/bookings/:bookingId", requireRole("editor"), async (req, res) => {
  const { bookingId } = req.params as { bookingId: string };
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

router.post("/wb/work-orders/:workOrderId/booking", requireRole("editor"), async (req, res) => {
  const workOrderId = String(req.params.workOrderId);
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

// ── Direct CRM save (bypass queue) ────────────────────────────────────────────
// These endpoints call patchBooking / createBooking immediately and return once
// Dataverse confirms. Nothing is written to booking_writebacks. Dataverse must
// be fully configured (TENANT_ID, CLIENT_ID, CLIENT_SECRET, DATAVERSE_URL) or
// the request is rejected with 503.

router.post("/wb/bookings/:bookingId/save", requireRole("editor"), async (req, res) => {
  const bookingId = String(req.params.bookingId);
  const parsed = bookingUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  if (!isDataverseConfigured()) {
    res.status(503).json({ error: "Dataverse is not configured. Set TENANT_ID, CLIENT_ID, CLIENT_SECRET, and DATAVERSE_URL to enable direct CRM saves." });
    return;
  }
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    const existing = await getCrmPool().query<{ booking_id: string }>(
      `SELECT bookableresourcebookingid::text AS booking_id
       FROM crm.booking WHERE bookableresourcebookingid = $1 LIMIT 1`,
      [bookingId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    await patchBooking(bookingId, {
      startTime: body.start_time ?? undefined,
      endTime: body.end_time ?? undefined,
      resourceId: body.technician_id ?? undefined,
    });

    res.json({ message: "Booking saved to CRM" });
  } catch (err) {
    handleWbError(req, res, err, "Failed to save booking to CRM", "Failed to save to CRM", {
      logContext: { bookingId },
      source: "mixed",
    });
  }
});

router.post("/wb/work-orders/:workOrderId/booking/save", requireRole("editor"), async (req, res) => {
  const workOrderId = String(req.params.workOrderId);
  const parsed = bookingUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const body = parsed.data;

  if (!isDataverseConfigured()) {
    res.status(503).json({ error: "Dataverse is not configured. Set TENANT_ID, CLIENT_ID, CLIENT_SECRET, and DATAVERSE_URL to enable direct CRM saves." });
    return;
  }
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

    await createBooking({
      workOrderId,
      startTime: body.start_time ?? undefined,
      endTime: body.end_time ?? undefined,
      resourceId: body.technician_id ?? undefined,
    });

    res.json({ message: "Booking created in CRM" });
  } catch (err) {
    handleWbError(req, res, err, "Failed to create booking in CRM", "Failed to save to CRM", {
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
router.get("/wb/work-orders/:workOrderId/detail", requireLogin, async (req, res) => {
  const { workOrderId } = req.params as { workOrderId: string };

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

// ── Schedule blocks (Drive Time / PTO) ────────────────────────────────────────

const createScheduleBlockSchema = z.object({
  technician_id: z.string().min(1),
  block_type: z.enum(["drive_time", "pto", "custom"]),
  title: z.string().nullable().optional(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  notes: z.string().nullable().optional(),
  color_index: z.number().int().min(0).max(15).nullable().optional(),
});

const updateScheduleBlockSchema = z
  .object({
    technician_id: z.string().min(1).optional(),
    block_type: z.enum(["drive_time", "pto", "custom"]).optional(),
    title: z.string().nullable().optional(),
    start_time: z.string().min(1).optional(),
    end_time: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
    color_index: z.number().int().min(0).max(15).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update",
  });

router.get("/wb/schedule-blocks", requireLogin, async (req, res) => {
  const { start_date, end_date } = req.query as Record<string, string | undefined>;
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    // Overlap semantics: return any block that intersects [start_date, end_date),
    // so multi-day blocks that started before the window are still included.
    // Strict > so a block ending exactly at midnight on start_date is excluded.
    if (start_date) {
      params.push(start_date);
      conditions.push(`end_time > $${params.length}::date`);
    }
    if (end_date) {
      params.push(end_date);
      conditions.push(`start_time < $${params.length}::date`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const r = await localPool.query(
      `SELECT id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at
       FROM crm.schedule_blocks ${where} ORDER BY start_time`,
      params,
    );
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        technician_id: row.technician_id,
        block_type: row.block_type,
        title: row.title ?? null,
        start_time: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
        end_time: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
        notes: row.notes ?? null,
        color_index: row.color_index ?? null,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      })),
    );
  } catch (err) {
    handleWbError(req, res, err, "Failed to list schedule blocks", "Failed to list schedule blocks");
  }
});

router.post("/wb/schedule-blocks", requireRole("editor"), async (req, res) => {
  const parsed = createScheduleBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { technician_id, block_type, title, start_time, end_time, notes, color_index } = parsed.data;
  try {
    const r = await localPool.query(
      `INSERT INTO crm.schedule_blocks (technician_id, block_type, title, start_time, end_time, notes, color_index)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at`,
      [technician_id, block_type, title ?? null, start_time, end_time, notes ?? null, color_index ?? null],
    );
    const row = r.rows[0];
    void mirrorScheduleBlockUpsert(req.log, row);
    res.status(201).json({
      id: row.id,
      technician_id: row.technician_id,
      block_type: row.block_type,
      title: row.title ?? null,
      start_time: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      end_time: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
      notes: row.notes ?? null,
      color_index: row.color_index ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to create schedule block", "Failed to create schedule block");
  }
});

router.patch("/wb/schedule-blocks/:id", requireRole("editor"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid block id" });
    return;
  }
  const parsed = updateScheduleBlockSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { technician_id, block_type, title, start_time, end_time, notes, color_index } = parsed.data;
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (technician_id !== undefined) { sets.push(`technician_id = $${vals.push(technician_id)}`); }
    if (block_type !== undefined) { sets.push(`block_type = $${vals.push(block_type)}`); }
    if (title !== undefined) { sets.push(`title = $${vals.push(title)}`); }
    if (start_time !== undefined) { sets.push(`start_time = $${vals.push(start_time)}`); }
    if (end_time !== undefined) { sets.push(`end_time = $${vals.push(end_time)}`); }
    if (notes !== undefined) { sets.push(`notes = $${vals.push(notes)}`); }
    if (color_index !== undefined) { sets.push(`color_index = $${vals.push(color_index)}`); }
    if (sets.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    vals.push(id);
    const r = await localPool.query(
      `UPDATE crm.schedule_blocks SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at`,
      vals,
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    const row = r.rows[0];
    void mirrorScheduleBlockUpsert(req.log, row);
    res.json({
      id: row.id,
      technician_id: row.technician_id,
      block_type: row.block_type,
      title: row.title ?? null,
      start_time: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      end_time: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
      notes: row.notes ?? null,
      color_index: row.color_index ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to update schedule block", "Failed to update schedule block");
  }
});

router.delete("/wb/schedule-blocks/:id", requireRole("editor"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid block id" });
    return;
  }
  try {
    const r = await localPool.query(
      `DELETE FROM crm.schedule_blocks WHERE id = $1 RETURNING id`,
      [id],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Block not found" });
      return;
    }
    void mirrorScheduleBlockDelete(req.log, id);
    res.status(204).send();
  } catch (err) {
    handleWbError(req, res, err, "Failed to delete schedule block", "Failed to delete schedule block");
  }
});

// ── Placeholder jobs (speculative / unconfirmed work, not yet in CRM) ─────────

// ── Service locations (CRM accounts) ─────────────────────────────────────────

router.get("/wb/service-locations", requireLogin, async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const search = ((req.query.search as string | undefined) ?? "").trim();
  const limitRaw = Number(req.query.limit ?? 20);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

  try {
    const params: unknown[] = [];
    let whereSearch = "";
    if (search.length >= 2) {
      params.push(`%${search}%`);
      whereSearch = `AND (cf_servicelocid ILIKE $${params.length} OR cf_addressname ILIKE $${params.length} OR cf_city ILIKE $${params.length} OR cf_state ILIKE $${params.length})`;
    }
    params.push(limit);
    const r = await getCrmPool().query(
      `SELECT cf_servicelocationid::text AS id,
              cf_servicelocid          AS service_loc_id,
              cf_addressname           AS name,
              cf_city                  AS city,
              cf_state                 AS state,
              cf_street1               AS address
       FROM crm.cf_servicelocation
       WHERE COALESCE(is_deleted, false) = false ${whereSearch}
       ORDER BY cf_servicelocid ASC NULLS LAST
       LIMIT $${params.length}`,
      params,
    );
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        service_loc_id: row.service_loc_id ?? null,
        name: row.name ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        address: row.address ?? null,
      })),
    );
  } catch (err) {
    handleWbError(req, res, err, "Failed to list service locations", "Failed to list service locations");
  }
});

router.get("/wb/service-locations/:locationId", requireLogin, async (req, res) => {
  const { locationId } = req.params;
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }

  try {
    const slRes = await getCrmPool().query(
      `SELECT sl.cf_servicelocationid::text AS id,
              sl.cf_servicelocid           AS service_loc_id,
              sl.cf_addressname            AS name,
              sl.cf_street1                AS address,
              sl.cf_city                   AS city,
              sl.cf_state                  AS state,
              sl.cf_zippostalcode          AS postal_code,
              sl.cf_countryregion          AS country,
              sl.cf_account::text          AS account_id,
              sl.cf_servicecontact::text   AS service_contact_id,
              sl.cf_specialinstructions    AS special_instructions
       FROM crm.cf_servicelocation sl
       WHERE sl.cf_servicelocationid = $1 AND COALESCE(sl.is_deleted, false) = false
       LIMIT 1`,
      [locationId],
    );
    const sl = slRes.rows[0];
    if (!sl) {
      res.status(404).json({ error: "Service location not found" });
      return;
    }

    const [contactRes, equipmentRes] = await Promise.all([
      // Primary contact: use cf_servicecontact on the service location record
      sl.service_contact_id
        ? getCrmPool().query(
            `SELECT c.contactid::text AS contact_id, c.fullname, c.firstname, c.lastname,
                    c.emailaddress1 AS email, c.telephone1 AS businessphone,
                    c.mobilephone, NULL::text AS homephone, NULL::text AS street1,
                    NULL::text AS city, NULL::text AS state, NULL::text AS country
             FROM crm.contact c
             WHERE c.contactid = $1 AND COALESCE(c.is_deleted, false) = false
             LIMIT 1`,
            [sl.service_contact_id],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      // Equipment: work orders whose service location FK matches this service location
      getCrmPool().query(
        `SELECT DISTINCT ON (e.cf_name)
                e.cf_workordercustomerequipmentid::text AS equipmentid,
                e.cf_name AS name,
                e.cf_serialnumber AS serialnumber,
                e.cf_lastcalibrationdate AS lastcalibrationdate,
                e.cf_nextcalibrationdate AS nextcalibrationdate,
                e.cf_calibrationdate AS calibrationdate,
                NULL::int AS calinterval,
                NULL::text AS machinecapacity
         FROM crm.cf_workordercustomerequipment e
         JOIN crm.workorder wo ON wo.msdyn_workorderid = e.workorderid
         WHERE wo.cf_servicelocation = $1
           AND COALESCE(e.is_deleted, false) = false
           AND COALESCE(wo.is_deleted, false) = false
         ORDER BY e.cf_name ASC NULLS LAST, e.cf_nextcalibrationdate ASC NULLS LAST`,
        [locationId],
      ),
    ]);

    const toDateOnly = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null);

    const equipment = equipmentRes.rows.map((e) => ({
      ...e,
      lastcalibrationdate: toDateOnly(e.lastcalibrationdate),
      nextcalibrationdate: toDateOnly(e.nextcalibrationdate),
      calibrationdate: toDateOnly(e.calibrationdate),
    }));

    res.json({
      id: sl.id,
      service_loc_id: sl.service_loc_id ?? null,
      name: sl.name ?? null,
      address: sl.address ?? null,
      city: sl.city ?? null,
      state: sl.state ?? null,
      postal_code: sl.postal_code ?? null,
      country: sl.country ?? null,
      phone: null,
      email: null,
      special_instructions: sl.special_instructions ?? null,
      contact: contactRes.rows[0] ?? null,
      equipment,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to get service location detail", "Failed to get service location detail", {
      logContext: { locationId },
    });
  }
});

// ── Placeholder jobs ──────────────────────────────────────────────────────────

const PLACEHOLDER_JOB_STATUSES = [
  "Reminder Letter Sent",
  "Quoted \u2013 No Purchase Order",
  "Have Purchase Order",
  "Have Credit Card",
  "Cash in Advance",
  "Credit Hold",
] as const;

const createPlaceholderJobSchema = z.object({
  technician_id: z.string().min(1),
  title: z.string().min(1),
  customer_name: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  service_location_id: z.string().nullable().optional(),
  color_index: z.number().int().min(0).max(15).nullable().optional(),
  start_time: z.string().min(1),
  end_time: z.string().min(1),
  notes: z.string().nullable().optional(),
  status: z.enum(PLACEHOLDER_JOB_STATUSES).nullable().optional(),
});

router.get("/wb/placeholder-jobs", requireLogin, async (req, res) => {
  const { start_date, end_date } = req.query as Record<string, string | undefined>;
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    // Overlap semantics: return any placeholder that intersects [start_date, end_date),
    // so multi-day placeholders that started before the window are still included.
    // Strict > so a placeholder ending exactly at midnight on start_date is excluded.
    if (start_date) {
      params.push(start_date);
      conditions.push(`end_time > $${params.length}::date`);
    }
    if (end_date) {
      params.push(end_date);
      conditions.push(`start_time < $${params.length}::date`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const r = await localPool.query(
      `SELECT id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at
       FROM crm.placeholder_jobs ${where} ORDER BY start_time`,
      params,
    );
    res.json(
      r.rows.map((row) => ({
        id: row.id,
        technician_id: row.technician_id,
        title: row.title,
        customer_name: row.customer_name ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        service_location_id: row.service_location_id ?? null,
        color_index: row.color_index ?? null,
        start_time: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
        end_time: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
        notes: row.notes ?? null,
        status: row.status ?? null,
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      })),
    );
  } catch (err) {
    handleWbError(req, res, err, "Failed to list placeholder jobs", "Failed to list placeholder jobs");
  }
});

router.get("/wb/search", requireLogin, async (req, res) => {
  const q = ((req.query.q as string | undefined) ?? "").trim();
  if (q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }
  const pattern = `%${q}%`;
  const today = new Date().toISOString().slice(0, 10);

  try {
    // 1a. Pre-fetch technician IDs whose name matches the query (best-effort, CRM only).
    //     Needed before 1b so potential jobs surface when searching by tech name.
    let matchingTechIds: string[] = [];
    if (isCrmConfigured()) {
      try {
        const techIdResult = await getCrmPool().query<{ technician_id: string }>(
          `SELECT bookableresourceid::text AS technician_id
           FROM crm.bookableresource
           WHERE name ILIKE $1
             AND COALESCE(is_deleted, false) = false`,
          [pattern],
        );
        matchingTechIds = techIdResult.rows.map((r) => r.technician_id);
      } catch {
        /* CRM unavailable — tech-name search for potential jobs degraded gracefully */
      }
    }

    // 1b + 2: potential jobs and CRM scheduled bookings run in parallel.
    type ScheduledRow = {
      booking_id: string;
      work_order_number: string | null;
      customer_name: string | null;
      city: string | null;
      state: string | null;
      technician_id: string | null;
      technician_name: string | null;
      start_time: Date | string;
    };

    const scheduledPromise: Promise<ScheduledRow[]> = isCrmConfigured()
      ? getCrmPool()
          .query<ScheduledRow>(
            `SELECT
               b.bookableresourcebookingid::text AS booking_id,
               wo.msdyn_name AS work_order_number,
               COALESCE(
                 acc.name,
                 wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
               ) AS customer_name,
               wo.msdyn_city AS city,
               wo.msdyn_stateorprovince AS state,
               b.resource::text AS technician_id,
               COALESCE(
                 br.name,
                 b.raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue'
               ) AS technician_name,
               b.starttime AS start_time
             FROM crm.booking b
             JOIN crm.workorder wo
               ON wo.msdyn_workorderid = b.msdyn_workorder
              AND COALESCE(wo.is_deleted, false) = false
             LEFT JOIN crm.account acc
               ON acc.accountid = wo.msdyn_serviceaccount
              AND COALESCE(acc.is_deleted, false) = false
             LEFT JOIN crm.bookableresource br
               ON br.bookableresourceid = b.resource
              AND COALESCE(br.is_deleted, false) = false
             WHERE b.starttime >= $1::date
               AND COALESCE(b.is_deleted, false) = false
               AND COALESCE(b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue', '') NOT ILIKE 'cancel%'
               AND (
                 wo.msdyn_name ILIKE $2 OR
                 COALESCE(acc.name, wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue') ILIKE $2 OR
                 wo.msdyn_city ILIKE $2 OR
                 wo.msdyn_stateorprovince ILIKE $2 OR
                 COALESCE(br.name, b.raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue') ILIKE $2
               )
             ORDER BY b.starttime ASC`,
            [today, pattern],
          )
          .then((r) => r.rows)
          .catch(() => [] as ScheduledRow[])
      : Promise.resolve([] as ScheduledRow[]);

    const phPromise = localPool.query<{
      id: number;
      technician_id: string | null;
      title: string | null;
      customer_name: string | null;
      city: string | null;
      state: string | null;
      status: string | null;
      start_time: Date | string;
    }>(
      `SELECT id, technician_id, title, customer_name, city, state, status, start_time
       FROM crm.placeholder_jobs
       WHERE end_time > $1::date
         AND (
           customer_name ILIKE $2 OR
           city ILIKE $2 OR
           state ILIKE $2 OR
           status ILIKE $2 OR
           title ILIKE $2 OR
           (cardinality($3::text[]) > 0 AND technician_id = ANY($3::text[]))
         )
       ORDER BY start_time ASC`,
      [today, pattern, matchingTechIds],
    );

    // 1c. Unscheduled CRM work orders (no booking yet).
    type UnscheduledSearchRow = {
      work_order_id: string;
      work_order_number: string | null;
      customer_name: string | null;
      city: string | null;
      state: string | null;
      due_date: string | null;
    };

    const unscheduledPromise: Promise<UnscheduledSearchRow[]> = isCrmConfigured()
      ? getCrmPool()
          .query<UnscheduledSearchRow>(
            `SELECT
               wo.msdyn_workorderid::text AS work_order_id,
               wo.msdyn_name              AS work_order_number,
               COALESCE(
                 acc.name,
                 wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
               )                          AS customer_name,
               wo.msdyn_city              AS city,
               wo.msdyn_stateorprovince   AS state,
               due.due_date::text         AS due_date
             FROM crm.workorder wo
             LEFT JOIN crm.account acc
               ON acc.accountid = wo.msdyn_serviceaccount
              AND COALESCE(acc.is_deleted, false) = false
             LEFT JOIN LATERAL (
               SELECT MIN(woce.cf_nextcalibrationdate) AS due_date
               FROM crm.cf_workordercustomerequipment woce
               WHERE woce.workorderid = wo.msdyn_workorderid
                 AND COALESCE(woce.is_deleted, false) = false
             ) due ON true
             WHERE wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' = 'Unscheduled'
               AND COALESCE(wo.is_deleted, false) = false
               AND (
                 wo.msdyn_name ILIKE $1 OR
                 COALESCE(acc.name, wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue') ILIKE $1 OR
                 wo.msdyn_city ILIKE $1 OR
                 wo.msdyn_stateorprovince ILIKE $1
               )
             ORDER BY due.due_date ASC NULLS LAST, wo.msdyn_name ASC`,
            [pattern],
          )
          .then((r) => r.rows)
          .catch(() => [] as UnscheduledSearchRow[])
      : Promise.resolve([] as UnscheduledSearchRow[]);

    const [phResult, scheduledRows, unscheduledRows] = await Promise.all([phPromise, scheduledPromise, unscheduledPromise]);

    // 3. Resolve technician names for potential jobs from CRM (best-effort)
    const phTechIds = [
      ...new Set(phResult.rows.map((r) => r.technician_id).filter((id): id is string => !!id)),
    ];
    const phTechNames = new Map<string, string>();
    if (phTechIds.length > 0 && isCrmConfigured()) {
      try {
        const tnResult = await getCrmPool().query<{ technician_id: string; resource_name: string | null }>(
          `SELECT bookableresourceid::text AS technician_id, name AS resource_name
           FROM crm.bookableresource
           WHERE bookableresourceid::text = ANY($1::text[])
             AND COALESCE(is_deleted, false) = false`,
          [phTechIds],
        );
        for (const row of tnResult.rows) {
          if (row.resource_name) phTechNames.set(row.technician_id, row.resource_name);
        }
      } catch {
        /* CRM unavailable — tech names omitted, not a fatal error */
      }
    }

    const toDateStr = (v: Date | string) =>
      (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);

    const results = [
      ...phResult.rows.map((row) => ({
        type: "potential" as const,
        id: String(row.id),
        work_order_number: null as string | null,
        customer_name: row.customer_name ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        technician_id: row.technician_id ?? null,
        technician_name: row.technician_id ? (phTechNames.get(row.technician_id) ?? null) : null,
        start_date: toDateStr(row.start_time),
      })),
      ...scheduledRows.map((row) => ({
        type: "scheduled" as const,
        id: row.booking_id,
        work_order_number: row.work_order_number ?? null,
        customer_name: row.customer_name ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        technician_id: row.technician_id ?? null,
        technician_name: row.technician_name ?? null,
        start_date: toDateStr(row.start_time),
      })),
      ...unscheduledRows.map((row) => ({
        type: "unscheduled" as const,
        id: row.work_order_id,
        work_order_number: row.work_order_number ?? null,
        customer_name: row.customer_name ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        technician_id: null as string | null,
        technician_name: null as string | null,
        start_date: row.due_date?.slice(0, 10) ?? today,
      })),
    ].sort((a, b) => a.start_date.localeCompare(b.start_date));

    res.json(results);
  } catch (err) {
    handleWbError(req, res, err, "Search failed", "Search failed");
  }
});

router.post("/wb/placeholder-jobs", requireRole("editor"), async (req, res) => {
  const parsed = createPlaceholderJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status } = parsed.data;
  try {
    const r = await localPool.query(
      `INSERT INTO crm.placeholder_jobs (technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at`,
      [technician_id, title, customer_name ?? null, city ?? null, state ?? null, service_location_id ?? null, color_index ?? null, start_time, end_time, notes ?? null, status ?? null],
    );
    const row = r.rows[0];
    void mirrorPlaceholderJobUpsert(req.log, row);
    res.status(201).json({
      id: row.id,
      technician_id: row.technician_id,
      title: row.title,
      customer_name: row.customer_name ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      service_location_id: row.service_location_id ?? null,
      color_index: row.color_index ?? null,
      start_time: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      end_time: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
      notes: row.notes ?? null,
      status: row.status ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to create placeholder job", "Failed to create placeholder job");
  }
});

const updatePlaceholderJobSchema = z
  .object({
    technician_id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    customer_name: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    service_location_id: z.string().nullable().optional(),
    color_index: z.number().int().min(0).max(15).nullable().optional(),
    start_time: z.string().min(1).optional(),
    end_time: z.string().min(1).optional(),
    notes: z.string().nullable().optional(),
    status: z.enum(PLACEHOLDER_JOB_STATUSES).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "No fields to update",
  });

router.patch("/wb/placeholder-jobs/:id", requireRole("editor"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid placeholder job id" });
    return;
  }
  const parsed = updatePlaceholderJobSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status } = parsed.data;
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (technician_id !== undefined) { sets.push(`technician_id = $${vals.push(technician_id)}`); }
    if (title !== undefined) { sets.push(`title = $${vals.push(title)}`); }
    if (customer_name !== undefined) { sets.push(`customer_name = $${vals.push(customer_name)}`); }
    if (city !== undefined) { sets.push(`city = $${vals.push(city)}`); }
    if (state !== undefined) { sets.push(`state = $${vals.push(state)}`); }
    if (service_location_id !== undefined) { sets.push(`service_location_id = $${vals.push(service_location_id)}`); }
    if (color_index !== undefined) { sets.push(`color_index = $${vals.push(color_index)}`); }
    if (start_time !== undefined) { sets.push(`start_time = $${vals.push(start_time)}`); }
    if (end_time !== undefined) { sets.push(`end_time = $${vals.push(end_time)}`); }
    if (notes !== undefined) { sets.push(`notes = $${vals.push(notes)}`); }
    if (status !== undefined) { sets.push(`status = $${vals.push(status)}`); }
    if (sets.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    vals.push(id);
    const r = await localPool.query(
      `UPDATE crm.placeholder_jobs SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at`,
      vals,
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Placeholder job not found" });
      return;
    }
    const row = r.rows[0];
    void mirrorPlaceholderJobUpsert(req.log, row);
    res.json({
      id: row.id,
      technician_id: row.technician_id,
      title: row.title,
      customer_name: row.customer_name ?? null,
      city: row.city ?? null,
      state: row.state ?? null,
      service_location_id: row.service_location_id ?? null,
      color_index: row.color_index ?? null,
      start_time: row.start_time instanceof Date ? row.start_time.toISOString() : row.start_time,
      end_time: row.end_time instanceof Date ? row.end_time.toISOString() : row.end_time,
      notes: row.notes ?? null,
      status: row.status ?? null,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to update placeholder job", "Failed to update placeholder job");
  }
});

router.delete("/wb/placeholder-jobs/:id", requireRole("editor"), async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid placeholder job id" });
    return;
  }
  try {
    const r = await localPool.query(
      `DELETE FROM crm.placeholder_jobs WHERE id = $1 RETURNING id`,
      [id],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: "Placeholder job not found" });
      return;
    }
    void mirrorPlaceholderJobDelete(req.log, id);
    res.status(204).send();
  } catch (err) {
    handleWbError(req, res, err, "Failed to delete placeholder job", "Failed to delete placeholder job");
  }
});

router.get("/wb/writebacks", requireLogin, async (req, res) => {
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

router.delete("/wb/writebacks/queued", requireRole("editor"), async (req, res) => {
  try {
    const r = await localPool.query<{ count: string }>(
      `DELETE FROM booking_writebacks WHERE status = 'queued' RETURNING id`,
    );
    res.json({ deleted: r.rowCount ?? 0 });
  } catch (err) {
    handleWbError(req, res, err, "Failed to reset queued write-backs", "Failed to reset queued write-backs", { source: "mixed" });
  }
});

router.get("/wb/technicians", requireLogin, async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  try {
    // Source from crm.bookableresource, but also include resources referenced by
    // bookings (with their formatted name from raw_json) so the reassign dropdown
    // remains usable while crm.bookableresource is sparse/empty.
    const r = await getCrmPool().query<{ technician_id: string; resource_name: string | null }>(
      `SELECT bookableresourceid::text AS technician_id, name AS resource_name
       FROM crm.bookableresource br
       JOIN crm.systemuser su ON su.systemuserid = br.userid
       WHERE COALESCE(br.is_deleted, false) = false
         AND COALESCE(su.is_deleted, false) = false
         AND COALESCE(su.isdisabled, false) = false
         AND COALESCE(br.msdyn_displayonscheduleassistant, false) = true
       ORDER BY name ASC NULLS LAST`,
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

router.get("/wb/schedule-board", requireLogin, async (req, res) => {
  const viewRaw = (req.query.view as string | undefined) ?? "week";
  const view: "week" | "month" | "stacked" =
    viewRaw === "month" ? "month" : viewRaw === "stacked" ? "stacked" : "week";

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
  } else if (view === "stacked") {
    // Align to the Monday of the given week, then span 12 weeks (84 days).
    const dow = seed.getUTCDay();
    const daysToMon = dow === 0 ? -6 : 1 - dow;
    start = new Date(seed);
    start.setUTCDate(start.getUTCDate() + daysToMon);
    endDate = new Date(start);
    endDate.setUTCDate(endDate.getUTCDate() + 182); // 26 weeks
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
    const viewerEmail = req.session.user?.email?.trim() ?? null;
    const coordinatorDefault = await getCoordinatorDefault(getCrmPool(), viewerEmail ?? undefined);

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
        AND COALESCE(br.msdyn_displayonscheduleassistant, false) = true
      `,
    );
    const activeResourceIds = new Set(activeResResult.rows.map((r) => r.bookableresourceid));

    // ── Service-location mode ─────────────────────────────────────────────────
    // Group by the JOB's service territory (R1, R2, R3 …) — the same region labels
    // as tech-region mode, but the territory is resolved from the work order's
    // service location (cf_servicelocation.cf_serviceterritory) with fallback to
    // the work order's own msdyn_serviceterritory.
    //
    // This lets a coordinator filter by region and see ALL jobs in their territory
    // regardless of which technician's home region performed the work.
    //
    // Crucially, a single technician can appear in MULTIPLE territory groups: their
    // swimlane appears under R1 for jobs located in R1, and separately under R2 for
    // any jobs whose service location falls in R2.  Idle-tech rows are omitted —
    // a job territory cannot be determined without an actual booking.
    if (groupBy === "service-location") {
      const locResult = await getCrmPool().query(
        `
        WITH active_res AS (
          SELECT br.bookableresourceid
          FROM crm.bookableresource br
          JOIN crm.systemuser su ON su.systemuserid = br.userid
          WHERE COALESCE(br.is_deleted, false) = false
            AND COALESCE(su.is_deleted, false) = false
            AND COALESCE(su.isdisabled, false) = false
            AND COALESCE(br.msdyn_displayonscheduleassistant, false) = true
        )
        SELECT
          ter.territoryid::text    AS region_id,
          ter.name                 AS region,
          b.bookableresourcebookingid AS booking_id,
          b.resource               AS resource_id,
          b.starttime              AS start_time,
          b.endtime                AS end_time,
          b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue' AS booking_status,
          wo.msdyn_workorderid::text AS work_order_id,
          wo.msdyn_name            AS work_order_number,
          COALESCE(
            wo.new_customerrequirement,
            wo.raw_json->>'_msdyn_workordertype_value@OData.Community.Display.V1.FormattedValue'
          )                        AS title,
          wo.raw_json->>'msdyn_systemstatus@OData.Community.Display.V1.FormattedValue' AS system_status,
          wo.msdyn_city            AS city,
          wo.msdyn_stateorprovince AS state,
          COALESCE(
            acc.name,
            wo.raw_json->>'_msdyn_serviceaccount_value@OData.Community.Display.V1.FormattedValue'
          )                        AS customer_name,
          COALESCE(br.name, b.raw_json->>'_resource_value@OData.Community.Display.V1.FormattedValue') AS resource_name,
          COALESCE(
            NULLIF(BTRIM(br.msdyn_primaryemail), ''),
            NULLIF(BTRIM(su.internalemailaddress), ''),
            NULLIF(BTRIM(su.domainname), '')
          )                        AS user_email,
          eq.equipment_names
        FROM crm.booking b
        JOIN crm.workorder wo
          ON wo.msdyn_workorderid = b.msdyn_workorder
         AND COALESCE(wo.is_deleted, false) = false
        -- Join service location to get its territory; LEFT so bookings without a
        -- service location still participate (they fall back to wo.msdyn_serviceterritory).
        LEFT JOIN crm.cf_servicelocation sl
          ON sl.cf_servicelocationid = wo.cf_servicelocation
         AND COALESCE(sl.is_deleted, false) = false
        LEFT JOIN crm.account acc
          ON acc.accountid = wo.msdyn_serviceaccount
         AND COALESCE(acc.is_deleted, false) = false
        LEFT JOIN crm.bookableresource br
          ON br.bookableresourceid = b.resource
         AND COALESCE(br.is_deleted, false) = false
         LEFT JOIN crm.systemuser su
           ON su.systemuserid = br.userid
          AND COALESCE(su.is_deleted, false) = false
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
        -- Inner join on territory so bookings with no determinable region are excluded.
        -- Territory resolution: service-location territory → work-order service territory.
        JOIN crm.territory ter
          ON ter.territoryid = COALESCE(sl.cf_serviceterritory, wo.msdyn_serviceterritory)
         AND COALESCE(ter.is_deleted, false) = false
        WHERE b.starttime >= $1::date
          AND b.starttime <  $2::date
          AND COALESCE(b.is_deleted, false) = false
          AND b.resource IN (SELECT bookableresourceid FROM active_res)
          AND COALESCE(b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue', '') NOT ILIKE 'cancel%'
        ORDER BY ter.name ASC, resource_name ASC, b.starttime ASC NULLS LAST
        `,
        [rangeStart, rangeEnd],
      );

      // Build a name/email lookup so overlay reassignments can show the new tech's
      // display name rather than the original tech's name.
      const locTechNameMap = new Map<string, { resource_name: string | null; user_email: string | null }>();
      for (const row of locResult.rows) {
        if (row.resource_id && !locTechNameMap.has(row.resource_id as string)) {
          locTechNameMap.set(row.resource_id as string, {
            resource_name: row.resource_name as string | null,
            user_email: row.user_email as string | null,
          });
        }
      }

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
      // keyed by territory uuid
      type LocRegionRow = { regionid_id: string; region: string; company: null; technicians: Map<string, LocTechRow> };

      const locMap = new Map<string, LocRegionRow>();
      const rangeStartMs = start.getTime();
      const maxDayIndex = dayCount - 1;

      for (const row of locResult.rows) {
        if (!row.booking_id || !row.start_time || !row.region_id) continue;

        const overlay = locOverlayByBooking.get(row.booking_id as string);
        const effStart = overlay?.start_time ?? row.start_time;
        const effEnd = overlay?.end_time ?? row.end_time;

        // Region key is the job's territory UUID — consistent with tech-region regionid_id
        // so the same Filter Regions selection works for both modes.
        const regionId = row.region_id as string;
        const regionName = row.region as string;

        // Only honor an overlay reassignment to an active resource; otherwise keep
        // the booking on its original (already active-filtered) resource.
        const overlayTechId =
          overlay?.technician_id && activeResourceIds.has(overlay.technician_id)
            ? overlay.technician_id
            : null;
        const techId = (overlayTechId ?? row.resource_id) as string | null;
        if (!techId) continue;

        // Resolve tech display name — use the overlay tech's info when reassigned.
        const techLookup = locTechNameMap.get(techId);
        const techName = techLookup?.resource_name ?? (row.resource_name as string | null);
        const userEmail = techLookup?.user_email ?? (row.user_email as string | null);

        if (!locMap.has(regionId)) {
          locMap.set(regionId, { regionid_id: regionId, region: regionName, company: null, technicians: new Map() });
        }
        const loc = locMap.get(regionId)!;
        // The same tech appearing under multiple territories is the intended behaviour:
        // each territory gets its own tech swimlane for that tech's jobs in that area.
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

      // Idle technicians (no bookings anywhere in the current range) cannot be
      // placed by job location, since there is no job to derive one from. Fall
      // back to their home region — the territory on their own Technician
      // record (crm.msdyn_resourceterritory) — so they still render an empty
      // swimlane instead of disappearing from this view (parity with the
      // tech-region mode's idle-row behavior).
      const idleLocResult = await getCrmPool().query(
        `
        WITH active_res AS (
          SELECT br.bookableresourceid
          FROM crm.bookableresource br
          JOIN crm.systemuser su ON su.systemuserid = br.userid
          WHERE COALESCE(br.is_deleted, false) = false
            AND COALESCE(su.is_deleted, false) = false
            AND COALESCE(su.isdisabled, false) = false
            AND COALESCE(br.msdyn_displayonscheduleassistant, false) = true
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
        )
        SELECT
          ter.territoryid::text AS region_id,
          ter.name              AS region,
          br.bookableresourceid::text AS technician_id,
          br.name               AS resource_name,
          COALESCE(
            NULLIF(BTRIM(br.msdyn_primaryemail), ''),
            NULLIF(BTRIM(su.internalemailaddress), ''),
            NULLIF(BTRIM(su.domainname), '')
          ) AS user_email
        FROM res_terr rt
        JOIN crm.territory ter ON ter.territoryid = rt.territory_id
        JOIN crm.bookableresource br
          ON br.bookableresourceid = rt.resource_id
         AND COALESCE(br.is_deleted, false) = false
        LEFT JOIN crm.systemuser su
          ON su.systemuserid = br.userid
         AND COALESCE(su.is_deleted, false) = false
        WHERE rt.resource_id IN (SELECT bookableresourceid FROM active_res)
          AND NOT EXISTS (
            SELECT 1 FROM crm.booking b
            WHERE b.resource = rt.resource_id
              AND b.starttime >= $1::date
              AND b.starttime <  $2::date
              AND COALESCE(b.is_deleted, false) = false
          )
        `,
        [rangeStart, rangeEnd],
      );

      for (const row of idleLocResult.rows) {
        const regionId = row.region_id as string;
        const techId = row.technician_id as string;
        if (!locMap.has(regionId)) {
          locMap.set(regionId, {
            regionid_id: regionId,
            region: row.region as string,
            company: null,
            technicians: new Map(),
          });
        }
        const loc = locMap.get(regionId)!;
        if (!loc.technicians.has(techId)) {
          loc.technicians.set(techId, {
            technician_id: techId,
            resource_name: row.resource_name as string | null,
            user_email: row.user_email as string | null,
            jobs: [],
          });
        }
      }

      const locRegions = Array.from(locMap.values())
        .sort((a, b) => a.region.localeCompare(b.region))
        .map((loc) => ({
          regionid_id: loc.regionid_id,
          region: loc.region,
          company: loc.company,
          technicians: Array.from(loc.technicians.values()).sort((a, b) =>
            (a.resource_name ?? "").localeCompare(b.resource_name ?? ""),
          ),
        }));

      res.json({
        view,
        group_by: "service-location",
        viewer_email: viewerEmail,
        coordinator_default: coordinatorDefault,
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
        -- Only bookable resources linked to an enabled (active) system user
        -- that are flagged for display on the schedule assistant.
        SELECT br.bookableresourceid
        FROM crm.bookableresource br
        JOIN crm.systemuser su ON su.systemuserid = br.userid
        WHERE COALESCE(br.is_deleted, false) = false
          AND COALESCE(su.is_deleted, false) = false
          AND COALESCE(su.isdisabled, false) = false
          AND COALESCE(br.msdyn_displayonscheduleassistant, false) = true
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
          AND COALESCE(b.raw_json->>'_bookingstatus_value@OData.Community.Display.V1.FormattedValue', '') NOT ILIKE 'cancel%'
      )
      SELECT
        ter.territoryid::text                        AS regionid_id,
        ter.name                                     AS region,
        COALESCE(br.bookableresourceid::text, bk.resource_id::text) AS technician_id,
        COALESCE(
          br.name,
          bk.b_raw->>'_resource_value@OData.Community.Display.V1.FormattedValue'
        )                                            AS resource_name,
        COALESCE(
          NULLIF(BTRIM(br.msdyn_primaryemail), ''),
          NULLIF(BTRIM(su.internalemailaddress), ''),
          NULLIF(BTRIM(su.domainname), '')
        )                                            AS user_email,
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
      LEFT JOIN crm.systemuser su
        ON su.systemuserid = br.userid
       AND COALESCE(su.is_deleted, false) = false
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
        COALESCE(
          NULLIF(BTRIM(br.msdyn_primaryemail), ''),
          NULLIF(BTRIM(su.internalemailaddress), ''),
          NULLIF(BTRIM(su.domainname), '')
        )                                            AS user_email,
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
      LEFT JOIN crm.systemuser su
        ON su.systemuserid = br.userid
       AND COALESCE(su.is_deleted, false) = false
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
      viewer_email: viewerEmail,
      coordinator_default: coordinatorDefault,
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

router.get("/wb/unscheduled-jobs", requireLogin, async (req, res) => {
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

router.get("/wb/resource-utilization", requireLogin, async (req, res) => {
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
        /** Portion of utilized_minutes contributed by placeholder (potential) jobs. */
        placeholder_minutes: number;
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
        placeholder_minutes: 0,
        capacity_minutes: capacityMinutes,
        utilization_pct: capacityMinutes
          ? Math.round((row.utilized_minutes / capacityMinutes) * 1000) / 10
          : 0,
        job_count: row.job_count,
      });
    }

    // Placeholder (speculative, not-yet-confirmed) jobs count toward capacity
    // just like real bookings, using the same per-day 8h cap. They live in the
    // local Postgres DB (not CRM), so they're merged in here after the CRM query.
    const placeholderResult = await localPool.query(
      `SELECT technician_id, start_time, end_time FROM crm.placeholder_jobs
       WHERE start_time < $2::date AND end_time > $1::date`,
      [rangeStart, rangeEnd],
    );
    const placeholderMinutesByTech = new Map<string, { minutes: number; count: number }>();
    for (const row of placeholderResult.rows) {
      const techId = row.technician_id as string;
      const jobStart = row.start_time instanceof Date ? row.start_time : new Date(row.start_time);
      const jobEnd = row.end_time instanceof Date ? row.end_time : new Date(row.end_time);
      const winStart = new Date(rangeStart + "T00:00:00Z");
      const winEnd = new Date(rangeEnd + "T00:00:00Z");
      let minutes = 0;
      // Iterate each calendar day the placeholder job spans within the window.
      const clampedStart = new Date(Math.max(jobStart.getTime(), winStart.getTime()));
      const clampedEndExclusive = new Date(Math.min(jobEnd.getTime(), winEnd.getTime()));
      let cursor = new Date(
        Date.UTC(clampedStart.getUTCFullYear(), clampedStart.getUTCMonth(), clampedStart.getUTCDate()),
      );
      while (cursor.getTime() < clampedEndExclusive.getTime()) {
        const dayEnd = new Date(cursor.getTime() + 86_400_000);
        const segStart = Math.max(cursor.getTime(), clampedStart.getTime());
        const segEnd = Math.min(dayEnd.getTime(), clampedEndExclusive.getTime());
        const segMinutes = Math.max(0, (segEnd - segStart) / 60000);
        minutes += Math.min(segMinutes, WB_WORKING_MINUTES_PER_DAY);
        cursor = dayEnd;
      }
      const cur = placeholderMinutesByTech.get(techId) ?? { minutes: 0, count: 0 };
      cur.minutes += minutes;
      cur.count += 1;
      placeholderMinutesByTech.set(techId, cur);
    }
    if (placeholderMinutesByTech.size > 0) {
      for (const rg of regionMap.values()) {
        for (const tech of rg.technicians) {
          const ph = placeholderMinutesByTech.get(tech.technician_id);
          if (!ph) continue;
          tech.utilized_minutes += Math.round(ph.minutes);
          tech.placeholder_minutes = Math.round(ph.minutes);
          tech.job_count += ph.count;
          tech.utilization_pct = tech.capacity_minutes
            ? Math.round((tech.utilized_minutes / tech.capacity_minutes) * 1000) / 10
            : 0;
        }
      }
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
router.get("/wb/jobs-by-region", requireLogin, async (req, res) => {
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
        COALESCE(
          NULLIF(BTRIM(br.msdyn_primaryemail), ''),
          NULLIF(BTRIM(su.internalemailaddress), ''),
          NULLIF(BTRIM(su.domainname), '')
        )                                            AS user_email,
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
      LEFT JOIN crm.systemuser su
        ON su.systemuserid = br.userid
       AND COALESCE(su.is_deleted, false) = false

      UNION ALL

      SELECT
        ter.territoryid::text                        AS regionid_id,
        ter.name                                     AS region,
        br.bookableresourceid::text                  AS technician_id,
        br.name                                      AS resource_name,
        COALESCE(
          NULLIF(BTRIM(br.msdyn_primaryemail), ''),
          NULLIF(BTRIM(su.internalemailaddress), ''),
          NULLIF(BTRIM(su.domainname), '')
        )                                            AS user_email,
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
      LEFT JOIN crm.systemuser su
        ON su.systemuserid = br.userid
       AND COALESCE(su.is_deleted, false) = false
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
router.get("/wb/reports/filters", requireLogin, async (req, res) => {
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
router.get("/wb/reports/completed-not-approved", requireLogin, async (req, res) => {
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
router.get("/wb/reports/approved-not-invoiced", requireLogin, async (req, res) => {
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
router.get("/wb/reports/weekly-approved", requireLogin, async (req, res) => {
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

router.post("/wb/sync", requireRole("editor"), async (req, res) => {
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

// ---------------------------------------------------------------------------
// Admin: compare Replit source-of-truth tables with the CRM mirror and upsert
// any rows that are missing or different. Safe to run multiple times (idempotent).
// GET /wb/admin/sync-mirror?dry_run=true  — report only, no writes
// POST /wb/admin/sync-mirror              — compare + upsert divergent rows
// ---------------------------------------------------------------------------
router.get("/wb/admin/sync-mirror", requireLogin, async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "CRM database not configured (D365CRM_DATABASE_URL missing)" });
    return;
  }
  try {
    const crmPool = getCrmPool();

    // Fetch all rows from both source tables
    const [pjSource, sbSource, pjMirrorIds, sbMirrorIds] = await Promise.all([
      localPool.query<{ id: number; technician_id: string; title: string; customer_name: string | null; city: string | null; state: string | null; service_location_id: string | null; color_index: number | null; start_time: Date; end_time: Date; notes: string | null; status: string | null; created_at: Date }>(
        `SELECT id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at FROM crm.placeholder_jobs ORDER BY id`
      ),
      localPool.query<{ id: number; technician_id: string; block_type: string; title: string | null; start_time: Date; end_time: Date; notes: string | null; color_index: number | null; created_at: Date }>(
        `SELECT id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at FROM crm.schedule_blocks ORDER BY id`
      ),
      crmPool.query<{ id: number }>(`SELECT id FROM crm.placeholder_jobs`),
      crmPool.query<{ id: number }>(`SELECT id FROM crm.schedule_blocks`),
    ]);

    const mirrorPjIds = new Set(pjMirrorIds.rows.map((r) => r.id));
    const mirrorSbIds = new Set(sbMirrorIds.rows.map((r) => r.id));

    const pjMissing = pjSource.rows.filter((r) => !mirrorPjIds.has(r.id));
    const sbMissing = sbSource.rows.filter((r) => !mirrorSbIds.has(r.id));

    res.json({
      placeholder_jobs: {
        source_count: pjSource.rows.length,
        mirror_count: pjMirrorIds.rows.length,
        missing_in_mirror: pjMissing.length,
        missing_ids: pjMissing.map((r) => r.id),
      },
      schedule_blocks: {
        source_count: sbSource.rows.length,
        mirror_count: sbMirrorIds.rows.length,
        missing_in_mirror: sbMissing.length,
        missing_ids: sbMissing.map((r) => r.id),
      },
      action: "Use POST /wb/admin/sync-mirror to upsert all missing rows",
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to compare mirror tables", "Failed to compare mirror tables");
  }
});

router.post("/wb/admin/sync-mirror", requireRole("editor"), async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "CRM database not configured (D365CRM_DATABASE_URL missing)" });
    return;
  }
  try {
    const crmPool = getCrmPool();

    // Fetch all rows from Replit source-of-truth
    const [pjSource, sbSource] = await Promise.all([
      localPool.query<{ id: number; technician_id: string; title: string; customer_name: string | null; city: string | null; state: string | null; service_location_id: string | null; color_index: number | null; start_time: Date; end_time: Date; notes: string | null; status: string | null; created_at: Date }>(
        `SELECT id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at FROM crm.placeholder_jobs ORDER BY id`
      ),
      localPool.query<{ id: number; technician_id: string; block_type: string; title: string | null; start_time: Date; end_time: Date; notes: string | null; color_index: number | null; created_at: Date }>(
        `SELECT id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at FROM crm.schedule_blocks ORDER BY id`
      ),
    ]);

    // Upsert all rows from both tables into crm mirror (idempotent — ON CONFLICT DO UPDATE)
    let pjUpserted = 0;
    let pjErrors = 0;
    for (const row of pjSource.rows) {
      try {
        await crmPool.query(
          `INSERT INTO crm.placeholder_jobs
             (id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             technician_id = EXCLUDED.technician_id,
             title = EXCLUDED.title,
             customer_name = EXCLUDED.customer_name,
             city = EXCLUDED.city,
             state = EXCLUDED.state,
             service_location_id = EXCLUDED.service_location_id,
             color_index = EXCLUDED.color_index,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             notes = EXCLUDED.notes,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at`,
          [row.id, row.technician_id, row.title, row.customer_name ?? null, row.city ?? null, row.state ?? null, row.service_location_id ?? null, row.color_index ?? null, row.start_time, row.end_time, row.notes ?? null, row.status ?? null, row.created_at],
        );
        pjUpserted++;
      } catch (e) {
        pjErrors++;
        req.log.warn({ err: e, id: row.id }, "sync-mirror: placeholder_jobs upsert failed");
      }
    }

    let sbUpserted = 0;
    let sbErrors = 0;
    for (const row of sbSource.rows) {
      try {
        await crmPool.query(
          `INSERT INTO crm.schedule_blocks
             (id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             technician_id = EXCLUDED.technician_id,
             block_type = EXCLUDED.block_type,
             title = EXCLUDED.title,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             notes = EXCLUDED.notes,
             color_index = EXCLUDED.color_index,
             created_at = EXCLUDED.created_at`,
          [row.id, row.technician_id, row.block_type, row.title ?? null, row.start_time, row.end_time, row.notes ?? null, row.color_index ?? null, row.created_at],
        );
        sbUpserted++;
      } catch (e) {
        sbErrors++;
        req.log.warn({ err: e, id: row.id }, "sync-mirror: schedule_blocks upsert failed");
      }
    }

    // Verify post-sync counts
    const [pjMirrorCount, sbMirrorCount] = await Promise.all([
      crmPool.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm.placeholder_jobs`),
      crmPool.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM crm.schedule_blocks`),
    ]);

    res.json({
      placeholder_jobs: {
        source_count: pjSource.rows.length,
        upserted: pjUpserted,
        errors: pjErrors,
        mirror_count_after: Number(pjMirrorCount.rows[0]?.cnt ?? 0),
        in_sync: pjErrors === 0 && Number(pjMirrorCount.rows[0]?.cnt ?? 0) >= pjSource.rows.length,
      },
      schedule_blocks: {
        source_count: sbSource.rows.length,
        upserted: sbUpserted,
        errors: sbErrors,
        mirror_count_after: Number(sbMirrorCount.rows[0]?.cnt ?? 0),
        in_sync: sbErrors === 0 && Number(sbMirrorCount.rows[0]?.cnt ?? 0) >= sbSource.rows.length,
      },
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to sync mirror tables", "Failed to sync mirror tables");
  }
});

// ---------------------------------------------------------------------------
// Admin: back-fill one or more work orders (and their bookings) from Dynamics
// directly into the CRM mirror.  Use when the incremental sync misses a record
// due to a window-boundary gap or other transient issue.
//
// POST /wb/admin/backfill-from-dynamics
//   Body: { woNames: string[] }   e.g. { woNames: ["839247"] }
//
// Idempotent — uses ON CONFLICT DO UPDATE so re-running never creates duplicates.
// ---------------------------------------------------------------------------
const backfillSchema = z.object({
  woNames: z.array(z.string().trim().min(1)).min(1).max(50),
});

type MissingBackfillDependency = {
  field: string;
  id: string;
  table: string;
};

async function findMissingWorkOrderDependencies(
  crmPool: ReturnType<typeof getCrmPool>,
  wo: Awaited<ReturnType<typeof fetchWorkOrdersByName>>[number],
): Promise<MissingBackfillDependency[]> {
  const checks = [
    {
      field: "msdyn_serviceterritory",
      id: wo.msdyn_serviceterritory,
      table: "crm.territory",
      query: "SELECT EXISTS (SELECT 1 FROM crm.territory WHERE territoryid = $1::uuid) AS exists",
    },
    {
      field: "msdyn_serviceaccount",
      id: wo.msdyn_serviceaccount,
      table: "crm.account",
      query: "SELECT EXISTS (SELECT 1 FROM crm.account WHERE accountid = $1::uuid) AS exists",
    },
    {
      field: "cf_servicelocation",
      id: wo.cf_servicelocation,
      table: "crm.cf_servicelocation",
      query: "SELECT EXISTS (SELECT 1 FROM crm.cf_servicelocation WHERE cf_servicelocationid = $1::uuid) AS exists",
    },
  ];
  const missing: MissingBackfillDependency[] = [];

  for (const check of checks) {
    if (!check.id) continue;
    const result = await crmPool.query<{ exists: boolean }>(check.query, [check.id]);
    if (!result.rows[0]?.exists) {
      missing.push({ field: check.field, id: check.id, table: check.table });
    }
  }

  return missing;
}

async function findMissingBookingDependencies(
  crmPool: ReturnType<typeof getCrmPool>,
  booking: Awaited<ReturnType<typeof fetchBookingsForWorkOrders>>[number],
): Promise<MissingBackfillDependency[]> {
  const checks = [
    {
      field: "resource",
      id: booking.resource,
      table: "crm.bookableresource",
      query: "SELECT EXISTS (SELECT 1 FROM crm.bookableresource WHERE bookableresourceid = $1::uuid) AS exists",
    },
    {
      field: "bookingstatus",
      id: booking.bookingstatus,
      table: "crm.bookingstatus",
      query: "SELECT EXISTS (SELECT 1 FROM crm.bookingstatus WHERE bookingstatusid = $1::uuid) AS exists",
    },
  ];
  const missing: MissingBackfillDependency[] = [];

  for (const check of checks) {
    if (!check.id) continue;
    const result = await crmPool.query<{ exists: boolean }>(check.query, [check.id]);
    if (!result.rows[0]?.exists) {
      missing.push({ field: check.field, id: check.id, table: check.table });
    }
  }

  return missing;
}

router.post("/wb/admin/backfill-from-dynamics", requireRole("editor"), async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "CRM database not configured (D365CRM_DATABASE_URL missing)" });
    return;
  }
  if (!isDataverseConfigured()) {
    res.status(503).json({ error: "Dataverse not configured (TENANT_ID / CLIENT_ID / CLIENT_SECRET / DATAVERSE_URL missing)" });
    return;
  }

  const parsed = backfillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { woNames } = parsed.data;

  try {
    const crmPool = getCrmPool();

    // 1. Fetch work orders from Dynamics
    const workOrders = await fetchWorkOrdersByName(woNames);
    const foundNames = workOrders.map((wo) => wo.msdyn_name);
    const notFound = woNames.filter((n) => !foundNames.includes(n));

    // 2. Upsert each work order into crm.workorder
    const woResults: Array<{
      woName: string;
      woId: string;
      status: "upserted" | "failed";
      missing_dependencies?: MissingBackfillDependency[];
      error?: string;
    }> = [];
    for (const wo of workOrders) {
      try {
        const missingDependencies = await findMissingWorkOrderDependencies(crmPool, wo);
        const missingFields = new Set(missingDependencies.map((dependency) => dependency.field));
        if (missingDependencies.length > 0) {
          req.log.warn(
            { woName: wo.msdyn_name, woId: wo.msdyn_workorderid, missingDependencies },
            "backfill: work order has missing CRM dependencies; nulling unavailable foreign keys",
          );
        }
        await crmPool.query(
          `INSERT INTO crm.workorder (
             msdyn_workorderid, msdyn_name, msdyn_systemstatus,
             msdyn_serviceterritory, msdyn_serviceaccount, cf_servicelocation,
             msdyn_workordertype, msdyn_city, msdyn_stateorprovince,
             new_customerrequirement, ownerid,
             createdon, modifiedon, is_deleted, synced_on, raw_json
           ) VALUES (
             $1::uuid, $2, $3,
             $4::uuid, $5::uuid, $6::uuid,
             $7::uuid, $8, $9,
             $10, $11::uuid,
             $12::timestamptz, $13::timestamptz, false, now(), $14::jsonb
           )
           ON CONFLICT (msdyn_workorderid) DO UPDATE SET
             msdyn_name              = EXCLUDED.msdyn_name,
             msdyn_systemstatus      = EXCLUDED.msdyn_systemstatus,
             msdyn_serviceterritory  = EXCLUDED.msdyn_serviceterritory,
             msdyn_serviceaccount    = EXCLUDED.msdyn_serviceaccount,
             cf_servicelocation      = EXCLUDED.cf_servicelocation,
             msdyn_workordertype     = EXCLUDED.msdyn_workordertype,
             msdyn_city              = EXCLUDED.msdyn_city,
             msdyn_stateorprovince   = EXCLUDED.msdyn_stateorprovince,
             new_customerrequirement = EXCLUDED.new_customerrequirement,
             ownerid                 = EXCLUDED.ownerid,
             modifiedon              = EXCLUDED.modifiedon,
             is_deleted              = false,
             synced_on               = now(),
             raw_json                = EXCLUDED.raw_json`,
          [
            wo.msdyn_workorderid, wo.msdyn_name, wo.msdyn_systemstatus,
            missingFields.has("msdyn_serviceterritory") ? null : wo.msdyn_serviceterritory,
            missingFields.has("msdyn_serviceaccount") ? null : wo.msdyn_serviceaccount,
            missingFields.has("cf_servicelocation") ? null : wo.cf_servicelocation,
            wo.msdyn_workordertype, wo.msdyn_city, wo.msdyn_stateorprovince,
            wo.new_customerrequirement, wo.ownerid,
            wo.createdon, wo.modifiedon, JSON.stringify(wo.rawJson),
          ],
        );
        woResults.push({
          woName: wo.msdyn_name,
          woId: wo.msdyn_workorderid,
          status: "upserted",
          ...(missingDependencies.length > 0 ? { missing_dependencies: missingDependencies } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        req.log.error({ err: e, woName: wo.msdyn_name }, "backfill: workorder upsert failed");
        woResults.push({ woName: wo.msdyn_name, woId: wo.msdyn_workorderid, status: "failed", error: msg });
      }
    }

    // 3. Fetch and upsert bookings for successfully upserted WOs
    const upsertedWoIds = workOrders
      .filter((wo) => woResults.find((r) => r.woId === wo.msdyn_workorderid)?.status === "upserted")
      .map((wo) => wo.msdyn_workorderid);

    const bookings = await fetchBookingsForWorkOrders(upsertedWoIds);
    const bookingResults: Array<{
      bookingId: string;
      woName: string;
      status: "upserted" | "failed";
      missing_dependencies?: MissingBackfillDependency[];
      error?: string;
    }> = [];

    for (const b of bookings) {
      const woName = workOrders.find((wo) => wo.msdyn_workorderid === b.msdyn_workorder)?.msdyn_name ?? "?";
      try {
        const missingDependencies = await findMissingBookingDependencies(crmPool, b);
        const missingFields = new Set(missingDependencies.map((dependency) => dependency.field));
        if (missingDependencies.length > 0) {
          req.log.warn(
            { bookingId: b.bookableresourcebookingid, woName, missingDependencies },
            "backfill: booking has missing CRM dependencies; nulling unavailable foreign keys",
          );
        }
        await crmPool.query(
          `INSERT INTO crm.booking (
             bookableresourcebookingid, name, starttime, endtime, duration,
             resource, bookingstatus, msdyn_workorder,
             msdyn_actualarrivaltime, msdyn_actualtravelduration, msdyn_estimatedtravelduration,
             cf_actualarrivaltime, cf_endtime, cf_durationschedule, cf_duration,
             cf_fieldnotes, cf_internalfieldnotes,
             createdon, modifiedon, is_deleted, synced_on, raw_json
           ) VALUES (
             $1::uuid, $2, $3::timestamptz, $4::timestamptz, $5,
             $6::uuid, $7::uuid, $8::uuid,
             $9::timestamptz, $10, $11,
             $12, $13, $14, $15,
             $16, $17,
             $18::timestamptz, $19::timestamptz, false, now(), $20::jsonb
           )
           ON CONFLICT (bookableresourcebookingid) DO UPDATE SET
             name                          = EXCLUDED.name,
             starttime                     = EXCLUDED.starttime,
             endtime                       = EXCLUDED.endtime,
             duration                      = EXCLUDED.duration,
             resource                      = EXCLUDED.resource,
             bookingstatus                 = EXCLUDED.bookingstatus,
             msdyn_workorder               = EXCLUDED.msdyn_workorder,
             msdyn_actualarrivaltime       = EXCLUDED.msdyn_actualarrivaltime,
             msdyn_actualtravelduration    = EXCLUDED.msdyn_actualtravelduration,
             msdyn_estimatedtravelduration = EXCLUDED.msdyn_estimatedtravelduration,
             cf_actualarrivaltime          = EXCLUDED.cf_actualarrivaltime,
             cf_endtime                    = EXCLUDED.cf_endtime,
             cf_durationschedule           = EXCLUDED.cf_durationschedule,
             cf_duration                   = EXCLUDED.cf_duration,
             cf_fieldnotes                 = EXCLUDED.cf_fieldnotes,
             cf_internalfieldnotes         = EXCLUDED.cf_internalfieldnotes,
             modifiedon                    = EXCLUDED.modifiedon,
             is_deleted                    = false,
             synced_on                     = now(),
             raw_json                      = EXCLUDED.raw_json`,
          [
            b.bookableresourcebookingid, b.name, b.starttime, b.endtime, b.duration,
            missingFields.has("resource") ? null : b.resource,
            missingFields.has("bookingstatus") ? null : b.bookingstatus,
            b.msdyn_workorder,
            b.msdyn_actualarrivaltime, b.msdyn_actualtravelduration, b.msdyn_estimatedtravelduration,
            b.cf_actualarrivaltime, b.cf_endtime, b.cf_durationschedule, b.cf_duration,
            b.cf_fieldnotes, b.cf_internalfieldnotes,
            b.createdon, b.modifiedon, JSON.stringify(b.rawJson),
          ],
        );
        bookingResults.push({
          bookingId: b.bookableresourcebookingid,
          woName,
          status: "upserted",
          ...(missingDependencies.length > 0 ? { missing_dependencies: missingDependencies } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        req.log.error({ err: e, bookingId: b.bookableresourcebookingid }, "backfill: booking upsert failed");
        bookingResults.push({ bookingId: b.bookableresourcebookingid, woName, status: "failed", error: msg });
      }
    }

    res.json({
      requested: woNames,
      not_found_in_dynamics: notFound,
      work_orders: woResults,
      bookings: bookingResults,
    });
  } catch (err) {
    handleWbError(req, res, err, "Backfill from Dynamics failed", "Backfill from Dynamics failed", { source: "mixed" });
  }
});

// ── Dispatcher booking notes (local notes attached to CRM jobs) ───────────────
//
// Notes are stored in crm.booking_notes in the d365crm Postgres database.
// booking_id is the CRM msdyn_bookingid (text GUID). Notes are never written
// to Dynamics itself — they live in the CRM mirror DB alongside the other
// crm-schema tables so they travel with CRM data.

// GET /wb/booking-notes?bookingIds=id1,id2  — batch lookup (comma-separated)
router.get("/wb/booking-notes", requireLogin, async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const rawIds = ((req.query.bookingIds as string | undefined) ?? "").trim();
  const bookingIds = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (bookingIds.length === 0) {
    res.json([]);
    return;
  }
  try {
    const pool = getCrmPool();
    const r = await pool.query<{ booking_id: string; note: string | null; updated_at: Date }>(
      `SELECT booking_id, note, updated_at FROM crm.booking_notes WHERE booking_id = ANY($1::text[])`,
      [bookingIds],
    );
    res.json(
      r.rows.map((row) => ({
        booking_id: row.booking_id,
        note: row.note,
        updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to batch-fetch booking notes");
    res.status(500).json({ error: "Failed to fetch booking notes" });
  }
});

// GET /wb/booking-notes/:bookingId
router.get("/wb/booking-notes/:bookingId", requireLogin, async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const { bookingId } = req.params as { bookingId: string };
  try {
    const pool = getCrmPool();
    const r = await pool.query<{ booking_id: string; note: string | null; updated_at: Date }>(
      `SELECT booking_id, note, updated_at FROM crm.booking_notes WHERE booking_id = $1 LIMIT 1`,
      [bookingId],
    );
    if (r.rows.length === 0) {
      res.json({ booking_id: bookingId, note: null, updated_at: null });
      return;
    }
    const row = r.rows[0];
    res.json({
      booking_id: row.booking_id,
      note: row.note,
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch booking note");
    res.status(500).json({ error: "Failed to fetch booking note" });
  }
});

// PUT /wb/booking-notes/:bookingId — upsert
router.put("/wb/booking-notes/:bookingId", requireRole("editor"), async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const { bookingId } = req.params as { bookingId: string };
  const noteSchema = z.object({ note: z.string() });
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  try {
    const pool = getCrmPool();
    const r = await pool.query<{ booking_id: string; note: string | null; updated_at: Date }>(
      `INSERT INTO crm.booking_notes (booking_id, note, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (booking_id) DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
       RETURNING booking_id, note, updated_at`,
      [bookingId, parsed.data.note],
    );
    const row = r.rows[0];
    res.json({
      booking_id: row.booking_id,
      note: row.note,
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    });
  } catch (err) {
    req.log.error({ err, bookingId }, "Failed to upsert booking note");
    res.status(500).json({ error: "Failed to save booking note" });
  }
});

// DELETE /wb/booking-notes/:bookingId
router.delete("/wb/booking-notes/:bookingId", requireRole("editor"), async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured. Set D365CRM_DATABASE_URL." });
    return;
  }
  const { bookingId } = req.params as { bookingId: string };
  try {
    const pool = getCrmPool();
    await pool.query(`DELETE FROM crm.booking_notes WHERE booking_id = $1`, [bookingId]);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err, bookingId }, "Failed to delete booking note");
    res.status(500).json({ error: "Failed to delete booking note" });
  }
});


// ── Calendar Report ───────────────────────────────────────────────────────────
// GET /wb/calendar-report
// Returns bookings for specified technicians over a multi-month date range,
// grouped by technician → month → day. Used by the coordinator calendar report
// feature to generate per-technician PDF/Word summaries and emails.
//
// Query params:
//   technician_ids  – comma-separated bookableresourceid UUIDs (required)
//   start_date      – YYYY-MM-DD, first day of the report range (required)
//   end_date        – YYYY-MM-DD, day after the last day of the range (required)
//                     Maximum range: 6 months (≈ 184 days).
router.get("/wb/calendar-report", requireRole("editor"), async (req, res) => {
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "d365crm is not configured." });
    return;
  }

  const rawIds = ((req.query.technician_ids as string | undefined) ?? "").trim();
  const startRaw = ((req.query.start_date as string | undefined) ?? "").trim();
  const endRaw = ((req.query.end_date as string | undefined) ?? "").trim();

  if (!rawIds) {
    res.status(400).json({ error: "technician_ids is required" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(endRaw)) {
    res.status(400).json({ error: "start_date and end_date are required (YYYY-MM-DD)" });
    return;
  }

  const startDate = new Date(startRaw + "T00:00:00Z");
  const endDate = new Date(endRaw + "T00:00:00Z");
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    res.status(400).json({ error: "end_date must be after start_date" });
    return;
  }
  const daySpan = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000);
  if (daySpan > 184) {
    res.status(400).json({ error: "Date range cannot exceed 6 months (184 days)" });
    return;
  }

  const techIds = rawIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);

  const FV = "@OData.Community.Display.V1.FormattedValue";

  try {
    const pool = getCrmPool();

    // Resolve technician metadata first so we always return rows for every
    // requested technician, even if they have no bookings in the range.
    const techRes = await pool.query<{
      technician_id: string;
      resource_name: string | null;
      user_email: string | null;
      entra_object_id: string | null;
      user_principal_name: string | null;
    }>(
      `SELECT br.bookableresourceid::text AS technician_id,
              br.name                     AS resource_name,
              COALESCE(
                NULLIF(BTRIM(br.msdyn_primaryemail), ''),
                NULLIF(BTRIM(su.internalemailaddress), ''),
                NULLIF(BTRIM(su.domainname), '')
              )                           AS user_email,
              su.azureactivedirectoryobjectid::text AS entra_object_id,
              su.domainname                AS user_principal_name
       FROM crm.bookableresource br
       LEFT JOIN crm.systemuser su
         ON su.systemuserid = br.userid
        AND COALESCE(su.is_deleted, false) = false
       WHERE bookableresourceid::text = ANY($1::text[])
         AND COALESCE(br.is_deleted, false) = false`,
      [techIds],
    );

    // Fetch all non-cancelled bookings for the requested techs in the range.
    const bkRes = await pool.query(
      `SELECT
         b.bookableresourcebookingid::text        AS booking_id,
         b.resource::text                         AS resource_id,
         b.starttime                              AS start_time,
         b.endtime                                AS end_time,
         b.raw_json->>'_bookingstatus_value${FV}' AS booking_status,
         wo.msdyn_workorderid::text               AS work_order_id,
         wo.msdyn_name                            AS work_order_number,
         COALESCE(
           wo.new_customerrequirement,
           wo.raw_json->>'_msdyn_workordertype_value${FV}'
         )                                        AS title,
         wo.raw_json->>'msdyn_systemstatus${FV}'  AS system_status,
         wo.msdyn_city                            AS city,
         wo.msdyn_stateorprovince                 AS state,
         COALESCE(
           acc.name,
           wo.raw_json->>'_msdyn_serviceaccount_value${FV}'
         )                                        AS customer_name,
         COALESCE(
           br.name,
           b.raw_json->>'_resource_value${FV}'
         )                                        AS resource_name,
         br.msdyn_primaryemail                    AS user_email,
         eq.equipment_names
       FROM crm.booking b
       LEFT JOIN crm.workorder wo
         ON wo.msdyn_workorderid = b.msdyn_workorder
        AND COALESCE(wo.is_deleted, false) = false
       LEFT JOIN crm.account acc
         ON acc.accountid = wo.msdyn_serviceaccount
        AND COALESCE(acc.is_deleted, false) = false
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
       WHERE b.starttime <  $2::timestamptz
         AND (b.endtime IS NULL OR b.endtime > $1::timestamptz)
         AND b.resource::text = ANY($3::text[])
         AND COALESCE(b.is_deleted, false) = false
         AND COALESCE(b.raw_json->>'_bookingstatus_value${FV}', '') NOT ILIKE 'cancel%'
       ORDER BY b.resource, b.starttime ASC NULLS LAST`,
      [startRaw, endRaw, techIds],
    );

    // Build technician index from metadata.
    // Each technician accumulates a unified `events` array that merges CRM
    // bookings, FS schedule_blocks (Drive Time / PTO / Custom), and FS
    // placeholder_jobs (Potential Jobs), all sorted by start_time.
    type CalEventKind = "job" | "potential" | "drive" | "pto" | "custom";
    type ReportEvent = {
      kind: CalEventKind;
      start_time: string;
      end_time: string | null;
      booking_id?: string;
      work_order_number?: string | null;
      customer_name?: string | null;
      city?: string | null;
      state?: string | null;
      title?: string | null;
      booking_status?: string | null;
       notes?: string | null;
      equipment_names?: string[];
    };
    type ReportTech = {
      technician_id: string;
      resource_name: string | null;
      user_email: string | null;
      entra_object_id: string | null;
      user_principal_name: string | null;
      events: ReportEvent[];
    };

    const techMap = new Map<string, ReportTech>();
    // Seed with all requested techs (ensures empty-schedule techs are included)
    for (const t of techRes.rows) {
      techMap.set(t.technician_id, {
        technician_id: t.technician_id,
        resource_name: t.resource_name,
        user_email: t.user_email,
        entra_object_id: t.entra_object_id,
        user_principal_name: t.user_principal_name,
        events: [],
      });
    }
    // Ensure any techs returned from bookings that weren't in the metadata query
    // still appear (handles edge cases with stale UUIDs).
    for (const row of bkRes.rows) {
      const rid = row.resource_id as string;
      if (!techMap.has(rid)) {
        techMap.set(rid, {
          technician_id: rid,
          resource_name: row.resource_name as string | null,
          user_email: row.user_email as string | null,
          entra_object_id: null,
          user_principal_name: null,
          events: [],
        });
      }
    }
    // Append CRM bookings as "job" events
    for (const row of bkRes.rows) {
      const rid = row.resource_id as string;
      const tech = techMap.get(rid);
      if (!tech || !row.booking_id || !row.start_time) continue;
      const st = row.start_time instanceof Date ? row.start_time : new Date(row.start_time as string);
      const et = row.end_time ? (row.end_time instanceof Date ? row.end_time : new Date(row.end_time as string)) : null;
      tech.events.push({
        kind: "job",
        start_time: st.toISOString(),
        end_time: et ? et.toISOString() : null,
        booking_id: row.booking_id as string,
        work_order_number: (row.work_order_number as string | null) ?? null,
        customer_name: (row.customer_name as string | null) ?? null,
        city: (row.city as string | null) ?? null,
        state: (row.state as string | null) ?? null,
        title: (row.title as string | null) ?? null,
        booking_status: (row.booking_status as string | null) ?? null,
        equipment_names: (row.equipment_names as string[] | null) ?? [],
      });
    }

    // Fetch schedule_blocks (Drive Time / PTO / Custom) from the FS database.
    // Include any block that overlaps the requested date range.
    const blkRes = await localPool.query<{
      technician_id: string;
      block_type: string;
      title: string | null;
      start_time: Date;
      end_time: Date | null;
    }>(
      `SELECT technician_id, block_type, title, start_time, end_time
       FROM crm.schedule_blocks
       WHERE start_time < $1::date
         AND (end_time IS NULL OR end_time > $2::date)
         AND technician_id = ANY($3::text[])
       ORDER BY start_time`,
      [endRaw, startRaw, techIds],
    );
    for (const row of blkRes.rows) {
      const tech = techMap.get(row.technician_id);
      if (!tech) continue;
      const bt = (row.block_type ?? "").toUpperCase();
      const kind: CalEventKind = bt === "DRIVE_TIME" ? "drive" : bt === "PTO" ? "pto" : "custom";
      const st = row.start_time instanceof Date ? row.start_time : new Date(row.start_time as string);
      const et = row.end_time ? (row.end_time instanceof Date ? row.end_time : new Date(row.end_time as string)) : null;
      tech.events.push({
        kind,
        start_time: st.toISOString(),
        end_time: et ? et.toISOString() : null,
        title: row.title ?? null,
      });
    }

    // Fetch placeholder_jobs (Potential Jobs) from the FS database.
    const phRes = await localPool.query<{
      technician_id: string;
      title: string | null;
      customer_name: string | null;
      city: string | null;
      state: string | null;
      start_time: Date;
      end_time: Date | null;
      status: string | null;
       notes: string | null;
    }>(
       `SELECT technician_id, title, customer_name, city, state, start_time, end_time, status, notes
       FROM crm.placeholder_jobs
       WHERE start_time < $1::timestamptz
         AND (end_time IS NULL OR end_time > $2::timestamptz)
         AND technician_id = ANY($3::text[])
       ORDER BY start_time`,
      [endRaw, startRaw, techIds],
    );
    for (const row of phRes.rows) {
      const tech = techMap.get(row.technician_id);
      if (!tech) continue;
      const st = row.start_time instanceof Date ? row.start_time : new Date(row.start_time as string);
      const et = row.end_time ? (row.end_time instanceof Date ? row.end_time : new Date(row.end_time as string)) : null;
      tech.events.push({
        kind: "potential",
        start_time: st.toISOString(),
        end_time: et ? et.toISOString() : null,
        customer_name: row.customer_name ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        title: row.title ?? null,
        booking_status: row.status ?? null,
         notes: row.notes ?? null,
      });
    }

    // Sort each technician's events chronologically
    for (const tech of techMap.values()) {
      tech.events.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }

    // If CRM has no email fields populated, resolve the mailbox from
    // Microsoft Graph using the CRM-linked Entra identity. This is best effort:
    // schedule data still loads when User.Read.All has not been granted.
    const unresolvedTechs = Array.from(techMap.values()).filter(
      (tech) => !tech.user_email && (tech.entra_object_id || tech.user_principal_name),
    );
    if (unresolvedTechs.length > 0) {
      const resolvedEmails = await Promise.all(
        unresolvedTechs.map((tech) =>
          lookupGraphDirectoryEmail(tech.entra_object_id, tech.user_principal_name, req.log),
        ),
      );
      unresolvedTechs.forEach((tech, index) => {
        tech.user_email = resolvedEmails[index];
      });
    }

    res.json({
      range_start: startRaw,
      range_end: endRaw,
      technicians: Array.from(techMap.values()),
    });
  } catch (err) {
    handleWbError(req, res, err, "Failed to fetch calendar report data", "Failed to fetch calendar report");
  }
});

// ── Calendar Report Email ─────────────────────────────────────────────────────
// POST /wb/calendar-report/email
// Sends one email per recipient to individual technicians via Microsoft Graph
// using client-credentials (application Mail.Send permission). The coordinator's
// session email is used as the sender (From address).
//
// Body: { technician_id, start_date, end_date, pdf_base64 }
//
// IMPORTANT: requires Mail.Send to send mail. If CRM email fields are blank,
// User.Read.All application permission is also required to resolve the linked
// technician mailbox from Microsoft Graph.

let cachedGraphToken: { value: string; expiresAt: number } | null = null;

async function getGraphAccessToken(): Promise<string> {
  // Prefer the non-ENTRA credentials — CLIENT_ID is the app registration that
  // has been granted Mail.Send (and User.Read.All for directory lookup).
  // ENTRA_CLIENT_ID is the authentication-only app and does not have those
  // permissions.
  const tenantId = process.env.TENANT_ID ?? process.env.ENTRA_TENANT_ID;
  const clientId = process.env.CLIENT_ID ?? process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET ?? process.env.ENTRA_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Azure credentials are not configured (TENANT_ID, CLIENT_ID, CLIENT_SECRET required).");
  }

  const now = Date.now();
  if (cachedGraphToken && cachedGraphToken.expiresAt > now + 60_000) {
    return cachedGraphToken.value;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const tokenRes = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw new Error(`Failed to acquire Graph token (${tokenRes.status}): ${text.slice(0, 300)}`);
  }
  const json = (await tokenRes.json()) as { access_token: string; expires_in: number };
  cachedGraphToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return cachedGraphToken.value;
}

function isPlausibleEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/**
 * Resolve a mailbox from Microsoft Graph using a CRM-linked identity.
 *
 * The lookup intentionally uses the Entra object id (or CRM UPN) rather than
 * searching by display name. Display names are not unique and must never be
 * used to choose an email recipient.
 *
 * User.Read.All (application permission) is required for this fallback. A
 * missing permission or unavailable directory is treated as "not resolved";
 * the caller can still use the CRM email fields or return a clear no-email
 * response.
 */
async function lookupGraphDirectoryEmail(
  objectId: string | null | undefined,
  userPrincipalName: string | null | undefined,
  log?: { warn: (obj: Record<string, unknown>, message: string) => void },
): Promise<string | null> {
  const identity = objectId?.trim() || userPrincipalName?.trim();
  if (!identity) return null;

  try {
    const token = await getGraphAccessToken();
    const graphUrl =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(identity)}` +
      `?$select=mail,userPrincipalName`;
    const response = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) {
      log?.warn(
        { status: response.status, identity: objectId ? "entra-object-id" : "crm-upn" },
        "Microsoft Graph directory email lookup failed",
      );
      return null;
    }
    const body = (await response.json()) as {
      mail?: unknown;
      userPrincipalName?: unknown;
    };
    if (isPlausibleEmail(body.mail)) return body.mail.trim();
    if (isPlausibleEmail(body.userPrincipalName)) return body.userPrincipalName.trim();
    return null;
  } catch (err) {
    log?.warn(
      { err, identity: objectId ? "entra-object-id" : "crm-upn" },
      "Microsoft Graph directory email lookup unavailable",
    );
    return null;
  }
}

// Single-recipient schema: client submits a technician ID + date range +
// PDF bytes. The server resolves the recipient address from CRM and never
// trusts a client-supplied email. One PDF per HTTP call keeps the request
// well within the 5 MB body limit.
const calendarEmailSchema = z.object({
  technician_id: z.string().uuid("technician_id must be a UUID"),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "start_date must be YYYY-MM-DD"),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "end_date must be YYYY-MM-DD"),
  pdf_base64: z.string().min(1),
});

/** Escape the five XML/HTML metacharacters to prevent injection. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstNameOf(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;

  // Entra/CRM display names may be formatted as "Last, First".
  if (trimmed.includes(",")) {
    const firstName = trimmed.split(",", 2)[1]?.trim().split(/\s+/)[0];
    if (firstName) return firstName;
  }

  // Also support the usual "First Last" format.
  return trimmed.split(/\s+/)[0] || fallback;
}

/** Build a human-readable date range label e.g. "Aug 2026 – Oct 2026".
 *  end_date is the exclusive end — we display the month before it. */
function buildServerDateLabel(startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const s = new Date(startIso + "T00:00:00Z");
  const e = new Date(endIso + "T00:00:00Z");
  // Step back one day so the exclusive end maps to the last inclusive month.
  e.setUTCDate(e.getUTCDate() - 1);
  return `${fmt.format(s)} – ${fmt.format(e)}`;
}

router.post("/wb/calendar-report/email", requireRole("editor"), async (req, res) => {
  const senderEmail = req.session?.user?.email;
  if (!senderEmail) {
    res.status(400).json({ error: "Sender email not available in session. Please re-login." });
    return;
  }

  const parsed = calendarEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }
  const { technician_id, start_date, end_date, pdf_base64 } = parsed.data;

  // Resolve technician name + email from CRM — never trust client-supplied values.
  let techName: string;
  let techEmail: string;
  try {
    const pool = getCrmPool();
    const techRes = await pool.query<{
      resource_name: string | null;
      user_email: string | null;
      entra_object_id: string | null;
      user_principal_name: string | null;
    }>(
      `SELECT br.name AS resource_name,
              COALESCE(
                NULLIF(BTRIM(br.msdyn_primaryemail), ''),
                NULLIF(BTRIM(su.internalemailaddress), ''),
                NULLIF(BTRIM(su.domainname), '')
              ) AS user_email,
              su.azureactivedirectoryobjectid::text AS entra_object_id,
              su.domainname AS user_principal_name
       FROM crm.bookableresource br
       LEFT JOIN crm.systemuser su
         ON su.systemuserid = br.userid
        AND COALESCE(su.is_deleted, false) = false
       WHERE br.bookableresourceid::text = $1
         AND COALESCE(br.is_deleted, false) = false
       LIMIT 1`,
      [technician_id],
    );
    if (techRes.rows.length === 0) {
      res.status(404).json({ error: "Technician not found.", technician_id });
      return;
    }
    const row = techRes.rows[0];
    const graphEmail = row.user_email
      ? null
      : await lookupGraphDirectoryEmail(
          row.entra_object_id,
          row.user_principal_name,
          req.log,
        );
    techEmail = row.user_email ?? graphEmail ?? "";
    if (!techEmail) {
      res.status(422).json({
        error: "This technician has no email address in CRM or Microsoft 365.",
        technician_id,
      });
      return;
    }
    techName = row.resource_name ?? "Technician";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err, technician_id }, "CRM lookup failed in calendar email route");
    res.status(503).json({ error: "Could not verify technician in CRM.", detail: msg });
    return;
  }

  let graphToken: string;
  try {
    graphToken = await getGraphAccessToken();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Failed to acquire Graph token for calendar email");
    res.status(503).json({
      error: "Could not authenticate with Microsoft Graph. Ensure the app registration has Mail.Send permission granted by an admin.",
      detail: msg,
    });
    return;
  }

  try {
    const dateLabel = buildServerDateLabel(start_date, end_date);
    // Escape all CRM-derived text before HTML interpolation.
    const recipientFirstName = firstNameOf(techName, "there");
    const senderFirstName = firstNameOf(req.session?.user?.displayName, "Coordinator");
    const safeRecipientFirstName = escapeHtml(recipientFirstName);
    const safeSenderFirstName = escapeHtml(senderFirstName);
    const safeLabel = escapeHtml(dateLabel);
    const subject = `Your Field Service Schedule — ${dateLabel}`;
    const htmlBody = `
      <p>Hi ${safeRecipientFirstName},</p>
      <p>Please find your field service schedule summary for <strong>${safeLabel}</strong> attached as a PDF.</p>
      <p>If you have any questions about your schedule, please contact me.</p>
      <p>Thank you,<br/>${safeSenderFirstName}</p>
    `;
    const safePdfName = techName.replace(/[^a-zA-Z0-9]+/g, "_");
    const safeLabelName = dateLabel.replace(/[^a-zA-Z0-9]+/g, "_");
    const fileName = `Schedule_${safePdfName}_${safeLabelName}.pdf`;

    const payload = {
      message: {
        subject,
        body: { contentType: "HTML", content: htmlBody },
        toRecipients: [{ emailAddress: { address: techEmail } }],
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: fileName,
            contentType: "application/pdf",
            contentBytes: pdf_base64,
          },
        ],
      },
      saveToSentItems: true,
    };

    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`;
    const sendRes = await fetch(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${graphToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text().catch(() => "");
      let errMsg = errText.slice(0, 300);
      try {
        const errJson = JSON.parse(errText) as { error?: { message?: string } };
        if (errJson.error?.message) errMsg = errJson.error.message;
      } catch { /* keep raw */ }
      req.log.warn({ technician_id, techEmail, status: sendRes.status, errMsg }, "Graph sendMail failed");
      res.status(502).json({
        success: false,
        technician_id,
        technician_name: techName,
        technician_email: techEmail,
        error: errMsg,
      });
      return;
    }

    req.log.info({ technician_id, techEmail }, "Calendar report email sent");
    res.json({
      success: true,
      technician_id,
      technician_name: techName,
      technician_email: techEmail,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log.error({ err, technician_id }, "Unexpected error sending calendar report email");
    res.status(500).json({ success: false, technician_id, technician_name: techName, technician_email: techEmail, error: msg });
  }
});

export default router;


