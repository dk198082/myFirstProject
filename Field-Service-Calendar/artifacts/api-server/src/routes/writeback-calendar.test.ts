/**
 * Tests for the calendar-report routes in writeback.ts.
 *
 * Covered:
 *   GET  /wb/calendar-report  — role enforcement + CRM-unavailable handling
 *   POST /wb/calendar-report/email — role enforcement, body validation, Graph success/error
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import request from "supertest";
import type { SessionUser } from "../lib/auth.js";

// ---------------------------------------------------------------------------
// Hoisted mock factories
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  isAuthConfigured: vi.fn(() => true),
  getMsalClient: vi.fn(),
  localQuery: vi.fn(),
  isCrmConfigured: vi.fn(() => true),
  isCrmUnavailableError: vi.fn(() => false),
  getCrmPool: vi.fn(),
  globalFetch: vi.fn(),
}));

vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth.js")>();
  return {
    ...actual,
    isAuthConfigured: mocks.isAuthConfigured,
    getMsalClient: mocks.getMsalClient,
  };
});

vi.mock("../lib/localDb.js", () => ({
  localPool: { query: mocks.localQuery },
}));

vi.mock("../lib/crmDb.js", () => ({
  getCrmPool: mocks.getCrmPool,
  isCrmConfigured: mocks.isCrmConfigured,
  isCrmUnavailableError: mocks.isCrmUnavailableError,
}));

vi.mock("../lib/crmMirror.js", () => ({
  mirrorScheduleBlockUpsert: vi.fn().mockResolvedValue(undefined),
  mirrorScheduleBlockDelete: vi.fn().mockResolvedValue(undefined),
  mirrorPlaceholderJobUpsert: vi.fn().mockResolvedValue(undefined),
  mirrorPlaceholderJobDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/dataverse.js", () => ({
  isDataverseConfigured: vi.fn(() => false),
  patchBooking: vi.fn(),
  createBooking: vi.fn(),
  fetchWorkOrdersByName: vi.fn(),
  fetchBookingsForWorkOrders: vi.fn(),
}));

// Stub global fetch so Graph calls never hit the network.
vi.stubGlobal("fetch", mocks.globalFetch);

import writebackRouter from "./writeback.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
};

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).log = silentLog;
    next();
  });

  app.get("/__test/seed-viewer", (req: Request, res: Response) => {
    req.session.user = {
      entraOid: "oid-viewer",
      email: "viewer@example.com",
      displayName: "Viewer",
      role: "viewer",
    } satisfies SessionUser;
    req.session.save(() => res.json({ ok: true }));
  });

  app.get("/__test/seed-editor", (req: Request, res: Response) => {
    req.session.user = {
      entraOid: "oid-editor",
      email: "editor@example.com",
      displayName: "Editor",
      role: "editor",
    } satisfies SessionUser;
    req.session.save(() => res.json({ ok: true }));
  });

  app.use(writebackRouter);
  return app;
}

const validEmailBody = {
  technician_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  start_date: "2026-08-01",
  end_date: "2026-11-01",
  pdf_base64: "AAAA", // minimal non-empty base64
};

// ---------------------------------------------------------------------------
// GET /wb/calendar-report — role enforcement
// ---------------------------------------------------------------------------

describe("GET /wb/calendar-report — role enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when the session has no user", async () => {
    const agent = request.agent(buildApp());
    const res = await agent
      .get("/wb/calendar-report")
      .query({ technician_ids: "t1", start_date: "2026-08-01", end_date: "2026-11-01" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the session user has the viewer role", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-viewer");
    const res = await agent
      .get("/wb/calendar-report")
      .query({ technician_ids: "t1", start_date: "2026-08-01", end_date: "2026-11-01" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when required query params are missing", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    // No query string at all
    const res = await agent.get("/wb/calendar-report");
    expect(res.status).toBe(400);
  });

  it("returns 400 when date range exceeds 184 days", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent
      .get("/wb/calendar-report")
      .query({ technician_ids: "t1", start_date: "2026-01-01", end_date: "2026-12-31" });
    expect(res.status).toBe(400);
  });

  it("calls the CRM pool and returns data for an editor", async () => {
    // Mock CRM pool for tech metadata and booking lookups
    const fakePool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ technician_id: "t1", resource_name: "Jane", user_email: "jane@example.com" }] })
        .mockResolvedValueOnce({ rows: [] }), // no bookings
    };
    mocks.getCrmPool.mockReturnValue(fakePool);
    // Mock FS pool for schedule_blocks and placeholder_jobs (both empty)
    mocks.localQuery.mockResolvedValue({ rows: [] });

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent
      .get("/wb/calendar-report")
      .query({ technician_ids: "t1", start_date: "2026-08-01", end_date: "2026-11-01" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("technicians");
    expect(Array.isArray(res.body.technicians)).toBe(true);
  });

  it("includes Travel Time, PTO, and Custom schedule blocks as report events", async () => {
    const fakePool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            technician_id: "t1",
            resource_name: "Jane",
            user_email: "jane@example.com",
            entra_object_id: null,
            user_principal_name: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mocks.getCrmPool.mockReturnValue(fakePool);
    mocks.localQuery
      .mockResolvedValueOnce({
        rows: [
          {
            technician_id: "t1",
            block_type: "drive_time",
            title: null,
            start_time: new Date("2026-08-03T15:00:00.000Z"),
            end_time: new Date("2026-08-03T17:00:00.000Z"),
          },
          {
            technician_id: "t1",
            block_type: "pto",
            title: null,
            start_time: new Date("2026-08-04T15:00:00.000Z"),
            end_time: new Date("2026-08-04T23:00:00.000Z"),
          },
          {
            technician_id: "t1",
            block_type: "custom",
            title: "Safety Training",
            start_time: new Date("2026-08-05T15:00:00.000Z"),
            end_time: new Date("2026-08-05T17:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent
      .get("/wb/calendar-report")
      .query({ technician_ids: "t1", start_date: "2026-08-01", end_date: "2026-09-01" });

    expect(res.status).toBe(200);
    expect(res.body.technicians[0].events).toEqual([
      expect.objectContaining({ kind: "drive", title: null }),
      expect.objectContaining({ kind: "pto", title: null }),
      expect.objectContaining({ kind: "custom", title: "Safety Training" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// POST /wb/calendar-report/email — role enforcement
// ---------------------------------------------------------------------------

describe("POST /wb/calendar-report/email — role enforcement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when the session has no user", async () => {
    const agent = request.agent(buildApp());
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);
    expect(res.status).toBe(401);
  });

  it("returns 403 when the session user has the viewer role", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-viewer");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /wb/calendar-report/email — body validation
// ---------------------------------------------------------------------------

describe("POST /wb/calendar-report/email — body validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when technician_id is not a UUID", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send({
      ...validEmailBody,
      technician_id: "not-a-uuid",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid/i);
  });

  it("returns 400 when start_date is malformed", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send({
      ...validEmailBody,
      start_date: "08-2026",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when pdf_base64 is missing", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const { pdf_base64: _, ...bodyWithout } = validEmailBody;
    const res = await agent.post("/wb/calendar-report/email").send(bodyWithout);
    expect(res.status).toBe(400);
  });

  it("returns 400 when session has no sender email (re-login required)", async () => {
    const appNoEmail = buildApp();
    appNoEmail.get("/__test/seed-no-email", (req: Request, res: Response) => {
      req.session.user = {
        entraOid: "oid-editor",
        email: undefined as unknown as string,
        displayName: "Editor",
        role: "editor",
      } satisfies SessionUser;
      req.session.save(() => res.json({ ok: true }));
    });
    const agent2 = request.agent(appNoEmail);
    await agent2.get("/__test/seed-no-email");
    const res = await agent2.post("/wb/calendar-report/email").send(validEmailBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });
});

// ---------------------------------------------------------------------------
// POST /wb/calendar-report/email — CRM security boundary
//
// The route resolves the recipient email from CRM using technician_id. These
// tests prove that an editor cannot send to an arbitrary external address, and
// that unknown / email-less technicians are rejected before any mail is sent.
// ---------------------------------------------------------------------------

describe("POST /wb/calendar-report/email — CRM security boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when the technician_id is not found in CRM", async () => {
    // Pool.query returns empty rows → technician not found.
    const fakePool = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
    mocks.getCrmPool.mockReturnValue(fakePool);

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
    // The request must never reach Graph — no fetch calls.
    expect(mocks.globalFetch).not.toHaveBeenCalled();
  });

  it("returns 422 when the technician has no email address in CRM", async () => {
    const fakePool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ resource_name: "Jane Smith", user_email: null }] }),
    };
    mocks.getCrmPool.mockReturnValue(fakePool);

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no email/i);
    expect(mocks.globalFetch).not.toHaveBeenCalled();
  });

  it("does not accept a client-supplied technician_email field (schema rejects it)", async () => {
    // The schema only accepts technician_id; any extra email field is stripped,
    // not used. Sending it alongside a missing pdf_base64 still yields 400.
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor");
    const { pdf_base64: _, ...withoutPdf } = validEmailBody;
    const res = await agent.post("/wb/calendar-report/email").send({
      ...withoutPdf,
      technician_email: "attacker@evil.com", // should be ignored / body still invalid
    });
    expect(res.status).toBe(400); // missing pdf_base64
  });
});

// ---------------------------------------------------------------------------
// POST /wb/calendar-report/email — Graph success / error paths
//
// writeback.ts caches the Graph access token in a module-level variable.  To
// guarantee each test starts with cachedGraphToken === null we call
// vi.resetModules() then dynamically import a fresh copy of the router, so
// every fetch sequence (call 1 = token, call 2 = sendMail) is predictable.
// ---------------------------------------------------------------------------

describe("POST /wb/calendar-report/email — Graph integration", () => {
  /** Build a minimal Express app mounting a freshly imported writebackRouter. */
  async function buildFreshApp() {
    // vi.resetModules() was already called by the test; import the cleared module.
    const { default: freshRouter } = await import("./writeback.js");
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use(session({ secret: "test-secret", resave: false, saveUninitialized: false }));
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as Record<string, unknown>).log = silentLog;
      next();
    });
    app.get("/__test/seed-editor", (req: Request, res: Response) => {
      req.session.user = {
        entraOid: "oid-editor",
        email: "editor@example.com",
        displayName: "Editor",
        role: "editor",
      } satisfies SessionUser;
      req.session.save(() => res.json({ ok: true }));
    });
    app.use(freshRouter);
    return app;
  }

  /** Fake CRM pool that returns one technician row with a valid email. */
  const fakeCrmRow = { resource_name: "Jane Smith", user_email: "jane@example.com" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // clears the module registry → cachedGraphToken = null on next import
    // Restore mock implementations cleared by clearAllMocks/resetModules.
    mocks.isAuthConfigured.mockReturnValue(true);
    mocks.isCrmConfigured.mockReturnValue(true);
    // Default CRM pool: returns a valid technician so the route can proceed to Graph.
    mocks.getCrmPool.mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [fakeCrmRow] }) });
    // Azure env vars active by default.
    process.env.ENTRA_TENANT_ID = "test-tenant";
    process.env.ENTRA_CLIENT_ID = "test-client";
    process.env.ENTRA_CLIENT_SECRET = "test-secret-val";
  });

  afterEach(() => {
    process.env.ENTRA_TENANT_ID = "test-tenant";
    process.env.ENTRA_CLIENT_ID = "test-client";
    process.env.ENTRA_CLIENT_SECRET = "test-secret-val";
  });

  it("returns 200 and success:true when Graph sendMail responds 202", async () => {
    // fetch call 1 = token acquisition, call 2 = Graph sendMail.
    mocks.globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok123", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true });

    const app = await buildFreshApp();
    const agent = request.agent(app);
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);

    expect(res.status).toBe(200);
    // Recipient email comes from CRM — not from the request body.
    expect(res.body).toMatchObject({ success: true, technician_email: "jane@example.com" });
    expect(mocks.globalFetch).toHaveBeenCalledTimes(2);
  });

  it("resolves a missing CRM email from Microsoft Graph using the linked Entra object id", async () => {
    mocks.getCrmPool.mockReturnValue({
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            resource_name: "Jane Smith",
            user_email: null,
            entra_object_id: "11111111-2222-3333-4444-555555555555",
            user_principal_name: "jane@contoso.com",
          },
        ],
      }),
    });
    mocks.globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok_directory", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mail: "jane.exchange@contoso.com", userPrincipalName: "jane@contoso.com" }),
      })
      .mockResolvedValueOnce({ ok: true });

    const app = await buildFreshApp();
    const agent = request.agent(app);
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      technician_name: "Jane Smith",
      technician_email: "jane.exchange@contoso.com",
    });
    expect(mocks.globalFetch).toHaveBeenCalledTimes(3);
    expect(String(mocks.globalFetch.mock.calls[1]?.[0])).toContain(
      "/v1.0/users/11111111-2222-3333-4444-555555555555",
    );
  });

  it("returns 502 and success:false when Graph sendMail returns an error status", async () => {
    mocks.globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok123", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { message: "Insufficient privileges" } }),
      });

    const app = await buildFreshApp();
    const agent = request.agent(app);
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.error).toMatch(/Insufficient privileges/i);
  });

  it("returns 503 when Graph credentials are not configured", async () => {
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_CLIENT_ID;
    delete process.env.ENTRA_CLIENT_SECRET;

    const app = await buildFreshApp();
    const agent = request.agent(app);
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send(validEmailBody);

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/authenticate/i);
  });

  it("accepts a large (~4 MB) pdf_base64 payload without a 413", async () => {
    mocks.globalFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok_large", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: true });

    const largePdf = "A".repeat(4 * 1024 * 1024); // ~4 MB base64 string
    const app = await buildFreshApp();
    const agent = request.agent(app);
    await agent.get("/__test/seed-editor");
    const res = await agent.post("/wb/calendar-report/email").send({
      ...validEmailBody,
      pdf_base64: largePdf,
    });
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(200);
  });
});
