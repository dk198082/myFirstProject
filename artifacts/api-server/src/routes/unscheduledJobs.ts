import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/unscheduled-jobs", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        wo.work_order_id,
        wo.work_order_number,
        wo.servicelocation,
        wo.city,
        wo.state,
        wo.region,
        c.customer_name
      FROM work_orders wo
      LEFT JOIN customers c ON c.customer_id = wo.customer_id
      WHERE wo.system_status = 'Unscheduled'
      ORDER BY wo.region ASC NULLS LAST, wo.work_order_number ASC NULLS LAST
      `
    );

    res.json({
      jobs: result.rows.map((r) => ({
        work_order_id: r.work_order_id,
        work_order_number: r.work_order_number,
        servicelocation: r.servicelocation,
        customer_name: r.customer_name,
        city: r.city,
        state: r.state,
        region: r.region,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get unscheduled jobs");
    res.status(500).json({ error: "Failed to get unscheduled jobs" });
  }
});

export default router;
