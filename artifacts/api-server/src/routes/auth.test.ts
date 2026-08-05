/**
 * Tests for the /auth/callback route.
 *
 * Strategy
 * --------
 * • Unit tests cover the exported Zod schema (acDataSchema) directly.
 * • Integration tests build a minimal Express app with a MemoryStore session
 *   so no real database is needed.
 * • Mock `lib/auth.ts` (MSAL client + isAuthConfigured) and `lib/localDb.ts`
 *   so that no real Azure or Postgres connections are made.
 * • Stub the global `fetch` used to call the Admin Console.
 * • A `/__test/seed` route lets each test prime the session with a known
 *   authState value; supertest.agent() keeps the cookie between requests.
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock factories (vi.hoisted runs before any imports are evaluated)
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  getMsalClient: vi.fn(),
  isAuthConfigured: vi.fn(() => true),
}));

vi.mock("../lib/auth.js", () => ({
  getMsalClient: mocks.getMsalClient,
  isAuthConfigured: mocks.isAuthConfigured,
  requireLogin: (_req: Request, _res: Response, next: NextFunction) => next(),
  REDIRECT_URI: "http://localhost:8080/api/auth/callback",
  LOGIN_SCOPES: ["openid", "profile", "email"],
  LOGOUT_URL: "https://login.microsoftonline.com/common/oauth2/v2.0/logout",
}));

// localPool is imported by routes/auth.ts but only used in commented-out code.
vi.mock("../lib/localDb.js", () => ({ localPool: {} }));

// Import the router and schema AFTER mocks are registered.
// eslint-disable-next-line import/first
import authRouter, { acDataSchema } from "./auth.js";

// ---------------------------------------------------------------------------
// Unit tests – acDataSchema
// ---------------------------------------------------------------------------

describe("acDataSchema", () => {
  it("accepts a fully valid response (allowed: true)", () => {
    const result = acDataSchema.safeParse({
      allowed: true,
      reason: null,
      roles: ["Field Service Calendar - Read / Write"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts allowed: false with a reason string", () => {
    const result = acDataSchema.safeParse({
      allowed: false,
      reason: "No access configured",
      roles: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts reason: null", () => {
    const result = acDataSchema.safeParse({
      allowed: false,
      reason: null,
      roles: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects when allowed is missing", () => {
    expect(
      acDataSchema.safeParse({ reason: null, roles: [] }).success,
    ).toBe(false);
  });

  it("rejects when allowed is a string instead of boolean", () => {
    expect(
      acDataSchema.safeParse({ allowed: "true", reason: null, roles: [] })
        .success,
    ).toBe(false);
  });

  it("rejects when roles is missing", () => {
    expect(
      acDataSchema.safeParse({ allowed: true, reason: null }).success,
    ).toBe(false);
  });

  it("rejects when roles contains a null item", () => {
    expect(
      acDataSchema.safeParse({ allowed: true, reason: null, roles: [null] })
        .success,
    ).toBe(false);
  });

  it("rejects when roles contains an object item", () => {
    expect(
      acDataSchema.safeParse({
        allowed: true,
        reason: null,
        roles: [{ name: "some-role" }],
      }).success,
    ).toBe(false);
  });

  it("rejects when reason is a number", () => {
    expect(
      acDataSchema.safeParse({ allowed: true, reason: 42, roles: [] }).success,
    ).toBe(false);
  });

  it("rejects when reason is an object", () => {
    expect(
      acDataSchema.safeParse({
        allowed: true,
        reason: { code: "denied" },
        roles: [],
      }).success,
    ).toBe(false);
  });
});

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
 * Build a minimal Express app that:
 *  - Uses an in-memory session store (no DB)
 *  - Exposes a /__test/seed endpoint to prime session state
 *  - Mounts the auth router at /api
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Attach a silent req.log so route code can call req.log.warn / req.log.error
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as unknown as Record<string, unknown>).log = silentLog;
    next();
  });

  // MemoryStore is the default when no `store` is provided — fine for tests.
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    }),
  );

  // Seed helper: sets authState (and optionally returnTo) in the session so
  // callback tests don't have to go through /login (which calls Azure).
  app.get("/__test/seed", (req: Request, res: Response) => {
    req.session.authState = "test-state";
    req.session.save(() => res.json({ ok: true }));
  });

  // Session inspector: returns a safe subset of the session as JSON so that
  // /login tests can verify what was written without going through the callback.
  app.get("/__test/session", (req: Request, res: Response) => {
    res.json({
      authState: req.session.authState ?? null,
      returnTo: req.session.returnTo ?? null,
      user: req.session.user ?? null,
    });
  });

  app.use("/api", authRouter);
  return app;
}

/** Create a supertest agent (persists cookies) and seed the auth state. */
async function agentWithState() {
  const agent = request.agent(buildApp());
  await agent.get("/__test/seed").expect(200);
  return agent;
}

