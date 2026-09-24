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
} from "../lib/auth";

import {
  verifyEmbeddedSsoToken,
} from "../lib/embedded-sso";

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

// add for same frame

declare module "express-session" {
  interface SessionData {
    returnTo?: string;
    authState?: string;
    embeddedLogin?: boolean;
    user?: {
      entraOid: string;
      email: string | undefined;
      displayName: string | undefined;
      role: string;
    };
  }
}

// updated login check for same frame
router.get("/login", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).send("Azure auth is not configured");
    return;
  }

  const embeddedLogin = req.query.embedded === "1";

  // If Field Service already has a valid local session,
  // do not start another Microsoft login.
  // For embedded Workspace login, go directly to the
  // completion page so the popup can notify Workspace and close.
  if (embeddedLogin && req.session.user) {
    res.redirect("/api/auth/embedded-complete");
    return;
  }

  req.session.embeddedLogin = embeddedLogin;

  req.session.returnTo = embeddedLogin
    ? "/api/auth/embedded-complete"
    : sanitizeReturnTo(req.query.returnTo);

  const state = crypto.randomBytes(16).toString("hex");
  req.session.authState = state;

  const authUrl = await getMsalClient().getAuthCodeUrl({
    scopes: LOGIN_SCOPES,
    redirectUri: REDIRECT_URI,
    state,
  });

  res.redirect(authUrl);
});

// ---------------------------------------------------------------------------
// GET /api/auth/embedded-sso
//
// Workspace already authenticated the user.
// Workspace sends a short-lived signed SSO token.
//
// Field Service:
//   1. verifies the token
//   2. checks Admin Console authorization
//   3. creates its own fieldservice.sid session
//   4. redirects to the Field Service application
//
// No popup.
// No second Microsoft login.
// ---------------------------------------------------------------------------

