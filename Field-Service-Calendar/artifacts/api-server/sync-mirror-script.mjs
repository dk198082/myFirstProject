/**
 * Mirror sync: reads all rows from the Replit source-of-truth DB
 * (DATABASE_URL) and upserts every row into crm.placeholder_jobs /
 * crm.schedule_blocks in the CRM Postgres (D365CRM_DATABASE_URL).
 * Safe to run multiple times — ON CONFLICT DO UPDATE.
 *
 * Run from inside artifacts/api-server/:
 *   DATABASE_URL="<prod-url>" node sync-mirror-script.mjs
 * (D365CRM_DATABASE_URL is picked up from the shell environment)
 */
import pg from "pg";
const { Pool } = pg;

function parseUrl(raw) {
  const m = raw.match(
    /^postg(?:res(?:ql)?):\/\/([^:]+):(.+)@([^:/]+)(?::(\d+))?\/([^?]+)(?:\?.*)?$/,
  );
  if (!m) throw new Error("Not a valid postgres connection string: " + raw.slice(0, 40) + "...");
  const [, user, password, host, port, database] = m;
  return { user, password, host, port: port ? Number(port) : 5432, database };
}

async function main() {
  const sourceUrl = process.env.DATABASE_URL;
  const crmUrl = process.env.D365CRM_DATABASE_URL;
  if (!sourceUrl) throw new Error("DATABASE_URL is required");
  if (!crmUrl) throw new Error("D365CRM_DATABASE_URL is required");

  // Strip sslmode from URL and set ssl explicitly (mirrors lib/db behaviour)
  const cleanSource = sourceUrl.replace(/[?&]sslmode=[^&]*/g, "").replace(/[?&]$/, "");
  const useSsl = !sourceUrl.includes("sslmode=disable");
  const sourcePool = new Pool({
    connectionString: cleanSource,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  });

  const crmPool = new Pool({
    ...parseUrl(crmUrl),
    ssl: { rejectUnauthorized: false },
  });

  try {
    // 1. Read all source rows
    const [pjSrc, sbSrc] = await Promise.all([
      sourcePool.query(
        `SELECT id, technician_id, title, customer_name, city, state,
                service_location_id, color_index, start_time, end_time,
                notes, status, created_at
         FROM placeholder_jobs ORDER BY id`,
      ),
      sourcePool.query(
        `SELECT id, technician_id, block_type, title, start_time, end_time,
                notes, color_index, created_at
         FROM schedule_blocks ORDER BY id`,
      ),
    ]);

    // 2. Read mirror IDs for gap reporting
    const [mirrorPjIds, mirrorSbIds] = await Promise.all([
      crmPool.query(`SELECT id FROM crm.placeholder_jobs`),
      crmPool.query(`SELECT id FROM crm.schedule_blocks`),
    ]);
    const mirrorPjSet = new Set(mirrorPjIds.rows.map((r) => r.id));
    const mirrorSbSet = new Set(mirrorSbIds.rows.map((r) => r.id));

    console.log("=== Pre-sync comparison ===");
    const pjMissing = pjSrc.rows.filter((r) => !mirrorPjSet.has(r.id));
    const sbMissing = sbSrc.rows.filter((r) => !mirrorSbSet.has(r.id));
    console.log(`placeholder_jobs — source: ${pjSrc.rows.length}, mirror: ${mirrorPjSet.size}, missing: ${pjMissing.length}${pjMissing.length ? " ids: " + pjMissing.map(r=>r.id).join(",") : ""}`);
    console.log(`schedule_blocks  — source: ${sbSrc.rows.length}, mirror: ${mirrorSbSet.size}, missing: ${sbMissing.length}${sbMissing.length ? " ids: " + sbMissing.map(r=>r.id).join(",") : ""}`);
    console.log("");

    // 3. Upsert placeholder_jobs
    let pjOk = 0, pjErr = 0;
    for (const row of pjSrc.rows) {
      try {
        await crmPool.query(
          `INSERT INTO crm.placeholder_jobs
             (id, technician_id, title, customer_name, city, state,
              service_location_id, color_index, start_time, end_time,
              notes, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             technician_id       = EXCLUDED.technician_id,
             title               = EXCLUDED.title,
             customer_name       = EXCLUDED.customer_name,
             city                = EXCLUDED.city,
             state               = EXCLUDED.state,
             service_location_id = EXCLUDED.service_location_id,
             color_index         = EXCLUDED.color_index,
             start_time          = EXCLUDED.start_time,
             end_time            = EXCLUDED.end_time,
             notes               = EXCLUDED.notes,
             status              = EXCLUDED.status,
             created_at          = EXCLUDED.created_at`,
          [
            row.id, row.technician_id, row.title,
            row.customer_name ?? null, row.city ?? null, row.state ?? null,
            row.service_location_id ?? null, row.color_index ?? null,
            row.start_time, row.end_time,
            row.notes ?? null, row.status ?? null, row.created_at,
          ],
        );
        pjOk++;
      } catch (e) {
        pjErr++;
        console.error(`  ✗ placeholder_jobs id=${row.id}: ${e.message}`);
      }
    }

    // 4. Upsert schedule_blocks
    let sbOk = 0, sbErr = 0;
    for (const row of sbSrc.rows) {
      try {
        await crmPool.query(
          `INSERT INTO crm.schedule_blocks
             (id, technician_id, block_type, title, start_time, end_time,
              notes, color_index, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             technician_id = EXCLUDED.technician_id,
             block_type    = EXCLUDED.block_type,
             title         = EXCLUDED.title,
             start_time    = EXCLUDED.start_time,
             end_time      = EXCLUDED.end_time,
             notes         = EXCLUDED.notes,
             color_index   = EXCLUDED.color_index,
             created_at    = EXCLUDED.created_at`,
          [
            row.id, row.technician_id, row.block_type, row.title ?? null,
            row.start_time, row.end_time,
            row.notes ?? null, row.color_index ?? null, row.created_at,
          ],
        );
        sbOk++;
      } catch (e) {
        sbErr++;
        console.error(`  ✗ schedule_blocks id=${row.id}: ${e.message}`);
      }
    }

    // 5. Post-sync verification + sequence reset
    const [afterPj, afterSb, maxPj, maxSb] = await Promise.all([
      crmPool.query(`SELECT COUNT(*) AS cnt FROM crm.placeholder_jobs`),
      crmPool.query(`SELECT COUNT(*) AS cnt FROM crm.schedule_blocks`),
      sourcePool.query(`SELECT COALESCE(MAX(id), 1) AS max FROM placeholder_jobs`),
      sourcePool.query(`SELECT COALESCE(MAX(id), 1) AS max FROM schedule_blocks`),
    ]);

    console.log("=== Post-sync results ===");
    console.log(`placeholder_jobs — upserted: ${pjOk}, errors: ${pjErr}, mirror total: ${afterPj.rows[0].cnt} (source max id: ${maxPj.rows[0].max})`);
    console.log(`schedule_blocks  — upserted: ${sbOk}, errors: ${sbErr}, mirror total: ${afterSb.rows[0].cnt} (source max id: ${maxSb.rows[0].max})`);

    // NOTE: sequence reset (setval) applies to the SOURCE DB (Replit prod) not the CRM mirror.
    // The CRM mirror uses plain integer PKs (no serial), so no sequence to reset there.
    // Run the following on the TARGET Azure DB when you go live:
    //   SELECT setval('placeholder_jobs_id_seq', (SELECT MAX(id) FROM placeholder_jobs));
    //   SELECT setval('schedule_blocks_id_seq',  (SELECT MAX(id) FROM schedule_blocks));
    console.log("\nREMINDER: Reset sequences on the target Azure DB after migrating:");
    console.log("  SELECT setval('placeholder_jobs_id_seq', (SELECT MAX(id) FROM placeholder_jobs));");
    console.log("  SELECT setval('schedule_blocks_id_seq',  (SELECT MAX(id) FROM schedule_blocks));");
    console.log("");

    const ok = pjErr === 0 && sbErr === 0;
    if (ok) {
      console.log("✓ Mirror is fully in sync with the source database.");
    } else {
      console.error("✗ Sync completed with errors — review the output above.");
      process.exit(1);
    }
  } finally {
    await Promise.all([sourcePool.end().catch(() => {}), crmPool.end().catch(() => {})]);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
