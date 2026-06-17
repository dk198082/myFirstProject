import { Router } from "express";
import { z } from "zod";
import { getCrmPool, isCrmConfigured } from "../lib/crmDb.js";
import { localPool } from "../lib/localDb.js";
import { isDataverseConfigured, patchBooking } from "../lib/dataverse.js";

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
    req.log.error({ err }, "Failed to list write-back work orders");
    res.status(500).json({ error: "Failed to list work orders" });
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
    req.log.error({ err, bookingId }, "Failed to queue booking write-back");
    res.status(500).json({ error: "Failed to queue write-back" });
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
    req.log.error({ err }, "Failed to list write-backs");
    res.status(500).json({ error: "Failed to list write-backs" });
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
    req.log.error({ err }, "Failed to list write-back technicians");
    res.status(500).json({ error: "Failed to list technicians" });
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

router.get("/wb/schedule-board", async (req, res) => {
  const viewRaw = (req.query.view as string | undefined) ?? "week";
  const view: "week" | "month" = viewRaw === "month" ? "month" : "week";

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
      WITH res_terr AS (
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
        bk.customer_name                             AS customer_name
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
        NULL::timestamp                              AS start_time,
        NULL::timestamp                              AS end_time,
        NULL::text                                   AS booking_status,
        NULL::text                                   AS work_order_id,
        NULL::text                                   AS work_order_number,
        NULL::text                                   AS title,
        NULL::text                                   AS system_status,
        NULL::text                                   AS city,
        NULL::text                                   AS state,
        NULL::text                                   AS customer_name
      FROM res_terr rterr
      JOIN crm.territory ter ON ter.territoryid = rterr.territory_id
      JOIN crm.bookableresource br
        ON br.bookableresourceid = rterr.resource_id
       AND COALESCE(br.is_deleted, false) = false
      WHERE NOT EXISTS (SELECT 1 FROM bk WHERE bk.resource_id = rterr.resource_id)

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

    const regionMap = new Map<string, RegionRow>();
    const rangeStartMs = start.getTime();
    const maxDayIndex = dayCount - 1;

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
      const rg = regionMap.get(rid)!;

      if (!row.technician_id) continue;
      const tid = row.technician_id as string;
      if (!rg.technicians.has(tid)) {
        rg.technicians.set(tid, {
          technician_id: tid,
          resource_name: row.resource_name,
          user_email: row.user_email,
          jobs: [],
        });
      }

      if (!row.booking_id || !row.start_time) continue;

      const startParts = tsParts(row.start_time);
      const endParts = tsParts(row.end_time);
      const startDate =
        row.start_time instanceof Date ? row.start_time : new Date(row.start_time);
      const dayIndex = Math.floor(
        (Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) -
          rangeStartMs) /
          86_400_000,
      );

      rg.technicians.get(tid)!.jobs.push({
        booking_id: row.booking_id,
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        title: row.title,
        system_status: row.system_status,
        booking_status: row.booking_status,
        customer_name: row.customer_name,
        technician_name: row.resource_name,
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
        day_index: Math.max(0, Math.min(maxDayIndex, dayIndex)),
      });
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
    req.log.error({ err }, "Failed to get write-back schedule board");
    res.status(500).json({ error: "Failed to get schedule board" });
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
        await patchBooking(row.booking_id, {
          startTime: toIso(row.start_time),
          endTime: toIso(row.end_time),
          resourceId: row.technician_id,
        });
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
    req.log.error({ err }, "Failed to run write-back sync");
    res.status(500).json({ error: "Failed to run write-back sync" });
  }
});

export default router;