router.get(
  "/auth/embedded-sso",
  async (req, res): Promise<void> => {
    const token =
      typeof req.query.token === "string"
        ? req.query.token
        : "";

    const returnTo =
      typeof req.query.returnTo === "string"
        ? req.query.returnTo
        : "/";

    req.log.info(
      {
        hasToken: Boolean(token),
        returnTo,
      },
      "Field Service embedded SSO started",
    );

    if (!token) {
      res
        .status(400)
        .type("text")
        .send("Missing SSO token.");

      return;
    }

    const identity =
      verifyEmbeddedSsoToken(
        token,
        "field-service-calendar",
      );

    if (!identity) {
      req.log.warn(
        "Field Service embedded SSO token invalid or expired",
      );

      res
        .status(401)
        .type("text")
        .send(
          "Invalid or expired SSO token.",
        );

      return;
    }

    try {
      const adminConsoleUrl =
        process.env.ADMIN_CONSOLE_URL;

      const adminConsoleKey =
        process.env.ADMIN_CONSOLE_API_KEY;

      if (
        !adminConsoleUrl ||
        !adminConsoleKey
      ) {
        req.log.error(
          {
            entraOid: identity.sub,
          },
          "Admin Console configuration missing",
        );

        res
          .status(500)
          .type("text")
          .send(
            "Auth not configured: ADMIN_CONSOLE_URL and ADMIN_CONSOLE_API_KEY must be set",
          );

        return;
      }

      let isReadWrite = false;

      const accessUrl =
        new URL(
          "/api/access-check",
          adminConsoleUrl,
        );

      accessUrl.searchParams.set(
        "entraObjectId",
        identity.sub,
      );

      accessUrl.searchParams.set(
        "app",
        "Field Service Calendar",
      );

      const acRes =
        await fetch(
          accessUrl.toString(),
          {
            headers: {
              "X-API-Key":
                adminConsoleKey,

              Accept:
                "application/json",
            },
          },
        );

      const rawBody =
        await acRes.text();

      if (!acRes.ok) {
        req.log.warn(
          {
            adminConsoleStatus:
              acRes.status,

            entraOid:
              identity.sub,
          },
          "Admin Console access-check returned non-2xx",
        );

        res
          .status(503)
          .type("text")
          .send(
            "Authorisation service unavailable",
          );

        return;
      }

      let parsed: unknown;

      try {
        parsed =
          JSON.parse(rawBody);
      } catch {
        req.log.warn(
          {
            entraOid:
              identity.sub,

            rawBodySnippet:
              rawBody.slice(0, 300),
          },
          "Admin Console response was not valid JSON",
        );

        res
          .status(503)
          .type("text")
          .send(
            "Unexpected response from authorisation service",
          );

        return;
      }

      const parseResult =
        acDataSchema.safeParse(
          parsed,
        );

      if (!parseResult.success) {
        req.log.warn(
          {
            entraOid:
              identity.sub,

            validationError:
              parseResult.error.message,
          },
          "Admin Console response has unexpected shape",
        );

        res
          .status(503)
          .type("text")
          .send(
            "Unexpected response from authorisation service",
          );

        return;
      }

      const acData =
        parseResult.data;

      if (!acData.allowed) {
        req.log.warn(
          {
            entraOid:
              identity.sub,

            email:
              identity.email,

            reason:
              acData.reason,
          },
          "Field Service embedded SSO access denied",
        );

        res
          .status(403)
          .type("text")
          .send(
            `User is authenticated but not authorized: ${
              acData.reason ??
              "No access configured"
            }`,
          );

        return;
      }

      isReadWrite =
        acData.roles.some(
          (role) => {
            const lc =
              role.toLowerCase();

            return (
              lc.includes(
                "read / write",
              ) ||
              lc.includes(
                "read/write",
              )
            );
          },
        );

      /*
       * Create Field Service's own session.
       *
       * This is the same structure used by
       * the existing Microsoft callback.
       */
      req.session.user = {
        entraOid:
          identity.sub,

        email:
          identity.email,

        displayName:
          identity.name,

        role:
          isReadWrite
            ? "editor"
            : "viewer",
      };

      /*
       * Persist the session BEFORE redirecting.
       */
      await new Promise<void>(
        (resolve, reject) => {
          req.session.save(
            (error) => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            },
          );
        },
      );

      req.log.info(
        {
          email:
            identity.email,

          displayName:
            identity.name,

          role:
            isReadWrite
              ? "editor"
              : "viewer",

          sessionId:
            req.sessionID,
        },
        "Field Service embedded session created",
      );

      const safeReturnTo =
        returnTo.startsWith("/") &&
        !returnTo.startsWith("//") &&
        !returnTo.includes("\\")
          ? returnTo
          : "/";

      res.redirect(
        safeReturnTo,
      );
    } catch (error) {
      req.log.error(
        {
          err: error,
        },
        "Field Service embedded SSO failed",
      );

      res
        .status(503)
        .type("text")
        .send(
          "Embedded sign-in could not be completed.",
        );
    }
  },
);


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
    //const returnTo = sanitizeReturnTo(req.session.returnTo);
      const returnTo = sanitizeReturnTo(req.session.returnTo);
      const embeddedLogin = req.session.embeddedLogin === true;

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
    // req.session.embeddedLogin = embeddedLogin;

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
      else resolve();
    });
  });
   req.log.info(
    {
      email,
      displayName,
      role: isReadWrite ? "editor" : "viewer",
      embeddedLogin,
    },
  "User session created via OAuth callback",
  );
   
  if (embeddedLogin) {
        res.redirect("/api/auth/embedded-complete");
    } else {
        res.redirect(returnTo);
   }
  } catch (err) {
    req.log.error({ err }, "Azure login failed");
    res.status(500).send("Login failed");
  }
});
const workspaceOrigin = process.env.WORKSPACE_FRONTEND_URL;
router.get("/auth/embedded-complete", requireLogin, (req, res) => {
  //const workspaceOrigin =
    //process.env.WORKSPACE_FRONTEND_URL ?? "http://localhost:5176";

  res.type("html").send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication complete</title>
</head>
<body>
  <script>
    const workspaceOrigin = ${JSON.stringify(workspaceOrigin)};

    if (window.opener) {
      window.opener.postMessage(
        { type: "FIELD_SERVICE_AUTH_COMPLETE" },
        workspaceOrigin
      );

      window.close();
    }
  </script>

  <p>Authentication complete. You can close this window.</p>
</body>
</html>
  `);
});


router.get("/me", requireLogin, (req, res) => {
  res.json(req.session.user);
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("fieldservice.sid", { path: "/" });
    res.json({ ok: true });
  });
});


export default router;
