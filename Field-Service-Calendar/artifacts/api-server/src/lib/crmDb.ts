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

// Detects errors that mean a Postgres database is unreachable rather than a
// genuine query/logic bug — e.g. a Neon compute endpoint that has been disabled
// or suspended ("The endpoint has been disabled. Enable it using the API and
// retry.", reported with code XX000), or a connection-level failure. Routes use
// this to return 503 (temporarily unavailable) instead of an opaque 500 so the
// frontend can show a clear, retryable state.
//
// The disabled/suspended *messages* are unambiguous (they only come from a Neon
// Postgres pool), so they always match. The socket-level codes
// (ECONNREFUSED, ETIMEDOUT, ...) are ambiguous in handlers that also call
// non-Postgres dependencies (e.g. the Dataverse HTTP API), so callers that mix
// dependencies pass `includeConnectionCodes = false` to avoid misattributing a
// Dataverse/network failure to the CRM database. SQLSTATE 08*/57P0* codes are
// Postgres-specific and only emitted by the pg driver.
export function isCrmUnavailableError(err: unknown, includeConnectionCodes = true): boolean {
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
    "57P01", // admin_shutdown
    "57P03", // cannot_connect_now
    "08000", // connection_exception
    "08001", // sqlclient_unable_to_establish_sqlconnection
    "08004", // sqlserver_rejected_establishment_of_sqlconnection
    "08006", // connection_failure
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
  ]);
  return !!e.code && connCodes.has(e.code);
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
