import { Router } from "express";
import crypto from "node:crypto";
import {
  getMsalClient,
  isAuthConfigured,
  requireLogin,
  REDIRECT_URI,
  LOGIN_SCOPES,
  LOGOUT_URL,
} from "../lib/auth.js";
import {
  CALENDAR_APP,
  INVOICE_APP,
  AccessError,
  checkAppAccess,
  requireInvoiceAccess,
  sendAccessError,
} from "../lib/appAccess.js";
import { verifyEmbeddedSsoToken } from "../lib/embedded-sso.js";

export { acDataSchema } from "../lib/appAccess.js";

const router = Router();

function sanitizeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return "/";
  }

  return value;
}

/* -------------------------------------------------------------------------- */
/* Session type                                                               */
/* -------------------------------------------------------------------------- */

declare module "express-session" {
  interface SessionData {
    returnTo?: string;
    authState?: string;
    authApp?: "calendar" | "proforma";

    user?: {
      entraOid: string;
      email: string | undefined;
      displayName: string | undefined;
      role: string;
      calendarAccess?: boolean;
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Normal Microsoft Login                                                     */
/* -------------------------------------------------------------------------- */

router.get("/login", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).send("Azure auth is not configured");
    return;
  }

  if (
    req.query.app !== undefined &&
    req.query.app !== "calendar" &&
    req.query.app !== "proforma"
  ) {
    res.status(400).send("Unknown application");
    return;
  }

  const returnTo = sanitizeReturnTo(req.query.returnTo);

  req.session.returnTo = returnTo;

  req.session.authApp =
    req.query.app === "proforma" ||
    returnTo.startsWith("/pro-forma-service-invoice/")
      ? "proforma"
      : "calendar";

  const state = crypto.randomBytes(16).toString("hex");

  req.session.authState = state;

  const authUrl = await getMsalClient().getAuthCodeUrl({
    scopes: LOGIN_SCOPES,
    redirectUri: REDIRECT_URI,
    state,
  });

  res.redirect(authUrl);
});

/* -------------------------------------------------------------------------- */
/* Workspace Embedded SSO                                                     */
/*                                                                            */
/* Workspace is already authenticated.                                       */
/* Workspace sends a short-lived signed token.                               */
/*                                                                            */
/* Field Service:                                                             */
/*   1. verifies the token                                                    */
/*   2. checks Calendar access                                                 */
/*   3. creates its own fieldservice.sid session                             */
/*   4. redirects to the application                                          */
/*                                                                            */
/* No popup.                                                                  */
/* No second Microsoft login.                                                */
/* -------------------------------------------------------------------------- */

