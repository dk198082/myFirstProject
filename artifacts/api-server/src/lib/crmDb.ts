import pg from "pg";

const { Pool } = pg;

let pool: Pool | null = null;

export function getCrmPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.FS_DB_HOST,
      port: Number(process.env.FS_DB_PORT),
      database: process.env.FS_DB_NAME,
      user: process.env.FS_DB_USER,
      password: process.env.FS_DB_PASSWORD,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return pool;
}
