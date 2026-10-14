import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { mirrorFees } from "./crmFeeIngestion.js";

const fee = {
  msdyn_workorderserviceid: "11111111-1111-4111-8111-111111111111",
  _msdyn_workorder_value: "22222222-2222-4222-8222-222222222222",
  msdyn_lineorder: 1, msdyn_unitcost: 125.50, msdyn_unitamount: 999,
  modifiedon: "2026-10-09T09:53:05Z", createdon: "2026-10-07T13:49:07Z",
  "cf_projectcategorylist@OData.Community.Display.V1.FormattedValue": "Test service",
  "_msdyn_unit_value@OData.Community.Display.V1.FormattedValue": "Each",
};
function client() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query, client: { query } as unknown as pg.PoolClient };
}

describe("fee mirror mapping", () => {
  it("maps CRM annotations to the existing view fields and preserves unit cost pricing", async () => {
    const c = client();
    await mirrorFees(c.client, [fee]);
    const rows = JSON.parse(c.query.mock.calls[0][1][0]);
    expect(rows[0]).toMatchObject({
      id: fee.msdyn_workorderserviceid, workorder: fee._msdyn_workorder_value,
      line: 1, cost: 125.50, description: "Test service", uom: "Each", raw_json: fee,
    });
    expect(c.query.mock.calls[0][0]).toContain("crm.fees.modifiedon <= EXCLUDED.modifiedon");
    expect(c.query.mock.calls[0][0]).toContain("AT TIME ZONE 'UTC'");
  });
  it("keeps legitimate zero costs, and does not invent costs for missing prices", async () => {
    const c = client();
    await mirrorFees(c.client, [{ ...fee, msdyn_unitcost: 0 }]);
    expect(JSON.parse(c.query.mock.calls[0][1][0])[0].cost).toBe(0);
    c.query.mockClear();
    await mirrorFees(c.client, [{ ...fee, msdyn_unitcost: null }]);
    expect(JSON.parse(c.query.mock.calls[0][1][0])[0].cost).toBeNull();
  });
  it("deduplicates page overlap using the newest modification timestamp", async () => {
    const c = client();
    await mirrorFees(c.client, [fee, { ...fee, modifiedon: "2026-10-08T00:00:00Z", msdyn_unitcost: 1 }]);
    const rows = JSON.parse(c.query.mock.calls[0][1][0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cost).toBe(125.50);
  });
  it("uses bounded batches and skips empty results", async () => {
    const c = client();
    await mirrorFees(c.client, []);
    expect(c.query).not.toHaveBeenCalled();
    await mirrorFees(c.client, Array.from({ length: 501 }, (_, i) => ({
      ...fee, msdyn_workorderserviceid: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
    })));
    expect(c.query).toHaveBeenCalledTimes(2);
    expect(JSON.parse(c.query.mock.calls[0][1][0])).toHaveLength(500);
    expect(JSON.parse(c.query.mock.calls[1][1][0])).toHaveLength(1);
  });
  it("fails before writing if an ID or modification timestamp is invalid", async () => {
    const c = client();
    await expect(mirrorFees(c.client, [{ ...fee, modifiedon: null }])).rejects.toThrow("timestamp");
    await expect(mirrorFees(c.client, [{ ...fee, msdyn_workorderserviceid: null }])).rejects.toThrow("ID");
    expect(c.query).not.toHaveBeenCalled();
  });
});
