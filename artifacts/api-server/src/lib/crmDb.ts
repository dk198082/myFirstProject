import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function isCrmConfigured(): boolean {
  return !!(
    process.env.FS_DB_HOST &&
    process.env.FS_DB_NAME &&
    process.env.FS_DB_USER &&
    process.env.FS_DB_PASSWORD
  );
}

export function isCrmUnavailableError(
  err: unknown,
  includeConnectionCodes = true,
): boolean {
  if (!err || typeof err !== "object") return false;

  const e = err as { code?: string; message?: string };
  const msg = (e.message ?? "").toLowerCase();

  if (
    msg.includes("endpoint has been disabled") ||
    msg.includes("endpoint is disabled") ||
    msg.includes("endpoint could not be found") ||
    msg.includes("control plane request failed")
  ) {
    return true;
  }

  if (!includeConnectionCodes) return false;

  const connCodes = new Set([
    "57P01",
    "57P03",
    "08000",
    "08001",
    "08004",
    "08006",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
  ]);

  return !!e.code && connCodes.has(e.code);
}

export function getCrmPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.FS_DB_HOST,
      port: Number(process.env.FS_DB_PORT ?? 5432),
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
