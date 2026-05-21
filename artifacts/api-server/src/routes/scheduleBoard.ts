import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

function toDateOnly(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function toTimeOnly(v: unknown): string | null {
  if (v == null) return null;
  return String(v);
}

router.get("/schedule-board", async (req, res) => {
  const weekStartRaw = (req.query.weekStart as string | undefined) ?? "";
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : null;

  if (!weekStart) {
    res.status(400).json({ error: "weekStart query param required (YYYY-MM-DD)" });
    return;
  }

  // weekEnd is exclusive (Mon..Sun + 1 day)
  const start = new Date(weekStart + "T00:00:00Z");
  const endDate = new Date(start);
  endDate.setUTCDate(endDate.getUTCDate() + 7);
  const weekEnd = endDate.toISOString().slice(0, 10);

  try {
    const result = await pool.query(
      `
      SELECT
        r.regionid_id,
        r.region,
        r.company,
        t.technician_id,
        t.resource_name,
        t.user_email,
        b.booking_id,
        b.crmstart_time,
        b.crmstarttime,
        b.crmend_time,
        b.crmendtime,
        b.booking_status,
        wo.work_order_id,
        wo.work_order_number,
        wo.title,
        wo.system_status,
        c.customer_name,
        ct.fullname     AS contact_name,
        ct.businessphone AS contact_businessphone
      FROM regions r
      LEFT JOIN technicians t
        ON t.regionid_id = r.regionid_id AND t.is_active = true
      LEFT JOIN bookings b
        ON b.technician_id = t.technician_id
       AND b.crmstart_time >= $1::date
       AND b.crmstart_time <  $2::date
      LEFT JOIN work_orders wo ON wo.work_order_id = b.work_order_id
      LEFT JOIN customers   c  ON c.customer_id   = wo.customer_id
      LEFT JOIN contact     ct ON ct.contact_id   = wo.contact_id
      WHERE r.is_active = true
      ORDER BY r.region ASC, t.resource_name ASC, b.crmstart_time ASC NULLS LAST, b.crmstarttime ASC NULLS LAST
      `,
      [weekStart, weekEnd]
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
    const weekStartMs = start.getTime();

    for (const row of result.rows) {
      const rid = row.regionid_id as string;
      if (!regionMap.has(rid)) {
        regionMap.set(rid, {
          regionid_id: rid,
          region: row.region,
          company: row.company,
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

      if (!row.booking_id || !row.crmstart_time) continue;

      const startDate = row.crmstart_time instanceof Date
        ? row.crmstart_time
        : new Date(row.crmstart_time);
      const dayIndex = Math.floor(
        (Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()) -
          weekStartMs) /
          (24 * 60 * 60 * 1000)
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
        contact_name: row.contact_name,
        contact_businessphone: row.contact_businessphone,
        crmstart_time: toDateOnly(row.crmstart_time),
        crmstarttime: toTimeOnly(row.crmstarttime),
        crmend_time: toDateOnly(row.crmend_time),
        crmendtime: toTimeOnly(row.crmendtime),
        day_index: Math.max(0, Math.min(6, dayIndex)),
      });
    }

    const regions = Array.from(regionMap.values()).map((rg) => ({
      regionid_id: rg.regionid_id,
      region: rg.region,
      company: rg.company,
      technicians: Array.from(rg.technicians.values()),
    }));

    res.json({ week_start: weekStart, week_end: weekEnd, regions });
  } catch (err) {
    req.log.error({ err }, "Failed to get schedule board");
    res.status(500).json({ error: "Failed to get schedule board" });
  }
});

export default router;
