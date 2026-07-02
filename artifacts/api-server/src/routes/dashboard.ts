import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  try {
    const [techRes, woRes, statusRes, priorityRes, topTechRes] =
      await Promise.all([
        pool.query(
          `SELECT COUNT(*) as total FROM technicians WHERE is_active = true`
        ),
        pool.query(`SELECT COUNT(*) as total FROM work_orders`),
        pool.query(
          `SELECT system_status as label, COUNT(*) as count
           FROM work_orders
           GROUP BY system_status
           ORDER BY count DESC`
        ),
        pool.query(
          `SELECT priority as label, COUNT(*) as count
           FROM work_orders
           WHERE priority IS NOT NULL
           GROUP BY priority
           ORDER BY count DESC`
        ),
        pool.query(
          `SELECT t.technician_id, t.resource_name, COUNT(b.booking_id) as count
           FROM technicians t
           LEFT JOIN bookings b ON t.technician_id = b.technician_id
           WHERE t.is_active = true
           GROUP BY t.technician_id, t.resource_name
           ORDER BY count DESC
           LIMIT 10`
        ),
      ]);

    res.json({
      total_technicians: parseInt(techRes.rows[0]?.total ?? "0"),
      total_work_orders: parseInt(woRes.rows[0]?.total ?? "0"),
      by_status: statusRes.rows.map((r) => ({
        label: r.label ?? "Unknown",
        count: parseInt(r.count),
      })),
      by_priority: priorityRes.rows.map((r) => ({
        label: r.label ?? "Unknown",
        count: parseInt(r.count),
      })),
      top_technicians: topTechRes.rows.map((r) => ({
        technician_id: r.technician_id,
        resource_name: r.resource_name,
        count: parseInt(r.count),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get dashboard summary");
    res.status(500).json({ error: "Failed to get dashboard summary" });
  }
});

export default router;
