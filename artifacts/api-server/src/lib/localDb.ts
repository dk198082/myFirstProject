import pg from "pg";
import { buildPoolConfig } from "@workspace/db";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for the write-back queue database");
}

export const localPool = new Pool(buildPoolConfig(process.env.DATABASE_URL));
