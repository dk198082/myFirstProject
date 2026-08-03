/**
 * One-off script: insert a user into app.app_user so the local fallback auth works.
 * Usage: pnpm tsx scripts/insert-app-user.mts
 */
import pg from "pg";

const { Pool } = pg;

function buildPoolConfig(raw: string): pg.PoolConfig {
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

const dbUrl = process.env.FS_DATABASE_URL;
if (!dbUrl) throw new Error("FS_DATABASE_URL is not set");

const pool = new Pool(buildPoolConfig(dbUrl));

const users = [
  {
    entraOid: "9ecaf0d7-4c5f-4fc3-a739-3b770291f97d",
    email: "dwayne.hooper@tiniusolsen.co.uk",
    displayName: "Dwayne Hooper",
    role: "editor",
  },
];

for (const u of users) {
  const res = await pool.query(
    `INSERT INTO app.app_user (entra_oid, email, display_name, role, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (entra_oid) DO UPDATE
       SET email        = EXCLUDED.email,
           display_name = EXCLUDED.display_name,
           role         = EXCLUDED.role,
           is_active    = true,
           updated_at   = now()
     RETURNING entra_oid, email, role, is_active`,
    [u.entraOid, u.email, u.displayName, u.role],
  );
  console.log("Upserted:", res.rows[0]);
}

await pool.end();
console.log("Done.");
