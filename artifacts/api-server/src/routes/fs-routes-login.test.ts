/**
 * Integration tests for login enforcement on all FS-backed route files.
 *
 * Strategy
 * --------
 * • lib/auth.js is *partially* mocked: only the MSAL helpers are stubbed.
 *   requireLogin comes through the spread of the real module, so removing or
 *   miswiring requireLogin on a route will cause these tests to fail immediately.
 * • lib/db.js (the FS Postgres pool) is fully mocked so no real database
 *   connections are needed.
 * • A session-seed helper lets each test spin up a viewer-role session
 *   independently of the auth login flow.
 *
 * Covered routers:
 *   technicians.ts       → GET /technicians, /technicians/by-email,
 *                          /technicians/:id/work-orders, /technicians/:id/summary
 *   workOrders.ts        → GET /work-orders/:id
 *   scheduleBoard.ts     → GET /schedule-board
 *   scheduledJobs.ts     → GET /scheduled-jobs
 *   resourceUtilization.ts → GET /resource-utilization
 *   unscheduledJobs.ts   → GET /unscheduled-jobs
 *   jobsByRegion.ts      → GET /jobs-by-region
 *   dashboard.ts         → GET /dashboard/summary
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
  dbQuery: vi.fn(),
}));

/**
 * Partially mock lib/auth.js:
 *   - Keep requireRole and requireLogin as their real implementations.
 *   - Stub isAuthConfigured and getMsalClient (never call Azure in tests).
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

/** Mock the FS Postgres pool used by all eight route files. */
vi.mock("../lib/db.js", () => ({
  pool: { query: mocks.dbQuery },
}));

// Import the real routers AFTER mocks are registered.
// eslint-disable-next-line import/first
import techniciansRouter from "./technicians.js";
// eslint-disable-next-line import/first
import workOrdersRouter from "./workOrders.js";
// eslint-disable-next-line import/first
import scheduleBoardRouter from "./scheduleBoard.js";
// eslint-disable-next-line import/first
import scheduledJobsRouter from "./scheduledJobs.js";
// eslint-disable-next-line import/first
import resourceUtilizationRouter from "./resourceUtilization.js";
// eslint-disable-next-line import/first
import unscheduledJobsRouter from "./unscheduledJobs.js";
// eslint-disable-next-line import/first
import jobsByRegionRouter from "./jobsByRegion.js";
// eslint-disable-next-line import/first
import dashboardRouter from "./dashboard.js";

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
 *   - All eight FS-backed routers mounted at root
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

  app.use(techniciansRouter);
  app.use(workOrdersRouter);
  app.use(scheduleBoardRouter);
  app.use(scheduledJobsRouter);
  app.use(resourceUtilizationRouter);
  app.use(unscheduledJobsRouter);
  app.use(jobsByRegionRouter);
  app.use(dashboardRouter);

  return app;
}

// ---------------------------------------------------------------------------
// Representative read routes to test across all eight FS route files
// ---------------------------------------------------------------------------

/** Routes that must return 401 when unauthenticated. */
const FS_READ_ROUTES = [
  // technicians.ts
  { method: "GET", path: "/technicians" },
  { method: "GET", path: "/technicians/by-email?email=tech@example.com" },
  { method: "GET", path: "/technicians/tech-1/work-orders" },
  { method: "GET", path: "/technicians/tech-1/summary" },
  // workOrders.ts
  { method: "GET", path: "/work-orders/wo-1" },
  // scheduleBoard.ts  (requires ?start=YYYY-MM-DD)
  { method: "GET", path: "/schedule-board?start=2026-07-28" },
  // scheduledJobs.ts
  { method: "GET", path: "/scheduled-jobs" },
  // resourceUtilization.ts  (requires ?start=YYYY-MM-DD)
  { method: "GET", path: "/resource-utilization?start=2026-07-28" },
  // unscheduledJobs.ts
  { method: "GET", path: "/unscheduled-jobs" },
  // jobsByRegion.ts
  { method: "GET", path: "/jobs-by-region" },
  // dashboard.ts
  { method: "GET", path: "/dashboard/summary" },
] as const;

// ---------------------------------------------------------------------------
// Tests — unauthenticated requests → 401
// ---------------------------------------------------------------------------

describe("FS-data routes — unauthenticated requests get 401", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const { method, path } of FS_READ_ROUTES) {
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

describe("FS-data routes — viewer-role session passes auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: DB returns empty rows so routes complete without erroring.
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  for (const { method, path } of FS_READ_ROUTES) {
    it(`${method} ${path} does not return 401 or 403 for a viewer`, async () => {
      const agent = request.agent(buildApp());
      await agent.get("/__test/seed-viewer").expect(200);

      const res = await agent.get(path);
      // Auth passed — we should not be rejected with 401 (not logged in)
      // or 403 (wrong role). Any other status (200, 400, 404, 500…) means
      // the request reached the actual route handler.
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  }
});

// ---------------------------------------------------------------------------
// Tests — start param validation on /schedule-board and /resource-utilization
// ---------------------------------------------------------------------------

/**
 * Routes that validate a `start` query param (YYYY-MM-DD).
 * Each entry describes one endpoint together with cases that should be
 * rejected (400) and the single valid case that should reach the DB.
 */
const START_PARAM_ROUTES = [
  { endpoint: "/schedule-board" },
  { endpoint: "/resource-utilization" },
] as const;

const MALFORMED_STARTS = [
  { label: "missing start param", qs: "" },
  { label: "empty string", qs: "?start=" },
  { label: "wrong format (MM-DD-YYYY)", qs: "?start=07-28-2026" },
  { label: "wrong format (YYYYMMDD)", qs: "?start=20260728" },
  { label: "partial date", qs: "?start=2026-07" },
  { label: "non-date string", qs: "?start=not-a-date" },
  { label: "repeated start param (array)", qs: "?start=2026-07-28&start=2026-07-29" },
] as const;

describe("FS-data routes — start param validation (400 before DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure the mock resolves so that if the DB *is* called unexpectedly it
    // doesn't throw and mask the real failure.
    mocks.dbQuery.mockResolvedValue({ rows: [] });
  });

  for (const { endpoint } of START_PARAM_ROUTES) {
    describe(`GET ${endpoint}`, () => {
      for (const { label, qs } of MALFORMED_STARTS) {
        it(`returns 400 for ${label} and does NOT call the DB`, async () => {
          const agent = request.agent(buildApp());
          await agent.get("/__test/seed-viewer").expect(200);

          const res = await agent.get(`${endpoint}${qs}`).expect(400);

          expect(res.body).toMatchObject({
            error: expect.stringMatching(/start/i),
          });

          // The DB must not have been touched.
          expect(mocks.dbQuery).not.toHaveBeenCalled();
        });
      }

      it(`returns 200 for a valid start param and calls the DB`, async () => {
        const agent = request.agent(buildApp());
        await agent.get("/__test/seed-viewer").expect(200);

        // Auth and param validation both passed — DB was queried and returned 200.
        await agent.get(`${endpoint}?start=2026-07-28`).expect(200);
        expect(mocks.dbQuery).toHaveBeenCalled();
      });
    });
  }
});
