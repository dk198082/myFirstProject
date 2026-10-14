import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  msal: {
    getAuthCodeUrl: vi.fn(async () => "https://login.example.invalid/"),
    acquireTokenByCode: vi.fn(async () => ({ idTokenClaims: { oid: "test-oid", name: "Test User" } })),
  },
  query: vi.fn(), release: vi.fn(),
}));
vi.mock("../lib/auth.js", async (original) => ({
  ...await original<typeof import("../lib/auth.js")>(),
  isAuthConfigured: () => true, getMsalClient: () => mocks.msal,
}));
vi.mock("../lib/crmDb.js", () => ({
  isCrmConfigured: () => true,
  getCrmPool: () => ({ connect: async () => ({ query: mocks.query, release: mocks.release }) }),
}));
import authRouter from "./auth.js";
import invoiceRouter from "./proForma.js";
import { requireLogin, requireRole } from "../lib/auth.js";
vi.mock("../lib/crmIngestion.js", () => ({ refreshCrmIngestion: async () => {} }));

function app() {
  const server = express();
  server.use(express.json());
  server.use(session({ secret: "isolated-unit-test", resave: false, saveUninitialized: false }));
  server.use((req, _res, next) => { req.log = { error: vi.fn() } as unknown as typeof req.log; next(); });
  server.get("/seed", (req, res) => {
    req.session.authState = "valid";
    req.session.returnTo = req.query.invoice === "true" ? "/pro-forma-service-invoice/" : "/";
    if (req.query.user !== "none") req.session.user = {
      entraOid: "test-oid", email: "test@example.invalid", displayName: "Test User",
      role: req.query.role === "editor" ? "editor" : "viewer",
      calendarAccess: req.query.calendar !== "false",
    };
    res.sendStatus(204);
  });
  server.get("/api/calendar-read", requireLogin, (_req, res) => res.sendStatus(204));
  server.post("/api/calendar-write", requireRole("editor"), (_req, res) => res.sendStatus(204));
  server.use("/api", authRouter, invoiceRouter);
  return server;
}

