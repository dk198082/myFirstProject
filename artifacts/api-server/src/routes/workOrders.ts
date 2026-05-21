import { Router } from "express";
import { pool } from "../lib/db.js";

const router = Router();

router.get("/work-orders/:workOrderId", async (req, res) => {
  const { workOrderId } = req.params;

  try {
    const [woRes, productsRes, servicesRes, bookingRes, contactRes, equipmentRes] = await Promise.all([
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
                actual_start_time, actual_end_time, duration_minutes, technician_id,
                crmstart_time, crmstarttime, crmend_time, crmendtime,
                modifiedon, modifiedtime
         FROM bookings
         WHERE work_order_id = $1
         ORDER BY start_time ASC
         LIMIT 1`,
        [workOrderId]
      ),
      pool.query(
        `SELECT ct.contact_id, ct.fullname, ct.firstname, ct.lastname,
                ct.email, ct.businessphone, ct.homephone, ct.mobilephone,
                ct.street1, ct.city, ct.state, ct.country
         FROM work_orders wo
         JOIN contact ct ON ct.contact_id = wo.contact_id
         WHERE wo.work_order_id = $1`,
        [workOrderId]
      ),
      pool.query(
        `SELECT equipmentid, name, serialnumber,
                lastcalibrationdate, nextcalibrationdate,
                calinterval, machinecapacity, calibrationdate
         FROM equipment
         WHERE work_order_id = $1
         ORDER BY name ASC NULLS LAST, serialnumber ASC NULLS LAST`,
        [workOrderId]
      ),
    ]);

    const toDateOnly = (v: unknown) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null;
    const equipment = equipmentRes.rows.map((e) => ({
      ...e,
      lastcalibrationdate: toDateOnly(e.lastcalibrationdate),
      nextcalibrationdate: toDateOnly(e.nextcalibrationdate),
      calibrationdate: toDateOnly(e.calibrationdate),
    }));

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

    const serviceaddress =
      [
        wo.msdyn_addressname,
        wo.service_address,
        wo.city,
        wo.state,
        wo.postalcode,
        wo.country,
      ]
        .filter((s) => s != null && String(s).trim() !== "")
        .join(", ") || null;

    const booking = bookingRes.rows[0] ?? null;
    if (booking) {
      // Normalize date/time-only fields to plain strings so they serialize
      // predictably (pg returns Date for `date`, string for `time`).
      const toDateStr = (v: unknown) =>
        v instanceof Date ? v.toISOString().slice(0, 10) : v ?? null;
      const toTimeStr = (v: unknown) =>
        typeof v === "string" ? v : v == null ? null : String(v);
      booking.crmstart_time = toDateStr(booking.crmstart_time);
      booking.crmend_time = toDateStr(booking.crmend_time);
      booking.modifiedon = toDateStr(booking.modifiedon);
      booking.crmstarttime = toTimeStr(booking.crmstarttime);
      booking.crmendtime = toTimeStr(booking.crmendtime);
      booking.modifiedtime = toTimeStr(booking.modifiedtime);
    }

    res.json({
      work_order_id: wo.work_order_id,
      work_order_number: wo.work_order_number,
      title: wo.title,
      description: wo.description,
      service_address: wo.service_address,
      serviceaddress,
      priority: wo.priority,
      system_status: wo.system_status,
      sub_status: wo.sub_status,
      incident_type: wo.incident_type,
      servicelocation: wo.servicelocation,
      pricelistname: wo.pricelistname,
      cf_projectname: wo.cf_projectname,
      cf_ponumber: wo.cf_ponumber,
      cf_axserviceorderid: wo.cf_axserviceorderid,
      servicetype: wo.servicetype,
      created_on: wo.created_on,
      modified_on: wo.modified_on,
      customer,
      contact: contactRes.rows[0] ?? null,
      booking,
      products: productsRes.rows,
      services: servicesRes.rows,
      equipment,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get work order detail");
    res.status(500).json({ error: "Failed to get work order detail" });
  }
});

export default router;
