import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// `pg`'s connection-string parser (pg v8.16+ / pg-connection-string) prints a
// one-time security deprecation warning when a URL uses sslmode=prefer/require/
// verify-ca, because those modes will change meaning in pg v9. To silence it
// without changing behavior, we strip `sslmode` from the URL and configure `ssl`
// explicitly, preserving pg's current semantics across every environment:
//   disable            -> no TLS (e.g. the internal Replit dev database)
//   no-verify          -> TLS, do not verify the certificate
//   require/prefer/    -> TLS with full verification (what pg does today for
//   verify-ca/verify-full   these modes)
//   (unset)            -> no TLS (pg's default)
export function buildPoolConfig(raw: string): pg.PoolConfig {
  const sslmode = /[?&]sslmode=([^&]+)/i.exec(raw)?.[1]?.toLowerCase() ?? null;
  const connectionString = raw
    .replace(/([?&])sslmode=[^&]*&?/i, "$1")
    .replace(/[?&]$/, "");

  let ssl: pg.PoolConfig["ssl"];
  switch (sslmode) {
    case null:
    case "disable":
      ssl = false;
      break;
    case "no-verify":
      ssl = { rejectUnauthorized: false };
      break;
    default:
      ssl = { rejectUnauthorized: true };
  }

  return { connectionString, ssl };
}

export const pool = new Pool(buildPoolConfig(process.env.DATABASE_URL));
export const db = drizzle(pool, { schema });

export * from "./schema";
