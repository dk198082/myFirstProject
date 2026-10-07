/**
 * End-to-end tests for GET /api/me that exercise the real authRouter with the
 * real requireLogin middleware.
 *
 * Strategy
 * --------
 * The main auth.test.ts file replaces requireLogin with an unconditional
 * next() so callback tests can run without touching session guards. This file
 * takes the opposite approach: lib/auth.js is partially mocked — only the MSAL
 * client and isAuthConfigured helpers are stubbed — while requireLogin and
 * requireRole are preserved from the actual module. That way, removing or
 * accidentally bypassing requireLogin in the router will make these tests fail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import request from "supertest";
import type { SessionUser } from "../lib/auth.js";

// ---------------------------------------------------------------------------
// Hoisted stubs for external auth dependencies only
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  isAuthConfigured: vi.fn(() => true),
  getMsalClient: vi.fn(),
}));

/**
 * Partially mock lib/auth.js:
 *   - Keep requireLogin and requireRole as their real implementations.
 *   - Stub isAuthConfigured and getMsalClient so MSAL / Azure are never called.
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

// localPool is imported by the router but only used in commented-out code.
vi.mock("../lib/localDb.js", () => ({ localPool: {} }));

// Import the real authRouter AFTER mocks are registered.
// eslint-disable-next-line import/first
import authRouter from "./auth.js";

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
 * Build an Express app using the real authRouter mounted at /api.
 * A /__test/seed-user helper populates req.session.user so tests can
 * simulate an authenticated session without going through the full login flow.
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

  app.get("/__test/seed-user", (req: Request, res: Response) => {
    req.session.user = {
      entraOid: "oid-123",
      email: "user@example.com",
      displayName: "Test User",
      role: "viewer",
    } satisfies SessionUser;
    req.session.save(() => res.json({ ok: true }));
  });

  // Mount the REAL authRouter — this is the production route under test.
  app.use("/api", authRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/me (real authRouter, real requireLogin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthConfigured.mockReturnValue(true);
  });

  it("returns 401 with a login-required message when there is no session", async () => {
    // Fresh agent, no seed — session.user is absent.
    const res = await request(buildApp()).get("/api/me").expect(401);
    expect(res.body).toMatchObject({ message: expect.stringMatching(/login required/i) });
  });

  it("returns the session user object when a valid session is present", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/__test/seed-user").expect(200);

    const res = await agent.get("/api/me").expect(200);
    expect(res.body).toMatchObject({
      entraOid: "oid-123",
      email: "user@example.com",
      displayName: "Test User",
      role: "viewer",
    });
  });
});
