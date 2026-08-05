/**
 * Integration tests for role-gated write routes in writeback.ts.
 *
 * Strategy
 * --------
 * • lib/auth.js is *partially* mocked: only the MSAL helpers are stubbed.
 *   requireRole (and requireLogin) come through the spread of the real module,
 *   so removing or miswiring requireRole on a route will cause these tests to
 *   fail immediately.
 * • lib/localDb.js, lib/crmDb.js, lib/crmMirror.js, and lib/dataverse.js are
 *   fully mocked so no real database or Azure connections are needed.
 * • Two session-seed helpers let each test choose a viewer-role or editor-role
 *   session independently of the auth login flow.
 *
 * Covered route (representative write operation):
 *   POST /wb/schedule-blocks — create a schedule block
 *   DELETE /wb/schedule-blocks/:id — delete a schedule block
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
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
  isCrmConfigured: vi.fn(() => false),
  isCrmUnavailableError: vi.fn(() => false),
}));

/**
 * Partially mock lib/auth.js:
 *   - Keep requireRole and requireLogin as their real implementations.
 *   - Stub isAuthConfigured and getMsalClient (never call Azure in tests).
 *   - Spread the rest (REDIRECT_URI, LOGIN_SCOPES, LOGOUT_URL, …) from the
 *     actual module so the router can still import them.
 */
vi.mock("../lib/auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth.js")>();
  return {
    ...actual,
    isAuthConfigured: mocks.isAuthConfigured,
    getMsalClient: mocks.getMsalClient,
    // requireRole and requireLogin come through the spread — real code.
  };
});

vi.mock("../lib/localDb.js", () => ({
  localPool: { query: mocks.localQuery },
}));

vi.mock("../lib/crmDb.js", () => ({
  getCrmPool: vi.fn(),
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

// Import the real writebackRouter AFTER mocks are registered.
// eslint-disable-next-line import/first
import writebackRouter from "./writeback.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Silent req.log stub (pino-http normally attaches this). */
const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLog,
};

/**
 * Build a minimal Express app with:
 *   - In-memory session store (no DB)
 *   - /__test/seed-viewer  → session.user with role "viewer"
 *   - /__test/seed-editor  → session.user with role "editor"
 *   - The real writebackRouter mounted at /api (where the server mounts it)
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: "test-secret", resave: false, saveUninitialized: false }),
  );
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).log = silentLog;
    next();
  });

  app.get("/__test/seed-viewer", (req: Request, res: Response) => {
    req.session.user = {
      entraOid: "oid-viewer",
      email: "viewer@example.com",
      displayName: "Viewer User",
      role: "viewer",
    } satisfies SessionUser;
    req.session.save(() => res.json({ ok: true }));
  });

  app.get("/__test/seed-editor", (req: Request, res: Response) => {
    req.session.user = {
      entraOid: "oid-editor",
      email: "editor@example.com",
      displayName: "Editor User",
      role: "editor",
    } satisfies SessionUser;
    req.session.save(() => res.json({ ok: true }));
  });

  // The writeback router is mounted at the root in the main router (no /api prefix),
  // but all its routes start with /wb. Mount directly so /wb/* routes are reachable.
  app.use(writebackRouter);
  return app;
}

/** Minimal valid body for POST /wb/schedule-blocks. */
const validScheduleBlockBody = {
  technician_id: "tech-abc",
  block_type: "pto",
  start_time: "2026-07-31T08:00:00.000Z",
  end_time: "2026-07-31T17:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Tests — POST /wb/schedule-blocks
// ---------------------------------------------------------------------------

describe("POST /wb/schedule-blocks — role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the session user has the viewer role", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-viewer").expect(200);

    const res = await agent
      .post("/wb/schedule-blocks")
      .send(validScheduleBlockBody)
      .expect(403);

    expect(res.body).toMatchObject({ message: expect.stringMatching(/access denied/i) });
  });

  it("returns 401 when there is no session at all", async () => {
    // Fresh agent — no seed call, so session.user is absent.
    const res = await request(buildApp())
      .post("/wb/schedule-blocks")
      .send(validScheduleBlockBody)
      .expect(401);

    expect(res.body).toMatchObject({ message: expect.stringMatching(/login required/i) });
  });

  it("proceeds past auth and creates the block when the session user has the editor role", async () => {
    // Arrange: mock localPool.query to return a fake inserted row.
    const fakeRow = {
      id: 42,
      technician_id: "tech-abc",
      block_type: "pto",
      title: null,
      start_time: "2026-07-31T08:00:00.000Z",
      end_time: "2026-07-31T17:00:00.000Z",
      notes: null,
      color_index: null,
      created_at: "2026-07-31T00:00:00.000Z",
    };
    mocks.localQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);

    const res = await agent
      .post("/wb/schedule-blocks")
      .send(validScheduleBlockBody)
      .expect(201);

    // The route should return the created block (not a 403 or 401).
    expect(res.body).toMatchObject({ id: 42, technician_id: "tech-abc", block_type: "pto" });
  });
});