let invoiceAllowed: boolean;
let calendarAllowed: boolean;
let invoiceRole: string;
let calendarRole: string;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_CONSOLE_URL", "https://admin.example.invalid");
  vi.stubEnv("ADMIN_CONSOLE_API_KEY", "fake-calendar-key");
  vi.stubEnv("PROFORMA_ADMIN_CONSOLE_API_KEY", "fake-invoice-key");
  invoiceAllowed = calendarAllowed = true;
  invoiceRole = "Pro Forma Service Invoice - Read / Write";
  calendarRole = "Field Service Calendar - Read Only";
  fetchMock = vi.fn(async (url: string) => {
    const invoice = new URL(url).searchParams.get("app") === "Pro Forma Service Invoice";
    return new Response(JSON.stringify({
      allowed: invoice ? invoiceAllowed : calendarAllowed,
      reason: null, roles: [invoice ? invoiceRole : calendarRole],
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  mocks.query.mockImplementation(async (sql: string) => ({ rows:
    sql.includes("FROM crm.proposalheader") ? [{
      workorderid: "test-wo", workordernumber: "123", serviceordernumber: "SV123",
      territory_name: "R1", currency: "USD", company_name: "TOUS",
      customeraccount: "TEST", account_name: "Test Account",
      company_address: "Test Address", remit_to: "Test Remittance",
    }] : sql.includes("FROM crm.proposalline") ? [{
      linenumber: 1, linetype: "FEE", description: "Test Service", uom: "Each",
      qty_orderd: "1", unitamount: "10", netamount: "10",
    }] : [],
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("independent invoice and Calendar authorization", () => {
  it("invoice-only login uses the invoice key and cannot grant Calendar read or write", async () => {
    const agent = request.agent(app());
    await agent.get("/seed?invoice=true&user=none");
    const login = await agent.get("/api/auth/callback?state=valid&code=test").expect(302);
    expect(login.headers.location).toBe("/pro-forma-service-invoice/");
    expect(fetchMock.mock.calls[0][0]).toContain("app=Pro%20Forma%20Service%20Invoice");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { "X-API-Key": "fake-invoice-key" } });
    await agent.get("/api/calendar-read").expect(403);
    await agent.post("/api/calendar-write").expect(403);
    expect((await agent.get("/api/me?app=proforma").expect(200)).body.role).toBe("editor");
    await agent.post("/api/calendar-write").expect(403);
  });
  it("Calendar login keeps its own key and cannot bypass denied invoice access", async () => {
    invoiceAllowed = false;
    const agent = request.agent(app());
    await agent.get("/seed?user=none");
    await agent.get("/api/auth/callback?state=valid&code=test").expect(302);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { "X-API-Key": "fake-calendar-key" } });
    await agent.get("/api/calendar-read").expect(204);
    await agent.get("/api/me?app=proforma").expect(403);
    await agent.post("/api/pro-forma/preview").send({ serviceOrderNumber: "SV123", tax: "0", freight: "0" }).expect(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("invoice access never promotes an existing Calendar viewer", async () => {
    const agent = request.agent(app());
    await agent.get("/seed?invoice=true");
    await agent.get("/api/auth/callback?state=valid&code=test").expect(302);
    expect((await agent.get("/api/me?app=proforma")).body.role).toBe("editor");
    expect((await agent.get("/api/me")).body.role).toBe("viewer");
    await agent.post("/api/calendar-write").expect(403);
  });
  it("an invoice-only session obtains Calendar access only through Calendar's check", async () => {
    const agent = request.agent(app());
    await agent.get("/seed?calendar=false");
    calendarAllowed = false;
    await agent.get("/api/me").expect(403);
    calendarAllowed = true; calendarRole = "Field Service Calendar - Read / Write";
    expect((await agent.get("/api/me").expect(200)).body.role).toBe("editor");
    expect(fetchMock.mock.calls.every(([url]) => new URL(url).searchParams.get("app") === "Field Service Calendar")).toBe(true);
    await agent.post("/api/calendar-write").expect(204);
  });
  it("does not fall back to the Calendar key if the invoice secret is missing", async () => {
    vi.stubEnv("PROFORMA_ADMIN_CONSOLE_API_KEY", "");
    const agent = request.agent(app()); await agent.get("/seed");
    await agent.get("/api/me?app=proforma").expect(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects another app's role and malformed/unavailable authorization responses", async () => {
    const agent = request.agent(app()); await agent.get("/seed");
    invoiceRole = "Field Service Calendar - Read / Write";
    await agent.get("/api/me?app=proforma").expect(403);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ allowed: true, roles: [null] })));
    await agent.get("/api/me?app=proforma").expect(503);
    fetchMock.mockRejectedValue(new Error("Unreachable"));
    await agent.get("/api/me?app=proforma").expect(503);
  });
  it("viewers can review defaults but cannot submit adjustments, even through direct API calls", async () => {
    invoiceRole = "Pro Forma Service Invoice - Read Only";
    const agent = request.agent(app()); await agent.get("/seed?role=editor");
    const input = { serviceOrderNumber: "SV123", tax: "0", freight: "0" };
    await agent.post("/api/pro-forma/preview").send(input).expect(200);
    mocks.query.mockClear();
    for (const adjustment of [{ tax: "1" }, { freight: "1" }, { customerTaxNumber: "123" }]) {
      await agent.post("/api/pro-forma/preview").send({ ...input, ...adjustment }).expect(403);
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("editors can prepare an invoice without any CRM writes", async () => {
    const agent = request.agent(app()); await agent.get("/seed");
    const preview = await agent.post("/api/pro-forma/preview").send({
      serviceOrderNumber: "SV123", tax: "10", freight: "2", customerTaxNumber: "00123",
    }).expect(200);
    expect(preview.body.totals.total).toBe("13.20");
    expect(preview.body.customerTaxNumber).toBe("00123");
    expect(mocks.query.mock.calls.some(([sql]) => /\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
  });
  it("revokes or downgrades invoice access on the very next request", async () => {
    const agent = request.agent(app()); await agent.get("/seed");
    expect((await agent.get("/api/me?app=proforma")).body.role).toBe("editor");
    invoiceRole = "Pro Forma Service Invoice - Read Only";
    expect((await agent.get("/api/me?app=proforma")).body.role).toBe("viewer");
    invoiceAllowed = false;
    await agent.get("/api/me?app=proforma").expect(403);
  });
  it("logout destroys the session and clears the cookie; old cookies cannot be reused", async () => {
    const server = app(); const agent = request.agent(server);
    const seed = await agent.get("/seed");
    const cookie = seed.headers["set-cookie"][0].split(";")[0];
    const logout = await agent.post("/api/logout").set("Accept", "application/json").expect(200);
    expect(logout.body.logoutUrl).toContain("login.microsoftonline.com");
    expect(logout.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970");
    await request(server).get("/api/me?app=proforma").set("Cookie", cookie).expect(401);
    await agent.get("/api/me").expect(401);
  });
});
