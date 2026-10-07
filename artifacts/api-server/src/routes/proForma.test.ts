import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(() => true), query: vi.fn(), release: vi.fn() }));
vi.mock("../lib/crmDb.js", () => ({
  isCrmConfigured: mocks.configured,
  getCrmPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }),
}));
import router from "./proForma";

const input = { serviceOrderNumber: "SV123", freight: "1.25", tax: "2.50" };
const header = {
  workorderid: "test-id", workordernumber: "WO123", serviceordernumber: "SV123",
  territory_name: "R1", currency: "USD", company_name: "TOUS",
  customeraccount: "TEST", account_name: "Test Account",
  company_address: "Test address", remit_to: "Test remittance",
};
const line = { linenumber: 1, linetype: "FEE", description: "Calibration", uom: "", qty_orderd: "1", unitamount: "10", netamount: "10" };
function app() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() } as unknown as typeof req.log;
    next();
  });
  // In-memory unit test harness only. Never mounted by the application.
  app.get("/seed", (req, res) => {
    req.session.user = { entraOid: "test", email: "test@example.invalid", displayName: "Test", role: "viewer" };
    res.sendStatus(204);
  });
  app.use("/api", router);
  return app;
}
async function signedIn() {
  const agent = request.agent(app()); await agent.get("/seed"); return agent;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("FROM crm.proposalheader") ? [header] : sql.includes("FROM crm.proposalline") ? [line] : [],
  }));
});
describe("read-only pro forma endpoint", () => {
  it("requires the real login middleware", async () => {
    await request(app()).post("/api/pro-forma/preview").send(input).expect(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns precise totals to an authenticated viewer without writes", async () => {
    const res = await (await signedIn()).post("/api/pro-forma/preview").send(input).expect(200);
    expect(res.body.totals.total).toBe("13.75");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mocks.query.mock.calls.some(([sql]) => /\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
    expect(mocks.release).toHaveBeenCalled();
  });
  it.each(["839709", "SV-001360"])("accepts %s and joins lines using the resolved CRM identifiers", async (number) => {
    const resolved = { ...header, workordernumber: "839709", serviceordernumber: "SV-001360", territory_name: "R4", currency: "GBP", company_name: "TOUK" };
    mocks.query.mockImplementation(async (sql: string, params?: string[]) => {
      if (sql.includes("FROM crm.proposalheader")) {
        expect(sql).toMatch(/serviceordernumber = \$1 OR workordernumber = \$1/);
        expect(params).toEqual([number]);
        return { rows: [resolved] };
      }
      if (sql.includes("FROM crm.proposalline")) {
        expect(params).toEqual(["test-id", "SV-001360"]);
        return { rows: [line] };
      }
      return { rows: [] };
    });
    const res = await (await signedIn()).post("/api/pro-forma/preview").send({ ...input, serviceOrderNumber: number }).expect(200);
    expect(res.body.serviceOrderNumber).toBe("SV-001360");
    expect(res.body.reference).toBe("839709 / SV-001360");
    expect(res.body.currency).toBe("GBP");
  });
  it.each([
    { tax: "-1" }, { tax: "" }, { tax: "1.234" }, { freight: "-1" }, { freight: "NaN" },
    { freight: 2 }, { serviceOrderNumber: "   " }, { serviceOrderNumber: "bad\u0000order" },
  ])("rejects invalid input %j", async (patch) => {
    await (await signedIn()).post("/api/pro-forma/preview").send({ ...input, ...patch }).expect(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("binds order input, never interpolates SQL", async () => {
    await (await signedIn()).post("/api/pro-forma/preview").send({ ...input, serviceOrderNumber: "' OR 1=1 --" }).expect(200);
    const call = mocks.query.mock.calls.find(([sql]) => sql.includes("FROM crm.proposalheader"));
    expect(call?.[0]).not.toContain("' OR 1=1");
    expect(call?.[1]).toEqual(["' OR 1=1 --"]);
  });
  it.each([[0, 404], [2, 409]])("handles %s matching headers", async (count, status) => {
    mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("FROM crm.proposalheader") ? Array(count).fill(header) : [] }));
    await (await signedIn()).post("/api/pro-forma/preview").send(input).expect(status);
  });
  it("does not leak database errors", async () => {
    mocks.query.mockRejectedValue(new Error("private database diagnostic"));
    const res = await (await signedIn()).post("/api/pro-forma/preview").send(input).expect(503);
    expect(JSON.stringify(res.body)).not.toContain("private database");
  });
  it("fails explicitly when CRM is not configured", async () => {
    mocks.configured.mockReturnValue(false);
    await (await signedIn()).post("/api/pro-forma/preview").send(input).expect(503);
  });
});
