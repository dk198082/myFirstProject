import { Router } from "express";
import crypto from "node:crypto";
import { localPool } from "../lib/localDb.js";
import {
  getMsalClient,
  isAuthConfigured,
  requireLogin,
  REDIRECT_URI,
  LOGIN_SCOPES,
  LOGOUT_URL,
} from "../lib/auth.js";

const router = Router();

router.get("/login", async (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).send("Azure auth is not configured");
    return;
  }

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
    if (typeof returnedState !== "string" || returnedState !== req.session.authState) {
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

    const result = await localPool.query<{
      entra_oid: string;
      email: string;
      display_name: string | null;
      role: string;
    }>(
      `
      SELECT entra_oid, email, display_name, role
      FROM app.app_user
      WHERE entra_oid = $1
        AND is_active = true
      `,
      [entraOid],
    );

    if (result.rowCount === 0) {
      res.status(403).send("User is authenticated but not authorized.");
      return;
    }

    req.session.user = {
      entraOid,
      email,
      displayName,
      role: result.rows[0].role,
    };

    res.redirect("/");
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
