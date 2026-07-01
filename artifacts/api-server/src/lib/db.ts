import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.FS_DB_HOST ?? "fs-postgresql-prod.postgres.database.azure.com",
  port: Number(process.env.FS_DB_PORT ?? 5432),
  database: process.env.FS_DB_NAME ?? "fieldservice",
  user: process.env.FS_DB_USER ?? "crmadmin",
  password: process.env.FS_DB_PASSWORD ?? "Dynam!c$#^%@AxAptA",
  ssl: { rejectUnauthorized: false },
});
