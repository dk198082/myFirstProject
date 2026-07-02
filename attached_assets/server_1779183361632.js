const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", async (req, res) => {
  const technicianEmail = req.query.email || "john@company.com";

  const result = await pool.query(`
    SELECT
      b.booking_id,
      t.resource_name,
      t.user_email,
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
  `, [technicianEmail]);

  res.render("dashboard", {
    jobs: result.rows,
    technicianEmail
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Technician dashboard running");
});