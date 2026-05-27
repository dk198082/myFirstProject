import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for the write-back queue database");
}

export const localPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
