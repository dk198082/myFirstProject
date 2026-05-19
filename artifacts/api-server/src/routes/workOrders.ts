import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/work-orders/:workOrderId", async (req, res) => {
  const { workOrderId } = req.params;

  try {
    const [woRes, productsRes, servicesRes, bookingRes] = await Promise.all([
      pool.query(
        `SELECT wo.*, c.customer_id, c.customer_name, c.email, c.phone,
                c.address, c.city, c.state, c.country, c.postal_code
         FROM work_orders wo
         LEFT JOIN customers c ON wo.customer_id = c.customer_id
         WHERE wo.work_order_id = $1`,
        [workOrderId]
      ),
      pool.query(
        `SELECT id, product_name, quantity, unit, line_status
         FROM work_order_products
         WHERE work_order_id = $1`,
        [workOrderId]
      ),
      pool.query(
        `SELECT id, service_name, duration_minutes, line_status
         FROM work_order_services
         WHERE work_order_id = $1`,
        [workOrderId]
      ),
      pool.query(
        `SELECT booking_id, booking_status, start_time, end_time,
                estimated_arrival_time, actual_arrival_time,
                actual_start_time, actual_end_time, duration_minutes, technician_id
         FROM bookings
         WHERE work_order_id = $1
         ORDER BY start_time ASC
         LIMIT 1`,
        [workOrderId]
      ),
    ]);

    const wo = woRes.rows[0];
    if (!wo) {
      res.status(404).json({ error: "Work order not found" });
      return;
    }

    const customer = wo.customer_id
      ? {
          customer_id: wo.customer_id,
          customer_name: wo.customer_name,
          email: wo.email,
          phone: wo.phone,
          address: wo.address,
          city: wo.city,
          state: wo.state,
          country: wo.country,
          postal_code: wo.postal_code,
        }
      : null;

    res.json({
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      title: wo.title,
      description: wo.description,
      service_address: wo.service_address,
      priority: wo.priority,
      system_status: wo.system_status,
      sub_status: wo.sub_status,
      incident_type: wo.incident_type,
      created_on: wo.created_on,
      modified_on: wo.modified_on,
      customer,
      booking: bookingRes.rows[0] ?? null,
      products: productsRes.rows,
      services: servicesRes.rows,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get work order detail");
    res.status(500).json({ error: "Failed to get work order detail" });
  }
});

export default router;
