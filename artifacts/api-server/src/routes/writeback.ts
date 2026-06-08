import { Router } from "express";
import { z } from "zod";
import { pool } from "../lib/db.js";
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
  if (filtered.length === 0) return new Map();
  const r = await pool.query(
    `SELECT technician_id::text AS technician_id, resource_name
     FROM technicians
     WHERE technician_id::text = ANY($1::text[])`,
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

  try {
    const params: unknown[] = [];
    let whereSearch = "";
    if (search) {
      params.push(`%${search}%`);
      whereSearch = `AND (wo.work_order_number ILIKE $${params.length}
                          OR wo.title ILIKE $${params.length}
                          OR c.customer_name ILIKE $${params.length})`;
    }
    params.push(limit);

    const r = await pool.query(
      `
      SELECT
        wo.work_order_id,
        wo.work_order_number,
        wo.title,
        wo.system_status,
        c.customer_name,
        b.booking_id,
        b.booking_status,
        b.start_time,
        b.end_time,
        b.technician_id,
        t.resource_name AS technician_name
      FROM work_orders wo
      LEFT JOIN customers c ON c.customer_id = wo.customer_id
      LEFT JOIN LATERAL (
        SELECT booking_id, booking_status, start_time, end_time, technician_id
        FROM bookings
        WHERE work_order_id = wo.work_order_id
        ORDER BY start_time ASC NULLS LAST
        LIMIT 1
      ) b ON true
      LEFT JOIN technicians t ON t.technician_id = b.technician_id
      WHERE 1=1 ${whereSearch}
      ORDER BY b.start_time DESC NULLS LAST, wo.work_order_number ASC NULLS LAST
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

  try {
    const existing = await pool.query<{ booking_id: string; work_order_id: string | null }>(
      `SELECT booking_id, work_order_id FROM bookings WHERE booking_id = $1 LIMIT 1`,
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
