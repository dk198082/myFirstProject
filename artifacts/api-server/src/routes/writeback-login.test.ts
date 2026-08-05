/**
 * Integration tests for login enforcement on read-only (GET) routes in writeback.ts.
 *
 * Strategy
 * --------
 * • lib/auth.js is *partially* mocked: only the MSAL helpers are stubbed.
 *   requireLogin comes through the spread of the real module, so removing or
 *   miswiring requireLogin on a route will cause these tests to fail immediately.
 * • lib/localDb.js, lib/crmDb.js, lib/crmMirror.js, and lib/dataverse.js are
 *   fully mocked so no real database or Azure connections are needed.
 * • A session-seed helper lets each test spin up a viewer-role (or any-role)
 *   session independently of the auth login flow.
 *
 * Covered routes (representative read operations):
 *   GET /wb/schedule-blocks
 *   GET /wb/placeholder-jobs
 *   GET /wb/technicians
 *   GET /wb/work-orders
 *   GET /wb/schedule-board
 *   GET /wb/writebacks
 *   GET /wb/service-locations
 *   GET /wb/resource-utilization
 *   GET /wb/unscheduled-jobs
 *   GET /wb/booking-notes
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
  crmQuery: vi.fn(),
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
    // requireLogin and requireRole come through the spread — real code.
  };
});

vi.mock("../lib/localDb.js", () => ({
  localPool: { query: mocks.localQuery },
}));

vi.mock("../lib/crmDb.js", () => ({
  getCrmPool: vi.fn(() => ({ query: mocks.crmQuery })),
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
 *   - The real writebackRouter mounted directly (routes start with /wb/*)
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

  app.use(writebackRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: table of representative read routes to test
// ---------------------------------------------------------------------------

/** Routes that must return 401 when unauthenticated. */
const READ_ROUTES = [
  { method: "GET", path: "/wb/schedule-blocks" },
  { method: "GET", path: "/wb/placeholder-jobs" },
  { method: "GET", path: "/wb/technicians" },
  { method: "GET", path: "/wb/work-orders" },
  { method: "GET", path: "/wb/schedule-board" },
  { method: "GET", path: "/wb/writebacks" },
  { method: "GET", path: "/wb/service-locations" },
  { method: "GET", path: "/wb/resource-utilization" },
  { method: "GET", path: "/wb/unscheduled-jobs" },
  { method: "GET", path: "/wb/booking-notes" },
] as const;

// ---------------------------------------------------------------------------
// Tests — unauthenticated requests → 401
// ---------------------------------------------------------------------------

describe("Read-only /wb/* routes — unauthenticated requests get 401", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const { method, path } of READ_ROUTES) {
    it(`${method} ${path} returns 401 with no session`, async () => {
      const res = await request(buildApp()).get(path).expect(401);
      expect(res.body).toMatchObject({
        message: expect.stringMatching(/login required/i),
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Tests — viewer-role requests pass the auth gate (reach the handler)
// ---------------------------------------------------------------------------

describe("Read-only /wb/* routes — viewer-role session passes auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: local DB returns empty rows so routes complete without erroring.
    mocks.localQuery.mockResolvedValue({ rows: [] });
    // CRM is not configured, so routes that check isCrmConfigured() return 503
    // rather than querying the DB — but the important thing is they are NOT 401.
    mocks.isCrmConfigured.mockReturnValue(false);
  });

  for (const { method, path } of READ_ROUTES) {
    it(`${method} ${path} does not return 401 or 403 for a viewer`, async () => {
      const agent = request.agent(buildApp());
      await agent.get("/__test/seed-viewer").expect(200);

      const res = await agent.get(path);
      // Auth passed — we should not be rejected with 401 (not logged in)
      // or 403 (wrong role). Any other status (200, 400, 503…) means the
      // request reached the actual route handler.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
});
