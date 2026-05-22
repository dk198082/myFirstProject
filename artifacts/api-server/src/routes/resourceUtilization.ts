import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

// Default weekly capacity per tech (hours). No tech-schedule table exists yet.
const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;

router.get("/resource-utilization", async (req, res) => {
  const startRaw = ((req.query.start as string | undefined) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    res.status(400).json({ error: "start query param required (YYYY-MM-DD)" });
    return;
  }

  const start = new Date(startRaw + "T00:00:00Z");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const rangeStart = start.toISOString().slice(0, 10);
  const rangeEnd = end.toISOString().slice(0, 10);

  try {
    const result = await pool.query(
      `
      SELECT
        r.regionid_id,
        r.region,
        t.technician_id,
        t.resource_name,
        COALESCE(SUM(b.duration_minutes), 0)::int AS utilized_minutes,
        COUNT(b.booking_id)::int AS job_count
      FROM regions r
      LEFT JOIN technicians t
        ON t.regionid_id = r.regionid_id AND t.is_active = true
      LEFT JOIN bookings b
        ON b.technician_id = t.technician_id
       AND b.crmstart_time >= $1::date
       AND b.crmstart_time <  $2::date
      WHERE r.is_active = true
      GROUP BY r.regionid_id, r.region, t.technician_id, t.resource_name
      ORDER BY r.region ASC, t.resource_name ASC NULLS LAST
      `,
      [rangeStart, rangeEnd],
    );

    const capacityMinutes = DEFAULT_WEEKLY_CAPACITY_HOURS * 60;

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
      range_start: rangeStart,
      range_end: rangeEnd,
      default_weekly_capacity_hours: DEFAULT_WEEKLY_CAPACITY_HOURS,
      regions: Array.from(regionMap.values()),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get resource utilization");
    res.status(500).json({ error: "Failed to get resource utilization" });
  }
});

export default router;
