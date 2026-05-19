import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: "fs-postgresql-prod.postgres.database.azure.com",
  port: 5432,
  database: "fieldservice",
  user: "crmadmin",
  password: "Dynam!c$#^%@AxAptA",
  ssl: { rejectUnauthorized: false },
});
