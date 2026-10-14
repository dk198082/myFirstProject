import type pg from "pg";

type Row = Record<string, unknown>;
const FV = "@OData.Community.Display.V1.FormattedValue";
const text = (v: unknown) => typeof v === "string" ? v : null;

/** Preserve the proposal view's pricing: quantity 1 and unit cost, not unit selling price. */
export async function mirrorFees(client: pg.PoolClient, rows: Row[]): Promise<void> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const id = text(row.msdyn_workorderserviceid);
    const modified = text(row.modifiedon);
    if (!id || !modified || !Number.isFinite(Date.parse(modified))) {
      throw new Error("Dataverse fee is missing its ID or valid modification timestamp");
    }
    const previous = latest.get(id);
    if (!previous || Date.parse(modified) >= Date.parse(String(previous.modifiedon))) latest.set(id, row);
  }
  const records = [...latest.values()].map((row) => ({
    id: row.msdyn_workorderserviceid,
    workorder: text(row._msdyn_workorder_value),
    line: row.msdyn_lineorder ?? null,
    cost: row.msdyn_unitcost ?? null,
    description: text(row[`cf_projectcategorylist${FV}`]) ?? text(row.cf_projectcategorylistname),
    uom: text(row[`_msdyn_unit_value${FV}`]) ?? text(row.msdyn_unitname),
    createdon: text(row.createdon),
    modifiedon: text(row.modifiedon),
    raw_json: row,
  }));
  for (let offset = 0; offset < records.length; offset += 500) {
    await client.query(`
      INSERT INTO crm.fees (
        msdyn_workorderserviceid, msdyn_workorder, msdyn_lineorder, msdyn_unitcost,
        cf_projectcategorylistname, msdyn_unitname, createdon, modifiedon,
        raw_json, is_deleted, synced_on
      )
      SELECT r.id, r.workorder, r.line, r.cost, r.description, r.uom,
        r.createdon AT TIME ZONE 'UTC', r.modifiedon AT TIME ZONE 'UTC',
        r.raw_json, false, now() AT TIME ZONE 'UTC'
      FROM jsonb_to_recordset($1::jsonb) AS r(
        id uuid, workorder uuid, line integer, cost numeric, description text,
        uom text, createdon timestamptz, modifiedon timestamptz, raw_json jsonb
      )
      ON CONFLICT (msdyn_workorderserviceid) DO UPDATE SET
        msdyn_workorder = EXCLUDED.msdyn_workorder,
        msdyn_lineorder = EXCLUDED.msdyn_lineorder,
        msdyn_unitcost = EXCLUDED.msdyn_unitcost,
        cf_projectcategorylistname = EXCLUDED.cf_projectcategorylistname,
        msdyn_unitname = EXCLUDED.msdyn_unitname,
        createdon = EXCLUDED.createdon, modifiedon = EXCLUDED.modifiedon,
        raw_json = EXCLUDED.raw_json, is_deleted = false, synced_on = EXCLUDED.synced_on
      WHERE crm.fees.modifiedon IS NULL OR crm.fees.modifiedon <= EXCLUDED.modifiedon
    `, [JSON.stringify(records.slice(offset, offset + 500))]);
  }
}
