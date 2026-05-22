import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

type FamRow = {
  technician_id: string;
  resource_name: string | null;
  region: string | null;
  city_key: string | null;
  region_key: string | null;
  city_jobs: number;
  region_jobs: number;
};

function keyCS(city: string | null | undefined, state: string | null | undefined): string {
  return `${(city ?? "").toLowerCase().trim()}|${(state ?? "").toLowerCase().trim()}`;
}
function keyR(r: string | null | undefined): string {
  return (r ?? "").toLowerCase().trim();
}

router.get("/unscheduled-jobs", async (req, res) => {
  try {
    // 1. Unscheduled work orders enriched
    const woResult = await pool.query(`
      SELECT
        wo.work_order_id,
        wo.work_order_number,
        wo.servicelocation,
        wo.city,
        wo.state,
        wo.region,
        wo.cf_ponumber  AS po_number,
        c.customer_name,
        ct.fullname       AS contact_name,
        ct.businessphone  AS contact_phone,
        eq.due_date,
        svc.duration_minutes
      FROM work_orders wo
      LEFT JOIN customers c ON c.customer_id = wo.customer_id
      LEFT JOIN contact   ct ON ct.contact_id = wo.contact_id
      LEFT JOIN (
        SELECT work_order_id, MIN(nextcalibrationdate) AS due_date
        FROM equipment
        WHERE work_order_id IS NOT NULL
        GROUP BY work_order_id
      ) eq ON eq.work_order_id = wo.work_order_id
      LEFT JOIN (
        SELECT work_order_id, SUM(duration_minutes)::int AS duration_minutes
        FROM work_order_services
        WHERE duration_minutes IS NOT NULL
        GROUP BY work_order_id
      ) svc ON svc.work_order_id = wo.work_order_id
      WHERE wo.system_status = 'Unscheduled'
      ORDER BY eq.due_date ASC NULLS LAST, wo.region ASC NULLS LAST, wo.work_order_number ASC NULLS LAST
    `);

    // 2. Familiarity: per technician, count past bookings grouped by city+state and region
    //    (DB has no lat/lng populated, so we rank by "who has worked here before".)
    const famResult = await pool.query(`
      SELECT
        t.technician_id,
        t.resource_name,
        r.region,
        LOWER(TRIM(wo.city))  AS city_key,
        LOWER(TRIM(wo.state)) AS state_key,
        LOWER(TRIM(wo.region)) AS region_key,
        COUNT(*)::int AS city_jobs
      FROM bookings b
      JOIN technicians t ON t.technician_id = b.technician_id
      LEFT JOIN regions r ON r.regionid_id = t.regionid_id
      JOIN work_orders wo ON wo.work_order_id = b.work_order_id
      WHERE t.is_active = true
        AND b.crmstart_time IS NOT NULL
        AND b.crmstart_time < NOW()
      GROUP BY t.technician_id, t.resource_name, r.region,
               LOWER(TRIM(wo.city)), LOWER(TRIM(wo.state)), LOWER(TRIM(wo.region))
    `);

    // Build lookup: by (techId, "city|state") -> count; by (techId, region) -> count
    type TechMeta = { resource_name: string | null; region: string | null };
    const techMeta = new Map<string, TechMeta>();
    const cityCount = new Map<string, number>(); // `${techId}::${city|state}` -> n
    const regionCount = new Map<string, number>(); // `${techId}::${region}` -> n
    for (const row of famResult.rows as Array<FamRow & { state_key: string }>) {
      techMeta.set(row.technician_id, { resource_name: row.resource_name, region: row.region });
      const ck = `${row.technician_id}::${row.city_key ?? ""}|${row.state_key ?? ""}`;
      cityCount.set(ck, (cityCount.get(ck) ?? 0) + row.city_jobs);
      const rk = `${row.technician_id}::${row.region_key ?? ""}`;
      regionCount.set(rk, (regionCount.get(rk) ?? 0) + row.city_jobs);
    }

    // Also pull all active techs (some may have no bookings at all yet)
    const allTechsResult = await pool.query(`
      SELECT t.technician_id, t.resource_name, r.region
      FROM technicians t
      LEFT JOIN regions r ON r.regionid_id = t.regionid_id
      WHERE t.is_active = true
    `);
    for (const t of allTechsResult.rows) {
      if (!techMeta.has(t.technician_id)) {
        techMeta.set(t.technician_id, { resource_name: t.resource_name, region: t.region });
      }
    }

    // 3. Build best-fit list per job
    const jobs = woResult.rows.map((r) => {
      const cityKey = keyCS(r.city, r.state);
      const regionKey = keyR(r.region);
      const scored = Array.from(techMeta.entries()).map(([techId, meta]) => {
        const cityJobs = cityCount.get(`${techId}::${cityKey}`) ?? 0;
        const regionJobs = regionCount.get(`${techId}::${regionKey}`) ?? 0;
        const sameRegion = keyR(meta.region) === regionKey && regionKey !== "";
        // Rank: same region first, then city-familiarity, then region-familiarity
        const rank =
          (sameRegion ? 1_000_000 : 0) + cityJobs * 1000 + regionJobs;
        return { techId, meta, cityJobs, regionJobs, sameRegion, rank };
      });

      const best = scored
        .filter((s) => s.rank > 0) // only suggest techs with some signal
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

      const due = r.due_date instanceof Date
        ? r.due_date.toISOString().slice(0, 10)
        : r.due_date != null
          ? String(r.due_date).slice(0, 10)
          : null;

      return {
        work_order_id: r.work_order_id,
        work_order_number: r.work_order_number,
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
    req.log.error({ err }, "Failed to get unscheduled jobs");
    res.status(500).json({ error: "Failed to get unscheduled jobs" });
  }
});

export default router;
