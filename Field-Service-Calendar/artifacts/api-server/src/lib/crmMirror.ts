import { getCrmPool, isCrmConfigured } from "./crmDb.js";

// Best-effort mirroring of placeholder_jobs / schedule_blocks writes into the
// d365crm Postgres (schema `crm`). The Replit database remains the source of
// truth; mirror failures are logged but never fail the primary request.

type LogFn = { warn: (obj: unknown, msg?: string) => void };

async function mirror(
  log: LogFn,
  label: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  if (!isCrmConfigured()) return;
  try {
    await fn();
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      `CRM mirror failed: ${label}`,
    );
  }
}

export interface PlaceholderJobRow {
  id: number;
  technician_id: string;
  title: string;
  customer_name: string | null;
  city: string | null;
  state: string | null;
  service_location_id: string | null;
  color_index: number | null;
  start_time: Date | string;
  end_time: Date | string;
  notes: string | null;
  status: string | null;
  created_at: Date | string;
}

export function mirrorPlaceholderJobUpsert(log: LogFn, row: PlaceholderJobRow): Promise<void> {
  return mirror(log, `placeholder_jobs upsert id=${row.id}`, () =>
    getCrmPool().query(
      `INSERT INTO crm.placeholder_jobs
         (id, technician_id, title, customer_name, city, state, service_location_id, color_index, start_time, end_time, notes, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO UPDATE SET
         technician_id = EXCLUDED.technician_id,
         title = EXCLUDED.title,
         customer_name = EXCLUDED.customer_name,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         service_location_id = EXCLUDED.service_location_id,
         color_index = EXCLUDED.color_index,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         notes = EXCLUDED.notes,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at`,
      [
        row.id,
        row.technician_id,
        row.title,
        row.customer_name ?? null,
        row.city ?? null,
        row.state ?? null,
        row.service_location_id ?? null,
        row.color_index ?? null,
        row.start_time,
        row.end_time,
        row.notes ?? null,
        row.status ?? null,
        row.created_at,
      ],
    ),
  );
}

export function mirrorPlaceholderJobDelete(log: LogFn, id: number): Promise<void> {
  return mirror(log, `placeholder_jobs delete id=${id}`, () =>
    getCrmPool().query(`DELETE FROM crm.placeholder_jobs WHERE id = $1`, [id]),
  );
}

export interface ScheduleBlockRow {
  id: number;
  technician_id: string;
  block_type: string;
  title: string | null;
  start_time: Date | string;
  end_time: Date | string;
  notes: string | null;
  color_index: number | null;
  created_at: Date | string;
}

export function mirrorScheduleBlockUpsert(log: LogFn, row: ScheduleBlockRow): Promise<void> {
  return mirror(log, `schedule_blocks upsert id=${row.id}`, () =>
    getCrmPool().query(
      `INSERT INTO crm.schedule_blocks
         (id, technician_id, block_type, title, start_time, end_time, notes, color_index, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         technician_id = EXCLUDED.technician_id,
         block_type = EXCLUDED.block_type,
         title = EXCLUDED.title,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         notes = EXCLUDED.notes,
         color_index = EXCLUDED.color_index,
         created_at = EXCLUDED.created_at`,
      [
        row.id,
        row.technician_id,
        row.block_type,
        row.title ?? null,
        row.start_time,
        row.end_time,
        row.notes ?? null,
        row.color_index ?? null,
        row.created_at,
      ],
    ),
  );
}

export function mirrorScheduleBlockDelete(log: LogFn, id: number): Promise<void> {
  return mirror(log, `schedule_blocks delete id=${id}`, () =>
    getCrmPool().query(`DELETE FROM crm.schedule_blocks WHERE id = $1`, [id]),
  );
}
