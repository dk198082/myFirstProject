import { Router } from "express";
import { pool } from "../lib/db.js";
import { FS_UTILIZED_MINUTES_SQL, FS_BOOKING_NOT_CANCELLED_SQL } from "../lib/utilizationSql.js";

const router = Router();

const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;

type ViewType = "week" | "month" | "quarter";

function computeRange(startRaw: string, view: ViewType) {
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
  const capacityMinutes = Math.round((daysInRange / 7) * DEFAULT_WEEKLY_CAPACITY_HOURS * 60);

  return {
    rangeStart: rangeStart.toISOString().slice(0, 10),
    rangeEnd: rangeEnd.toISOString().slice(0, 10),
    periodWeeks,
    capacityMinutes,
  };
}

router.get("/resource-utilization", async (req, res) => {
  const startRaw = ((req.query.start as string | undefined) ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    res.status(400).json({ error: "start query param required (YYYY-MM-DD)" });
    return;
  }

  const viewRaw = ((req.query.view as string | undefined) ?? "week").trim();
  const view: ViewType =
    viewRaw === "month" ? "month" : viewRaw === "quarter" ? "quarter" : "week";

  const { rangeStart, rangeEnd, periodWeeks, capacityMinutes } = computeRange(startRaw, view);

  try {
    // Open-ended bookings (missing a start time OR an end time) count as a flat
    // 8h (480 min) — one working day. Timed bookings (both times) count their
    // real duration with NO cap, rounded to the nearest 30 minutes, so long jobs
    // and overbooking still surface. Cancelled / no-show bookings are excluded
    // (parity with /wb/resource-utilization). The open-ended vs. timed rule and
    // the cancelled filter live in ../lib/utilizationSql so both endpoints stay
    // in lock-step. Bookings are placed in range by crmstart_time.
    const result = await pool.query(
      `
      SELECT
        r.regionid_id,
        r.region,
        t.technician_id,
        t.resource_name,
        COALESCE(SUM(${FS_UTILIZED_MINUTES_SQL}), 0)::int AS utilized_minutes,
        COUNT(b.booking_id)::int AS job_count
      FROM regions r
      LEFT JOIN technicians t
        ON t.regionid_id = r.regionid_id AND t.is_active = true
      LEFT JOIN bookings b
        ON b.technician_id = t.technician_id
       AND b.crmstart_time >= $1::date
       AND b.crmstart_time <  $2::date
       AND ${FS_BOOKING_NOT_CANCELLED_SQL}
      WHERE r.is_active = true
      GROUP BY r.regionid_id, r.region, t.technician_id, t.resource_name
      ORDER BY r.region ASC, t.resource_name ASC NULLS LAST
      `,
      [rangeStart, rangeEnd],
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
      default_weekly_capacity_hours: DEFAULT_WEEKLY_CAPACITY_HOURS,
      regions: Array.from(regionMap.values()),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get resource utilization");
    res.status(500).json({ error: "Failed to get resource utilization" });
  }
});

export default router;