router.get("/auth/embedded-sso", async (req, res): Promise<void> => {
  const token =
    typeof req.query.token === "string" ? req.query.token : "";

  const returnTo =
    typeof req.query.returnTo === "string"
      ? sanitizeReturnTo(req.query.returnTo)
      : "/";

  req.log.info(
    {
      hasToken: Boolean(token),
      returnTo,
    },
    "Field Service embedded SSO started",
  );

  if (!token) {
    res.status(400).type("text").send("Missing SSO token.");
    return;
  }

  const identity = verifyEmbeddedSsoToken(
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
      .send("Invalid or expired SSO token.");

    return;
  }

  try {
    /*
     * Verify that the Workspace user is actually authorized
     * to use Field Service Calendar.
     */
    const role = await checkAppAccess(
      identity.sub,
      CALENDAR_APP,
    );

    /*
     * Create Field Service's own session.
     *
     * This is important because the iframe must have its own
     * fieldservice.sid session after SSO.
     */
    req.session.user = {
      entraOid: identity.sub,
      email: identity.email,
      displayName: identity.name,
      role,
      calendarAccess: true,
    };

    req.session.authApp = "calendar";

    await new Promise<void>((resolve, reject) => {
      req.session.save((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    req.log.info(
      {
        email: identity.email,
        displayName: identity.name,
        role,
        sessionId: req.sessionID,
      },
      "Field Service embedded session created",
    );

    res.redirect(returnTo);
  } catch (err) {
    if (err instanceof AccessError) {
      res.status(err.status).type("text").send(err.message);
      return;
    }

    req.log.error(
      { err },
      "Field Service embedded SSO failed",
    );

    res
      .status(503)
      .type("text")
      .send("Embedded sign-in could not be completed.");
  }
});

/* -------------------------------------------------------------------------- */
/* Microsoft OAuth Callback                                                   */
/* -------------------------------------------------------------------------- */

router.get("/auth/callback", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).send("Azure auth is not configured");
    return;
  }

  try {
    if (
      typeof req.query.state !== "string" ||
      req.query.state !== req.session.authState
    ) {
      res.status(403).send("Invalid state parameter");
      return;
    }

    delete req.session.authState;

    if (typeof req.query.code !== "string") {
      res.status(400).send("Missing authorization code");
      return;
    }

    const token = await getMsalClient().acquireTokenByCode({
      code: req.query.code,
      scopes: LOGIN_SCOPES,
      redirectUri: REDIRECT_URI,
    });

    const claims = token.idTokenClaims as {
      oid?: string;
      preferred_username?: string;
      email?: string;
      upn?: string;
      name?: string;
    };

    if (!claims.oid) {
      res.status(400).send("ID token missing object id");
      return;
    }

    const returnTo = sanitizeReturnTo(req.session.returnTo);

    const invoice =
      req.session.authApp === "proforma" ||
      returnTo.startsWith("/pro-forma-service-invoice/");

    const role = await checkAppAccess(
      claims.oid,
      invoice ? INVOICE_APP : CALENDAR_APP,
    );

    const previous =
      req.session.user?.entraOid === claims.oid
        ? req.session.user
        : undefined;

    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    req.session.user = {
      entraOid: claims.oid,
      email:
        claims.preferred_username ??
        claims.email ??
        claims.upn,
      displayName: claims.name,

      /*
       * The legacy role is exclusively Calendar's role.
       * Pro Forma has its own role through requireInvoiceAccess().
       */
      role: invoice
        ? previous?.role ?? "viewer"
        : role,

      calendarAccess: invoice
        ? Boolean(previous && previous.calendarAccess !== false)
        : true,
    };

    req.session.authApp = invoice
      ? "proforma"
      : "calendar";

    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    req.log.info(
      {
        email: req.session.user.email,
        displayName: req.session.user.displayName,
        role: req.session.user.role,
        invoice,
      },
      "User session created via OAuth callback",
    );

    res.redirect(returnTo);
  } catch (err) {
    if (err instanceof AccessError) {
      res.status(err.status).send(err.message);
      return;
    }

    req.log.error(
      { err },
      "Azure login failed",
    );

    res.status(500).send("Login failed");
  }
});

/* -------------------------------------------------------------------------- */
/* Current User                                                               */
/* -------------------------------------------------------------------------- */

router.get("/me", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (
    req.query.app !== undefined &&
    req.query.app !== "calendar" &&
    req.query.app !== "proforma"
  ) {
    res.status(400).json({
      message: "Unknown application",
    });
    return;
  }

  /*
   * Pro Forma has its own access check.
   */
  if (req.query.app === "proforma") {
    await requireInvoiceAccess(req, res, () => {
      res.json({
        ...req.session.user,
        role: res.locals.invoiceRole,
        app: INVOICE_APP,
      });
    });

    return;
  }

  /*
   * Invoice-only sessions can acquire Calendar access,
   * but Calendar's own access check must be performed.
   */
  if (req.session.user?.calendarAccess === false) {
    try {
      req.session.user.role = await checkAppAccess(
        req.session.user.entraOid,
        CALENDAR_APP,
      );

      req.session.user.calendarAccess = true;

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      sendAccessError(res, err);
      return;
    }
  }

  requireLogin(req, res, () => {
    res.json(req.session.user);
  });
});

/* -------------------------------------------------------------------------- */
/* Logout                                                                     */
/* -------------------------------------------------------------------------- */

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      res.status(503).json({
        message: "Could not end the session. Please retry.",
      });
      return;
    }

    /*
     * app.ts uses:
     *
     * name: "fieldservice.sid"
     *
     * so clear that cookie, not connect.sid.
     */
    res.clearCookie("fieldservice.sid", {
      path: "/",
    });

    if (req.get("Accept")?.includes("application/json")) {
      res.json({
        logoutUrl: LOGOUT_URL,
      });
    } else {
      res.redirect(LOGOUT_URL);
    }
  });
});

export default router;