// ---------------------------------------------------------------------------
// Tests — DELETE /wb/schedule-blocks/:id
// ---------------------------------------------------------------------------

describe("DELETE /wb/schedule-blocks/:id — role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the session user has the viewer role", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-viewer").expect(200);

    const res = await agent.delete("/wb/schedule-blocks/1").expect(403);
    expect(res.body).toMatchObject({ message: expect.stringMatching(/access denied/i) });
  });

  it("returns 401 when there is no session at all", async () => {
    const res = await request(buildApp()).delete("/wb/schedule-blocks/1").expect(401);
    expect(res.body).toMatchObject({ message: expect.stringMatching(/login required/i) });
  });

  it("proceeds past auth and deletes when the session user has the editor role", async () => {
    // Mock localPool.query to simulate a found-and-deleted row.
    mocks.localQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);

    // 204 No Content means the delete went through — not rejected by auth.
    await agent.delete("/wb/schedule-blocks/1").expect(204);
  });

  it("returns 400 (not 403) for an editor when the block id is not a valid integer", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);

    // Auth passes; the route itself rejects a non-numeric id with 400.
    const res = await agent.delete("/wb/schedule-blocks/not-a-number").expect(400);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/invalid block id/i) });
  });
});

// ---------------------------------------------------------------------------
// Tests — PATCH /wb/bookings/:bookingId  (booking write route)
// ---------------------------------------------------------------------------

/** Minimal valid body for PATCH /wb/bookings/:bookingId. */
const validBookingUpdateBody = {
  start_time: "2026-07-31T08:00:00.000Z",
  end_time: "2026-07-31T17:00:00.000Z",
};

describe("PATCH /wb/bookings/:bookingId — role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the session user has the viewer role", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-viewer").expect(200);

    const res = await agent
      .patch("/wb/bookings/booking-123")
      .send(validBookingUpdateBody)
      .expect(403);

    expect(res.body).toMatchObject({ message: expect.stringMatching(/access denied/i) });
  });

  it("returns 401 when there is no session at all", async () => {
    const res = await request(buildApp())
      .patch("/wb/bookings/booking-123")
      .send(validBookingUpdateBody)
      .expect(401);

    expect(res.body).toMatchObject({ message: expect.stringMatching(/login required/i) });
  });

  it("proceeds past auth for an editor (returns non-403 even when CRM is not configured)", async () => {
    // isCrmConfigured() is stubbed to false, so the route returns 503 after
    // passing auth — confirming that requireRole("editor") did not block it.
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);

    const res = await agent
      .patch("/wb/bookings/booking-123")
      .send(validBookingUpdateBody);

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Tests — POST /wb/placeholder-jobs  (placeholder-job write route)
// ---------------------------------------------------------------------------

/** Minimal valid body for POST /wb/placeholder-jobs. */
const validPlaceholderJobBody = {
  technician_id: "tech-abc",
  title: "Test Job",
  start_time: "2026-07-31T08:00:00.000Z",
  end_time: "2026-07-31T17:00:00.000Z",
};

describe("POST /wb/placeholder-jobs — role enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when the session user has the viewer role", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-viewer").expect(200);

    const res = await agent
      .post("/wb/placeholder-jobs")
      .send(validPlaceholderJobBody)
      .expect(403);

    expect(res.body).toMatchObject({ message: expect.stringMatching(/access denied/i) });
  });

  it("returns 401 when there is no session at all", async () => {
    const res = await request(buildApp())
      .post("/wb/placeholder-jobs")
      .send(validPlaceholderJobBody)
      .expect(401);

    expect(res.body).toMatchObject({ message: expect.stringMatching(/login required/i) });
  });

  it("proceeds past auth and creates the job when the session user has the editor role", async () => {
    // Arrange: mock localPool.query to return a fake inserted row.
    const fakeRow = {
      id: 99,
      technician_id: "tech-abc",
      title: "Test Job",
      customer_name: null,
      city: null,
      state: null,
      service_location_id: null,
      color_index: null,
      start_time: "2026-07-31T08:00:00.000Z",
      end_time: "2026-07-31T17:00:00.000Z",
      notes: null,
      status: null,
      created_at: "2026-07-31T00:00:00.000Z",
    };
    mocks.localQuery.mockResolvedValueOnce({ rows: [fakeRow] });

    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-editor").expect(200);

    const res = await agent
      .post("/wb/placeholder-jobs")
      .send(validPlaceholderJobBody)
      .expect(201);

    // Auth passed and the route returned the created job.
    expect(res.body).toMatchObject({ id: 99, technician_id: "tech-abc", title: "Test Job" });
  });
});
