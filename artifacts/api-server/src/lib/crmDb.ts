import pg from "pg";

const { Pool } = pg;

// The d365crm password can contain characters (%, #, !, ^) that break URL
// percent-decoding, so parse the connection string manually and pass discrete
// fields to pg instead of relying on connectionString parsing.
function parseUrl(raw: string) {
  const m = raw.match(
    /^postg(?:res(?:ql)?):\/\/([^:]+):(.+)@([^:/]+)(?::(\d+))?\/([^?]+)(?:\?.*)?$/,
  );
  if (!m) {
    throw new Error("D365CRM_DATABASE_URL is not a valid postgres connection string");
  }
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: port ? Number(port) : 5432, database };
}

let pool: pg.Pool | null = null;

export function isCrmConfigured(): boolean {
  return !!process.env.D365CRM_DATABASE_URL;
}

// Lazily construct the pool so the API server (which also serves the
// technician-dashboard via the shared FS pool) can still boot even when the
// d365crm connection string is absent. Only the /wb/* read routes depend on it.
export function getCrmPool(): pg.Pool {
  if (!pool) {
    const raw = process.env.D365CRM_DATABASE_URL;
    if (!raw) {
      throw new Error("D365CRM_DATABASE_URL must be set for the d365crm (crm schema) database");
    }
    pool = new Pool({ ...parseUrl(raw), ssl: { rejectUnauthorized: false } });
  }
  return pool;
}
