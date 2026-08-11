import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import {
  getMsalClient,
  isAuthConfigured,
  requireLogin,
  REDIRECT_URI,
  LOGIN_SCOPES,
  LOGOUT_URL,
} from "../lib/auth.js";

// Runtime schema for the Admin Console access-check response.
// Exported so it can be reused in tests.
export const acDataSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  roles: z.array(z.string()),
});

const router = Router();

// Only allow local, same-origin relative paths as a post-login destination.
// This prevents open-redirect abuse (protocol-relative `//evil.com`, absolute
// URLs, or backslash tricks). Falls back to "/" when the value is unsafe.
function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  // Reject protocol-relative ("//host") and backslash-escaped variants.
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

router.get("/login", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).send("Azure auth is not configured");
    return;
  }

  // Remember where to send the user back to after a successful login so that
  // path-based frontends (e.g. /dynamics-write-back/) land back in their app
  // instead of the root.
  req.session.returnTo = sanitizeReturnTo(req.query.returnTo);

  // Bind the request to the session with a random state value to defend against
  // login CSRF / authorization-response injection.
  const state = crypto.randomBytes(16).toString("hex");
  req.session.authState = state;

  const authUrl = await getMsalClient().getAuthCodeUrl({
    scopes: LOGIN_SCOPES,
    redirectUri: REDIRECT_URI,
    state,
  });

  res.redirect(authUrl);
});

router.get("/auth/callback", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).send("Azure auth is not configured");
    return;
  }

  try {
    // Verify the state matches what we issued before exchanging the code.
    const returnedState = req.query.state;
    if (
      typeof returnedState !== "string" ||
      returnedState !== req.session.authState
    ) {
      req.log.warn(
        {
          hasCookieHeader: Boolean(req.headers.cookie),
          hasAuthState: Boolean(req.session.authState),
        },
        "auth/callback: invalid state (session cookie likely not returned)",
      );
      res.status(403).send("Invalid state parameter");
      return;
    }
    delete req.session.authState;

    const code = req.query.code;
    if (typeof code !== "string") {
      res.status(400).send("Missing authorization code");
      return;
    }

    const tokenResponse = await getMsalClient().acquireTokenByCode({
      code,
      scopes: LOGIN_SCOPES,
      redirectUri: REDIRECT_URI,
    });

    const claims = tokenResponse.idTokenClaims as {
      oid?: string;
      preferred_username?: string;
      email?: string;
      upn?: string;
      name?: string;
    };

    const entraOid = claims.oid;
    if (!entraOid) {
      res.status(400).send("ID token missing object id");
      return;
    }
    const email = claims.preferred_username ?? claims.email ?? claims.upn;
    const displayName = claims.name;

    // Check authorisation via Admin Console.
    // ADMIN_CONSOLE_URL and ADMIN_CONSOLE_API_KEY must both be set; there is no
    // local-database fallback — a misconfiguration or transient Admin Console
    // failure surfaces as an explicit error rather than silently degrading.
    const adminConsoleUrl = process.env.ADMIN_CONSOLE_URL;
    const adminConsoleKey = process.env.ADMIN_CONSOLE_API_KEY;

    if (!adminConsoleUrl || !adminConsoleKey) {
      req.log.error(
        { entraOid },
        "ADMIN_CONSOLE_URL or ADMIN_CONSOLE_API_KEY is not set — login cannot proceed",
      );
      res
        .status(500)
        .send(
          "Auth not configured: ADMIN_CONSOLE_URL and ADMIN_CONSOLE_API_KEY must be set",
        );
      return;
    }

    let isReadWrite = false;

    try {
      const acRes = await fetch(
        `${adminConsoleUrl}/api/access-check?entraObjectId=${entraOid}&app=Field Service Calendar`,
        { headers: { "X-API-Key": adminConsoleKey } },
      );
      const rawBody = await acRes.text();

      if (!acRes.ok) {
        req.log.warn(
          { adminConsoleStatus: acRes.status, entraOid },
          "Admin Console access-check returned a non-2xx response",
        );
        res.status(503).send("Authorisation service unavailable");
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        req.log.warn(
          { entraOid, rawBodySnippet: rawBody.slice(0, 300) },
          "Admin Console access-check response is not valid JSON",
        );
        res.status(503).send("Unexpected response from authorisation service");
        return;
      }

      // Runtime schema validation via Zod: validates allowed (boolean),
      // reason (string | null), and every element of roles (string).
      const parseResult = acDataSchema.safeParse(parsed);
      if (!parseResult.success) {
        req.log.warn(
          {
            entraOid,
            rawBodySnippet: rawBody.slice(0, 300),
            validationError: parseResult.error.message,
          },
          "Admin Console access-check response has unexpected shape",
        );
        res.status(503).send("Unexpected response from authorisation service");
        return;
      }

      const acData = parseResult.data;
      if (!acData.allowed) {
        req.log.warn(
          { entraOid, email, displayName, reason: acData.reason },
          "Authenticated user is not authorised in Admin Console",
        );
        res
          .status(403)
          .send(
            `User is authenticated but not authorized: ${acData.reason ?? "No access configured"}`,
          );
        return;
      }

      // Map role: "Field Service Calendar - Read / Write" → editor, else viewer.
      // The Admin Console API may return "Read/Write" (no spaces) while the
      // UI displays "Read / Write" (with spaces) — match both forms.
      isReadWrite = acData.roles.some((r) => {
        const lc = r.toLowerCase();
        return lc.includes("read / write") || lc.includes("read/write");
      });
    } catch (fetchErr) {
      req.log.warn(
        { err: fetchErr, entraOid },
        "Admin Console access-check call failed",
      );
      res.status(503).send("Authorisation service unavailable");
      return;
    }

    // Capture returnTo before regenerating — regenerate() clears the old session data.
    const returnTo = sanitizeReturnTo(req.session.returnTo);

    // Regenerate the session ID before writing the authenticated user to the
    // session.  This prevents session-fixation attacks: an attacker who planted
    // a known session cookie prior to login cannot take over the resulting
    // authenticated session because the ID changes at this point.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    req.session.user = {
      entraOid,
      email,
      displayName,
      role: isReadWrite ? "editor" : "viewer",
    };

    res.redirect(returnTo);
  } catch (err) {
    req.log.error({ err }, "Azure login failed");
    res.status(500).send("Login failed");
  }
});

router.get("/me", requireLogin, (req, res) => {
  res.json(req.session.user);
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect(LOGOUT_URL);
  });
});

export default router;
