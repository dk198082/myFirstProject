// import pg from "pg";
// import { buildPoolConfig } from "@workspace/db";

// const { Pool } = pg;

// if (!process.env.DATABASE_URL) {
//   throw new Error("DATABASE_URL must be set for the write-back queue database");
// }

// export const localPool = new Pool(buildPoolConfig(process.env.DATABASE_URL));

// import { pool } from "./db.js";

// // Temporarily use the same database
// export const localPool = pool;

import pg from "pg";

const { Pool } = pg;

console.log("Creating localPool", {
  host: process.env.FS_DB_HOST,
  db: process.env.FS_DB_NAME,
  user: process.env.FS_DB_USER,
});

export const localPool = new Pool({
  host: process.env.FS_DB_HOST,
  port: Number(process.env.FS_DB_PORT ?? 5432),
  database: process.env.FS_DB_NAME,
  user: process.env.FS_DB_USER,
  password: process.env.FS_DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
});

