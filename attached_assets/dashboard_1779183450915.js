<!DOCTYPE html>
<html>
<head>
  <title>Technician Dashboard</title>
  <style>
    body { font-family: Arial; background: #f5f7fa; padding: 30px; }
    .card { background: white; padding: 20px; margin-bottom: 15px; border-radius: 10px; box-shadow: 0 2px 8px #ccc; }
    .status { font-weight: bold; color: #0a66c2; }
  </style>
</head>
<body>
  <h1>Technician Job Dashboard</h1>
  <p>Showing jobs for: <b><%= technicianEmail %></b></p>

  <% jobs.forEach(job => { %>
    <div class="card">
      <h2><%= job.work_order_number %> - <%= job.title %></h2>
      <p><b>Customer:</b> <%= job.customer_name %></p>
      <p><b>Address:</b> <%= job.service_address %></p>
      <p><b>Priority:</b> <%= job.priority %></p>
      <p><b>Work Order Status:</b> <span class="status"><%= job.system_status %></span></p>
      <p><b>Booking Status:</b> <%= job.booking_status %></p>
      <p><b>Start:</b> <%= job.start_time %></p>
      <p><b>End:</b> <%= job.end_time %></p>
    </div>
  <% }) %>
</body>
</html>