/** Minimal valid MSAL token response. */
function makeMsalToken(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    idTokenClaims: {
      oid: "entra-oid-abc",
      preferred_username: "user@example.com",
      name: "Test User",
      ...overrides,
    },
  };
}

/**
 * Build a Response-like object for mocking global fetch.
 * The route reads the body via `.text()` then JSON.parses it, so we expose
 * `text` (returning the serialised body) rather than `json`.
 */
function makeFetchResponse(
  status: number,
  body: unknown,
): Promise<globalThis.Response> {
  const serialised = JSON.stringify(body);
  const stub = {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(serialised),
  };
  return Promise.resolve(stub as unknown as globalThis.Response);
}

// ---------------------------------------------------------------------------
// Helpers shared across middleware unit-test suites
// ---------------------------------------------------------------------------

/** Minimal req/res/next triple for middleware unit tests. */
function makeMiddlewareTriple(sessionUser?: unknown) {
  const req = {
    session: { user: sessionUser },
  } as unknown as Request;

  let statusCode = 0;
  let body: unknown;
  let nextCalled = false;

  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
  } as unknown as Response;

  const next = (() => {
    nextCalled = true;
  }) as NextFunction;

  return { req, res, next, getStatus: () => statusCode, getBody: () => body, wasNext: () => nextCalled };
}

// ---------------------------------------------------------------------------
// Integration tests – GET /api/auth/callback
// ---------------------------------------------------------------------------

describe("requireLogin middleware", () => {
  let requireLoginReal: typeof import("../lib/auth.js").requireLogin;
  let requireRoleReal: typeof import("../lib/auth.js").requireRole;

  beforeEach(async () => {
    // Use the real implementations, bypassing the vi.mock above.
    const actual = await vi.importActual<typeof import("../lib/auth.js")>("../lib/auth.js");
    requireLoginReal = actual.requireLogin;
    requireRoleReal = actual.requireRole;
  });

  it("returns 401 with an appropriate message when no session user is present", () => {
    const { req, res, next, getStatus, getBody, wasNext } = makeMiddlewareTriple(undefined);
    requireLoginReal(req, res, next);
    expect(getStatus()).toBe(401);
    expect((getBody() as { message: string }).message).toMatch(/login required/i);
    expect(wasNext()).toBe(false);
  });

  it("calls next() when a session user is present", () => {
    const user = { entraOid: "oid", email: "a@b.com", displayName: "A", role: "viewer" };
    const { req, res, next, getStatus, wasNext } = makeMiddlewareTriple(user);
    requireLoginReal(req, res, next);
    expect(wasNext()).toBe(true);
    expect(getStatus()).toBe(0); // res.status never called
  });

  it("returns 401 when session.user is null", () => {
    const { req, res, next, getStatus, wasNext } = makeMiddlewareTriple(null);
    requireLoginReal(req, res, next);
    expect(getStatus()).toBe(401);
    expect(wasNext()).toBe(false);
  });
});

