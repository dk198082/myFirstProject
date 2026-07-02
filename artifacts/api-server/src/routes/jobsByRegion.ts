import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/jobs-by-region", async (req, res) => {
  const statusFilter = req.query.status as string | undefined;

  try {
    const params: string[] = [];
    const statusClause = statusFilter
      ? `AND wo.system_status = $${params.push(statusFilter)}`
      : "";

    const result = await pool.query(
      `
      SELECT
        r.regionid_id,
        r.region,
        r.owner_name,
        r.owner_email,
        r.company,
        t.technician_id,
        t.resource_name,
        t.user_email,
        wo.work_order_id,
        wo.work_order_number,
        wo.title,
        wo.priority,
        wo.system_status,
        wo.sub_status,
        wo.service_address,
        c.customer_name,
        c.city,
        c.state,
        b.booking_id,
        b.booking_status,
        b.start_time,
        b.end_time,
        b.duration_minutes
      FROM regions r
      LEFT JOIN technicians t ON t.regionid_id = r.regionid_id AND t.is_active = true
      LEFT JOIN bookings b ON b.technician_id = t.technician_id
      LEFT JOIN work_orders wo ON b.work_order_id = wo.work_order_id ${statusClause}
      LEFT JOIN customers c ON wo.customer_id = c.customer_id
      WHERE r.is_active = true
      ORDER BY r.region ASC, t.resource_name ASC, b.start_time ASC NULLS LAST
      `,
      params
    );

    // Group: region → technician → jobs
    const regionMap = new Map<
      string,
      {
        regionid_id: string;
        region: string;
        owner_name: string | null;
        owner_email: string | null;
        company: string | null;
        technicians: Map<
          string,
          {
            technician_id: string;
            resource_name: string | null;
            user_email: string | null;
            jobs: unknown[];
          }
        >;
      }
    >();

    for (const row of result.rows) {
      const rid = row.regionid_id as string;

      if (!regionMap.has(rid)) {
        regionMap.set(rid, {
          regionid_id: rid,
          region: row.region,
          owner_name: row.owner_name,
          owner_email: row.owner_email,
          company: row.company,
          technicians: new Map(),
        });
      }
      const rg = regionMap.get(rid)!;

      // rows with no technician assigned
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

      // rows with no booking / work order
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
    req.log.error({ err }, "Failed to get jobs by region");
    res.status(500).json({ error: "Failed to get jobs by region" });
  }
});

export default router;
