import pg from "pg";
import { ClientSecretCredential } from "@azure/identity";
import { logger } from "./logger";

const { Pool } = pg;

const host     = process.env.AZURE_PG_HOST;
const database = process.env.AZURE_PG_DATABASE;
const user     = process.env.AZURE_PG_SP_USER ?? process.env.AZURE_PG_USER;
const port     = parseInt(process.env.AZURE_PG_PORT ?? "5432", 10);

const tenantId     = process.env.AZURE_TENANT_ID;
const clientId     = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

// PostgreSQL resource scope for Azure AD token auth
const PG_SCOPE = "https://ossrdbms-aad.database.windows.net/.default";

// Pool is recreated whenever the token is about to expire
let credential: ClientSecretCredential | null = null;
let activePool: pg.Pool | null = null;
let poolExpiresAt = 0;

/**
 * Fetches a fresh Azure AD access token using client-credential flow.
 * Falls back to PG_NATIVE_PASSWORD / AZURE_PG_PASSWORD if AAD creds are absent.
 */
async function getFreshToken(): Promise<string> {
  // Prefer native password auth when a password is configured — the DB user
  // (e.g. crmadmin) is a native password user, and AAD token auth only works
  // when the DB user is an Entra principal. The AZURE_CLIENT_* credentials
  // are used for D365 OData, not necessarily provisioned for PostgreSQL.
  const pwd = process.env.PG_NATIVE_PASSWORD ?? process.env.AZURE_PG_PASSWORD;
  if (pwd) {
    return pwd;
  }

  if (tenantId && clientId && clientSecret) {
    if (!credential) {
      credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    }
    const result = await credential.getToken(PG_SCOPE);
    logger.info("Azure AD token refreshed for PostgreSQL");
    return result.token;
  }

  throw new Error(
    "No database credentials: set PG_NATIVE_PASSWORD (or AZURE_PG_PASSWORD) for native auth, " +
    "or AZURE_CLIENT_SECRET+AZURE_TENANT_ID+AZURE_CLIENT_ID for AAD auth.",
  );
}

/**
 * Returns the active connection pool, creating or refreshing it when the
 * current AAD token is within 5 minutes of expiry (tokens last ~60 min).
 */
export async function getPool(): Promise<pg.Pool> {
  const now = Date.now();
  if (!activePool || now >= poolExpiresAt) {
    const password = await getFreshToken();

    // Gracefully drain the old pool before replacing it
    if (activePool) {
      activePool.end().catch((err) =>
        logger.warn({ err }, "Error draining old Azure PG pool"),
      );
    }

    activePool = new Pool({
    host: "fs-postgresql-prod.postgres.database.azure.com",
    port: 5432,
    database: "d365crm",   // or d365crm if that's the correct DB
    user: "crmadmin",
    password: "Dynam!c$#^%@AxAptA",
    ssl: {
        rejectUnauthorized: false,
       },
    });

    activePool.on("error", (err) =>
      logger.error({ err }, "Unexpected Azure PG pool error"),
    );

    // Refresh 5 minutes before the 60-minute token window closes
    poolExpiresAt = now + 55 * 60 * 1_000;
    logger.info({ host, database, user, poolExpiresAt: new Date(poolExpiresAt).toISOString() },
      "Azure PG pool (re)created");
  }

  return activePool;
}

// Keep the named export for any code that imported azurePool directly
export const azurePool = { query: (...args: unknown[]) => getPool().then(p => (p.query as (...a: unknown[]) => unknown)(...args)) };
