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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

router.get("/schedule-board", async (req, res) => {
  const viewRaw = (req.query.view as string | undefined) ?? "week";
  const view: "week" | "month" = viewRaw === "month" ? "month" : "week";

  const groupByRaw = (req.query.groupBy as string | undefined) ?? "tech-region";
  const groupBy: "tech-region" | "service-location" =
    groupByRaw === "service-location" ? "service-location" : "tech-region";

  // Accept `start` (preferred) or legacy `weekStart`
  const startRaw =
    ((req.query.start as string | undefined) ??
      (req.query.weekStart as string | undefined) ??
      "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    res.status(400).json({
      error: "start query param required (YYYY-MM-DD)",
    });
    return;
  }

  // Compute the actual range based on view.
  // - week:  start = given date, end = start + 7 days (exclusive)
  // - month: start = first day of given date's month, end = first day of next month
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

  try {
    if (groupBy === "service-location") {
      // Service-location mode: group by wo.state (fallback to wo.city), join
      // technicians from bookings (not the technicians table), so a tech can
      // appear in multiple location groups. Only scheduled bookings with a work
      // order are included; bookings without a WO location fall under "Unknown Location".
      const result = await pool.query(
        `
        SELECT
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
          wo.city,
          wo.state,
          c.customer_name,
          ct.fullname     AS contact_name,
          ct.businessphone AS contact_businessphone,
          eq.equipment_names
        FROM bookings b
        JOIN technicians t
          ON t.technician_id = b.technician_id AND t.is_active = true
        LEFT JOIN work_orders wo ON wo.work_order_id = b.work_order_id
        LEFT JOIN customers   c  ON c.customer_id   = wo.customer_id
        LEFT JOIN contact     ct ON ct.contact_id   = wo.contact_id
        LEFT JOIN LATERAL (
          SELECT array_agg(e.label ORDER BY e.name ASC) AS equipment_names
          FROM (
            SELECT
              name,
              name
                || CASE
                     WHEN NULLIF(BTRIM(serialnumber), '') IS NOT NULL
                     THEN ' / ' || BTRIM(serialnumber)
                     ELSE ''
                   END AS label
            FROM equipment
            WHERE work_order_id = wo.work_order_id
              AND name IS NOT NULL
            ORDER BY name ASC
            LIMIT 5
          ) e
        ) eq ON true
        WHERE b.crmstart_time >= $1::date
          AND b.crmstart_time <  $2::date
        ORDER BY
          COALESCE(NULLIF(BTRIM(wo.state), ''), NULLIF(BTRIM(wo.city), ''), 'Unknown Location') ASC,
          t.resource_name ASC,
          b.crmstart_time ASC NULLS LAST,
          b.crmstarttime ASC NULLS LAST
        `,
        [rangeStart, rangeEnd]
      );

      type TechRow = {
        technician_id: string;
        resource_name: string | null;
        user_email: string | null;
        jobs: unknown[];
      };
      type LocationRow = {
        regionid_id: string;
        region: string;
        company: string | null;
        technicians: Map<string, TechRow>;
      };

      const locationMap = new Map<string, LocationRow>();
      const rangeStartMs = start.getTime();
      const maxDayIndex = dayCount - 1;

      for (const row of result.rows) {
        const locationLabel: string =
          (row.state != null && String(row.state).trim() !== ""
            ? String(row.state).trim()
            : row.city != null && String(row.city).trim() !== ""
              ? String(row.city).trim()
              : null) ?? "Unknown Location";
        const locationId = slugify(locationLabel);

        if (!locationMap.has(locationId)) {
          locationMap.set(locationId, {
            regionid_id: locationId,
            region: locationLabel,
            company: null,
            technicians: new Map(),
          });
        }
        const loc = locationMap.get(locationId)!;

        if (!row.technician_id) continue;
        const tid = row.technician_id as string;
        if (!loc.technicians.has(tid)) {
          loc.technicians.set(tid, {
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
            rangeStartMs) /
            (24 * 60 * 60 * 1000)
        );

        loc.technicians.get(tid)!.jobs.push({
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
          city: row.city ?? null,
          state: row.state ?? null,
          day_index: Math.max(0, Math.min(maxDayIndex, dayIndex)),
          equipment_names: (row.equipment_names as string[] | null) ?? [],
        });
      }

      const regions = Array.from(locationMap.values()).map((loc) => ({
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
        regions,
      });
      return;
    }

    // ── Default: tech-region mode (original query) ──────────────────────────
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
        wo.city,
        wo.state,
        c.customer_name,
        ct.fullname     AS contact_name,
        ct.businessphone AS contact_businessphone,
        eq.equipment_names
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
      LEFT JOIN LATERAL (
        SELECT array_agg(e.label ORDER BY e.name ASC) AS equipment_names
        FROM (
          SELECT
            name,
            name
              || CASE
                   WHEN NULLIF(BTRIM(serialnumber), '') IS NOT NULL
                   THEN ' / ' || BTRIM(serialnumber)
                   ELSE ''
                 END AS label
          FROM equipment
          WHERE work_order_id = wo.work_order_id
            AND name IS NOT NULL
          ORDER BY name ASC
          LIMIT 5
        ) e
      ) eq ON true
      WHERE r.is_active = true
      ORDER BY r.region ASC, t.resource_name ASC, b.crmstart_time ASC NULLS LAST, b.crmstarttime ASC NULLS LAST
      `,
      [rangeStart, rangeEnd]
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
          rangeStartMs) /
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
        city: row.city ?? null,
        state: row.state ?? null,
        day_index: Math.max(0, Math.min(maxDayIndex, dayIndex)),
        equipment_names: (row.equipment_names as string[] | null) ?? [],
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
      group_by: "tech-region",
      range_start: rangeStart,
      range_end: rangeEnd,
      day_count: dayCount,
      // legacy fields (kept for backwards compatibility)
      week_start: rangeStart,
      week_end: rangeEnd,
      regions,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get schedule board");
    res.status(500).json({ error: "Failed to get schedule board" });
  }
});

export default router;