describe("requireRole middleware", () => {
  let requireRoleReal: typeof import("../lib/auth.js").requireRole;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../lib/auth.js")>("../lib/auth.js");
    requireRoleReal = actual.requireRole;
  });

  it("returns 401 when there is no session user", () => {
    const { req, res, next, getStatus, wasNext } = makeMiddlewareTriple(undefined);
    requireRoleReal("editor")(req, res, next);
    expect(getStatus()).toBe(401);
    expect(wasNext()).toBe(false);
  });

  it("returns 403 when the session user role does not match", () => {
    const user = { entraOid: "oid", email: "a@b.com", displayName: "A", role: "viewer" };
    const { req, res, next, getStatus, getBody, wasNext } = makeMiddlewareTriple(user);
    requireRoleReal("editor")(req, res, next);
    expect(getStatus()).toBe(403);
    expect((getBody() as { message: string }).message).toMatch(/access denied/i);
    expect(wasNext()).toBe(false);
  });

  it("calls next() when the session user role matches", () => {
    const user = { entraOid: "oid", email: "a@b.com", displayName: "A", role: "editor" };
    const { req, res, next, getStatus, wasNext } = makeMiddlewareTriple(user);
    requireRoleReal("editor")(req, res, next);
    expect(wasNext()).toBe(true);
    expect(getStatus()).toBe(0);
  });

  it("calls next() when the session user role is one of several allowed roles", () => {
    const user = { entraOid: "oid", email: "a@b.com", displayName: "A", role: "viewer" };
    const { req, res, next, wasNext } = makeMiddlewareTriple(user);
    requireRoleReal("editor", "viewer")(req, res, next);
    expect(wasNext()).toBe(true);
  });

  it("returns 403 when the session user role is not in the allowed list", () => {
    const user = { entraOid: "oid", email: "a@b.com", displayName: "A", role: "admin" };
    const { req, res, next, getStatus, wasNext } = makeMiddlewareTriple(user);
    requireRoleReal("editor", "viewer")(req, res, next);
    expect(getStatus()).toBe(403);
    expect(wasNext()).toBe(false);
  });
});

