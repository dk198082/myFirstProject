import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/scheduled-jobs", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.booking_id,
        b.start_time,
        b.end_time,
        b.booking_status,
        b.duration_minutes,
        t.technician_id,
        t.resource_name,
        t.user_email,
        wo.work_order_id,
        wo.work_order_number,
        wo.title,
        wo.priority,
        wo.system_status,
        wo.service_address,
        c.customer_name,
        c.city,
        c.state,
        c.country
      FROM bookings b
      JOIN technicians t ON b.technician_id = t.technician_id
      JOIN work_orders wo ON b.work_order_id = wo.work_order_id
      LEFT JOIN customers c ON wo.customer_id = c.customer_id
      WHERE wo.system_status = 'Scheduled'
      ORDER BY
        COALESCE(c.state, c.city, 'Unknown') ASC,
        t.resource_name ASC,
        b.start_time ASC
    `);

    // Group by region → technician
    const regionMap = new Map<
      string,
      Map<string, { technician_id: string; resource_name: string | null; user_email: string | null; jobs: unknown[] }>
    >();

    for (const row of result.rows) {
      const region = row.state ?? row.city ?? "Unknown";
      const techId = row.technician_id as string;

      if (!regionMap.has(region)) {
        regionMap.set(region, new Map());
      }
      const techMap = regionMap.get(region)!;

      if (!techMap.has(techId)) {
        techMap.set(techId, {
          technician_id: techId,
          resource_name: row.resource_name,
          user_email: row.user_email,
          jobs: [],
        });
      }

      techMap.get(techId)!.jobs.push({
        booking_id: row.booking_id,
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        title: row.title,
        priority: row.priority,
        system_status: row.system_status,
        booking_status: row.booking_status,
        service_address: row.service_address,
        customer_name: row.customer_name,
        city: row.city,
        state: row.state,
        country: row.country,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_minutes: row.duration_minutes,
      });
    }

    const response = Array.from(regionMap.entries()).map(([region, techMap]) => ({
      region,
      technicians: Array.from(techMap.values()),
    }));

    res.json(response);
  } catch (err) {
    req.log.error({ err }, "Failed to get scheduled jobs");
    res.status(500).json({ error: "Failed to get scheduled jobs" });
  }
});

export default router;
