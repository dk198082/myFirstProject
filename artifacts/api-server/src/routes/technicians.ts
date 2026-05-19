import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/technicians", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT technician_id, resource_name, user_email, phone, resource_type, is_active
      FROM technicians
      WHERE is_active = true
      ORDER BY resource_name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list technicians");
    res.status(500).json({ error: "Failed to list technicians" });
  }
});

router.get("/technicians/by-email", async (req, res) => {
  const email = req.query.email as string;
  if (!email) {
    res.status(400).json({ error: "email query param is required" });
    return;
  }

  try {
    const result = await pool.query(
      `
      SELECT
        b.booking_id,
        t.resource_name,
        t.user_email,
        wo.work_order_id,
        wo.work_order_number,
        wo.title,
        c.customer_name,
        wo.service_address,
        wo.priority,
        wo.system_status,
        b.booking_status,
        b.start_time,
        b.end_time,
        b.duration_minutes
      FROM bookings b
      JOIN technicians t ON b.technician_id = t.technician_id
      JOIN work_orders wo ON b.work_order_id = wo.work_order_id
      LEFT JOIN customers c ON wo.customer_id = c.customer_id
      WHERE LOWER(t.user_email) = LOWER($1)
      ORDER BY b.start_time ASC
    `,
      [email]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "No technician found with that email" });
      return;
    }

    res.json({
      jobs: result.rows,
      technicianEmail: result.rows[0]?.user_email ?? email,
      technicianName: result.rows[0]?.resource_name ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get technician by email");
    res.status(500).json({ error: "Failed to get technician by email" });
  }
});

router.get("/technicians/:technicianId/work-orders", async (req, res) => {
  const { technicianId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT
        b.booking_id,
        t.resource_name,
        t.user_email,
        wo.work_order_id,
        wo.work_order_number,
        wo.title,
        c.customer_name,
        wo.service_address,
        wo.priority,
        wo.system_status,
        b.booking_status,
        b.start_time,
        b.end_time,
        b.duration_minutes
      FROM bookings b
      JOIN technicians t ON b.technician_id = t.technician_id
      JOIN work_orders wo ON b.work_order_id = wo.work_order_id
      LEFT JOIN customers c ON wo.customer_id = c.customer_id
      WHERE t.technician_id = $1
      ORDER BY b.start_time ASC
    `,
      [technicianId]
    );

    const techRow = result.rows[0];
    res.json({
      jobs: result.rows,
      technicianEmail: techRow?.user_email ?? null,
      technicianName: techRow?.resource_name ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get technician work orders");
    res.status(500).json({ error: "Failed to get technician work orders" });
  }
});

router.get("/technicians/:technicianId/summary", async (req, res) => {
  const { technicianId } = req.params;

  try {
    const [totalRes, statusRes, priorityRes, todayRes] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as total FROM bookings WHERE technician_id = $1`,
        [technicianId]
      ),
      pool.query(
        `SELECT wo.system_status as label, COUNT(*) as count
         FROM bookings b
         JOIN work_orders wo ON b.work_order_id = wo.work_order_id
         WHERE b.technician_id = $1
         GROUP BY wo.system_status
         ORDER BY count DESC`,
        [technicianId]
      ),
      pool.query(
        `SELECT wo.priority as label, COUNT(*) as count
         FROM bookings b
         JOIN work_orders wo ON b.work_order_id = wo.work_order_id
         WHERE b.technician_id = $1
         GROUP BY wo.priority
         ORDER BY count DESC`,
        [technicianId]
      ),
      pool.query(
        `SELECT COUNT(*) as count FROM bookings
         WHERE technician_id = $1
           AND DATE(start_time) = CURRENT_DATE`,
        [technicianId]
      ),
    ]);

    res.json({
      technician_id: technicianId,
      total: parseInt(totalRes.rows[0]?.total ?? "0"),
      by_status: statusRes.rows.map((r) => ({
        label: r.label ?? "Unknown",
        count: parseInt(r.count),
      })),
      by_priority: priorityRes.rows.map((r) => ({
        label: r.label ?? "Unknown",
        count: parseInt(r.count),
      })),
      upcoming_today: parseInt(todayRes.rows[0]?.count ?? "0"),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get technician summary");
    res.status(500).json({ error: "Failed to get technician summary" });
  }
});

export default router;