describe("GET /api/me (end-to-end with real requireLogin)", () => {
  /**
   * Build a minimal Express app that uses the REAL requireLogin (not the
   * vi.mock passthrough) and exposes:
   *   GET /__test/seed-user  — populates req.session.user
   *   GET /api/me            — protected by real requireLogin, echoes session user
   */
  async function buildMeApp() {
    const actual = await vi.importActual<typeof import("../lib/auth.js")>("../lib/auth.js");
    const realRequireLogin = actual.requireLogin;

    const app = express();
    app.use(express.json());
    app.use(
      session({ secret: "test-secret", resave: false, saveUninitialized: false }),
    );
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as Record<string, unknown>).log = silentLog;
      next();
    });

    // Seed a valid session user
    app.get("/__test/seed-user", (req: Request, res: Response) => {
      req.session.user = {
        entraOid: "oid-123",
        email: "user@example.com",
        displayName: "Test User",
        role: "viewer",
      };
      req.session.save(() => res.json({ ok: true }));
    });

    // /api/me using the real requireLogin
    app.get("/api/me", realRequireLogin, (req: Request, res: Response) => {
      res.json(req.session.user);
    });

    return app;
  }

  it("returns 401 for /me when no session is present", async () => {
    const app = await buildMeApp();
    const res = await request(app).get("/api/me").expect(401);
    expect(res.body.message).toMatch(/login required/i);
  });

  it("returns the session user for /me when logged in", async () => {
    const app = await buildMeApp();
    const agent = request.agent(app);
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

describe("GET /api/auth/callback", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthConfigured.mockReturnValue(true);

    // Default: a successful MSAL token exchange
    mocks.getMsalClient.mockReturnValue({
      acquireTokenByCode: vi.fn().mockResolvedValue(makeMsalToken()),
      getAuthCodeUrl: vi.fn().mockResolvedValue("https://login.example.com/"),
    });

    // Default: Admin Console allows access with a read/write role
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        makeFetchResponse(200, {
          allowed: true,
          reason: null,
          roles: ["Field Service Calendar - Read / Write"],
        }),
      );

    process.env.ADMIN_CONSOLE_URL = "https://admin.example.com";
    process.env.ADMIN_CONSOLE_API_KEY = "test-key";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.ADMIN_CONSOLE_URL;
    delete process.env.ADMIN_CONSOLE_API_KEY;
  });

  // ── Auth not configured ──────────────────────────────────────────────────

  it("returns 503 when Azure auth is not configured", async () => {
    mocks.isAuthConfigured.mockReturnValue(false);
    const res = await request(buildApp())
      .get("/api/auth/callback?state=anything&code=anything")
      .expect(503);
    expect(res.text).toMatch(/not configured/i);
  });

  // ── CSRF / state validation ──────────────────────────────────────────────

  it("returns 403 when no authState exists in the session", async () => {
    // Fresh agent — no seed call, so session.authState is undefined
    const res = await request(buildApp())
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(403);
    expect(res.text).toMatch(/invalid state/i);
  });

  it("returns 403 when the returned state does not match the session state", async () => {
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=WRONG-STATE&code=abc")
      .expect(403);
    expect(res.text).toMatch(/invalid state/i);
  });

  it("returns 400 when the authorization code is absent", async () => {
    const agent = await agentWithState();
    // Provide the correct state but omit the code
    const res = await agent
      .get("/api/auth/callback?state=test-state")
      .expect(400);
    expect(res.text).toMatch(/missing authorization code/i);
  });

  // ── Missing server-side config (after state check) ───────────────────────

  it("returns 500 when ADMIN_CONSOLE_URL is not set", async () => {
    delete process.env.ADMIN_CONSOLE_URL;
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(500);
    expect(res.text).toMatch(/not configured/i);
  });

  it("returns 500 when ADMIN_CONSOLE_API_KEY is not set", async () => {
    delete process.env.ADMIN_CONSOLE_API_KEY;
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(500);
    expect(res.text).toMatch(/not configured/i);
  });

  // ── Admin Console non-2xx ────────────────────────────────────────────────

  it("returns 503 when Admin Console responds with a non-2xx status", async () => {
    fetchSpy.mockImplementation(() => makeFetchResponse(503, {}));
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/authorisation service unavailable/i);
  });

  it("returns 503 when the Admin Console fetch throws a network error", async () => {
    fetchSpy.mockRejectedValue(new Error("Network failure"));
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/authorisation service unavailable/i);
  });

  // ── Admin Console response shape validation ──────────────────────────────

  it("returns 503 when the Admin Console response is not valid JSON", async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve("not json at all"),
      } as unknown as globalThis.Response),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/unexpected response/i);
  });

  it("returns 503 when the response is missing the `allowed` field", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, { reason: null, roles: [] }),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/unexpected response/i);
  });

  it("returns 503 when `allowed` is a string rather than a boolean", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, { allowed: "true", reason: null, roles: [] }),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/unexpected response/i);
  });

  it("returns 503 when `roles` contains a non-string item", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, { allowed: true, reason: null, roles: [null] }),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/unexpected response/i);
  });

  it("returns 503 when `reason` is a number instead of string | null", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, { allowed: false, reason: 42, roles: [] }),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(503);
    expect(res.text).toMatch(/unexpected response/i);
  });

  // ── Admin Console denies access ──────────────────────────────────────────

  it("returns 403 when Admin Console says allowed: false", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, {
        allowed: false,
        reason: "No access configured",
        roles: [],
      }),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(403);
    expect(res.text).toMatch(/not authorized/i);
  });

  // ── Successful login ─────────────────────────────────────────────────────

  it("redirects and sets session user with role=editor for a read/write grant", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, {
        allowed: true,
        reason: null,
        roles: ["Field Service Calendar - Read / Write"],
      }),
    );
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(302);

    // Should redirect to "/" (the default sanitized returnTo)
    expect(res.headers.location).toBe("/");

    // Session user should be populated
    const me = await agent.get("/api/me").expect(200);
    expect(me.body).toMatchObject({
      entraOid: "entra-oid-abc",
      email: "user@example.com",
      displayName: "Test User",
      role: "editor",
    });
  });

  it("redirects and sets role=viewer when the Admin Console grants read-only access", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, {
        allowed: true,
        reason: null,
        roles: ["Field Service Calendar - Read Only"],
      }),
    );
    const agent = await agentWithState();
    await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(302);

    const me = await agent.get("/api/me").expect(200);
    expect(me.body.role).toBe("viewer");
  });

  it("assigns role=viewer when no read/write role is present in the roles array", async () => {
    fetchSpy.mockImplementation(() =>
      makeFetchResponse(200, {
        allowed: true,
        reason: null,
        roles: [],
      }),
    );
    const agent = await agentWithState();
    await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(302);

    const me = await agent.get("/api/me").expect(200);
    expect(me.body.role).toBe("viewer");
  });

  it("passes the correct query parameters to the Admin Console", async () => {
    const agent = await agentWithState();
    await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(302);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("entraObjectId=entra-oid-abc");
    expect(url).toContain("app=Field Service Calendar");
    expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe(
      "test-key",
    );
  });

  // ── Session fixation prevention ─────────────────────────────────────────

  it("issues a new session ID on successful login (prevents session fixation)", async () => {
    const app = buildApp();

    // Step 1: Create a pre-login session and capture its cookie.
    const seedRes = await request(app).get("/__test/seed").expect(200);
    const setCookieHeader = seedRes.headers["set-cookie"] as string[] | string;
    const rawCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : setCookieHeader;

    // The "connect.sid=<value>" segment (before the first ";") uniquely
    // identifies the session.
    const originalSid = rawCookie?.split(";")[0];
    expect(originalSid).toMatch(/^connect\.sid=/);

    // Step 2: Complete the OAuth callback using that pre-login session cookie.
    const callbackRes = await request(app)
      .get("/api/auth/callback?state=test-state&code=abc")
      .set("Cookie", rawCookie)
      .expect(302);

    // Step 3: The response must set a NEW session cookie with a different ID.
    const newCookieHeader = callbackRes.headers["set-cookie"] as
      | string[]
      | string;
    const newRawCookie = Array.isArray(newCookieHeader)
      ? newCookieHeader[0]
      : newCookieHeader;
    const newSid = newRawCookie?.split(";")[0];

    expect(newSid).toBeDefined();
    expect(newSid).not.toBe(originalSid);
  });

  // ── MSAL / token errors ──────────────────────────────────────────────────

  it("returns 500 when MSAL acquireTokenByCode throws", async () => {
    mocks.getMsalClient.mockReturnValue({
      acquireTokenByCode: vi
        .fn()
        .mockRejectedValue(new Error("MSAL token exchange failed")),
    });
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(500);
    expect(res.text).toMatch(/login failed/i);
  });

  it("returns 400 when the ID token is missing the oid claim", async () => {
    mocks.getMsalClient.mockReturnValue({
      acquireTokenByCode: vi
        .fn()
        .mockResolvedValue(makeMsalToken({ oid: undefined })),
    });
    const agent = await agentWithState();
    const res = await agent
      .get("/api/auth/callback?state=test-state&code=abc")
      .expect(400);
    expect(res.text).toMatch(/missing object id/i);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/login", () => {
  const MOCK_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=test";
  let getAuthCodeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthConfigured.mockReturnValue(true);
    getAuthCodeUrl = vi.fn().mockResolvedValue(MOCK_AUTH_URL);
    mocks.getMsalClient.mockReturnValue({ getAuthCodeUrl });
  });

  // ── Auth not configured ──────────────────────────────────────────────────

  it("returns 503 when Azure auth is not configured", async () => {
    mocks.isAuthConfigured.mockReturnValue(false);
    const res = await request(buildApp()).get("/api/login").expect(503);
    expect(res.text).toMatch(/not configured/i);
  });

  // ── Happy path ───────────────────────────────────────────────────────────

  it("redirects to the Azure auth URL returned by MSAL", async () => {
    const agent = request.agent(buildApp());
    const res = await agent.get("/api/login").expect(302);
    expect(res.headers.location).toBe(MOCK_AUTH_URL);
  });

  it("stores a non-empty hex authState in the session", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/api/login").expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    // crypto.randomBytes(16).toString("hex") produces a 32-char hex string
    expect(sess.body.authState).toMatch(/^[0-9a-f]{32}$/);
  });

  it("passes the generated state to getAuthCodeUrl", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/api/login").expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    expect(getAuthCodeUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: sess.body.authState }),
    );
  });

  // ── returnTo sanitization ────────────────────────────────────────────────

  it("sanitizes a protocol-relative open-redirect (//evil.com) to /", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/api/login?returnTo=//evil.com").expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    expect(sess.body.returnTo).toBe("/");
  });

  it("sanitizes an absolute URL open-redirect (http://evil.com) to /", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/api/login?returnTo=http://evil.com/steal").expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    expect(sess.body.returnTo).toBe("/");
  });

  it("sanitizes a backslash open-redirect (/\\evil.com) to /", async () => {
    const agent = request.agent(buildApp());
    // Use encodeURIComponent so the backslash reaches the server as-is
    await agent.get("/api/login?returnTo=" + encodeURIComponent("/\\evil.com")).expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    expect(sess.body.returnTo).toBe("/");
  });

  it("preserves a safe relative returnTo path", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/api/login?returnTo=/dynamics-write-back/").expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    expect(sess.body.returnTo).toBe("/dynamics-write-back/");
  });

  it("defaults returnTo to / when the parameter is absent", async () => {
    const agent = request.agent(buildApp());
    await agent.get("/api/login").expect(302);
    const sess = await agent.get("/__test/session").expect(200);
    expect(sess.body.returnTo).toBe("/");
  });
});
