import { Router } from "express";
import crypto from "node:crypto";
import {
  getMsalClient, isAuthConfigured, requireLogin,
  REDIRECT_URI, LOGIN_SCOPES, LOGOUT_URL,
} from "../lib/auth.js";
import {
  CALENDAR_APP, INVOICE_APP, AccessError, checkAppAccess,
  requireInvoiceAccess, sendAccessError,
} from "../lib/appAccess.js";

export { acDataSchema } from "../lib/appAccess.js";
const router = Router();

function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

router.get("/login", async (req, res) => {
  if (!isAuthConfigured()) { res.status(503).send("Azure auth is not configured"); return; }
  if (req.query.app !== undefined && req.query.app !== "calendar" && req.query.app !== "proforma") {
    res.status(400).send("Unknown application"); return;
  }
  const returnTo = sanitizeReturnTo(req.query.returnTo);
  req.session.returnTo = returnTo;
  req.session.authApp = req.query.app === "proforma" || returnTo.startsWith("/pro-forma-service-invoice/") ? "proforma" : "calendar";
  const state = crypto.randomBytes(16).toString("hex");
  req.session.authState = state;
  const authUrl = await getMsalClient().getAuthCodeUrl({ scopes: LOGIN_SCOPES, redirectUri: REDIRECT_URI, state });
  res.redirect(authUrl);
});

router.get("/auth/callback", async (req, res) => {
  if (!isAuthConfigured()) { res.status(503).send("Azure auth is not configured"); return; }
  try {
    if (typeof req.query.state !== "string" || req.query.state !== req.session.authState) {
      res.status(403).send("Invalid state parameter"); return;
    }
    delete req.session.authState;
    if (typeof req.query.code !== "string") { res.status(400).send("Missing authorization code"); return; }
    const token = await getMsalClient().acquireTokenByCode({
      code: req.query.code, scopes: LOGIN_SCOPES, redirectUri: REDIRECT_URI,
    });
    const claims = token.idTokenClaims as { oid?: string; preferred_username?: string; email?: string; upn?: string; name?: string };
    if (!claims.oid) { res.status(400).send("ID token missing object id"); return; }
    const returnTo = sanitizeReturnTo(req.session.returnTo);
    const invoice = req.session.authApp === "proforma" || returnTo.startsWith("/pro-forma-service-invoice/");
    const role = await checkAppAccess(claims.oid, invoice ? INVOICE_APP : CALENDAR_APP);
    const previous = req.session.user?.entraOid === claims.oid ? req.session.user : undefined;
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    req.session.user = {
      entraOid: claims.oid,
      email: claims.preferred_username ?? claims.email ?? claims.upn,
      displayName: claims.name,
      // The legacy role is exclusively Calendar's role, never the invoice role.
      role: invoice ? previous?.role ?? "viewer" : role,
      calendarAccess: invoice ? Boolean(previous && previous.calendarAccess !== false) : true,
    };
    res.redirect(returnTo);
  } catch (err) {
    if (err instanceof AccessError) { res.status(err.status).send(err.message); return; }
    req.log.error({ err }, "Azure login failed");
    res.status(500).send("Login failed");
  }
});

router.get("/me", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.query.app !== undefined && req.query.app !== "calendar" && req.query.app !== "proforma") {
    res.status(400).json({ message: "Unknown application" }); return;
  }
  if (req.query.app === "proforma") {
    await requireInvoiceAccess(req, res, () => {
      res.json({ ...req.session.user, role: res.locals.invoiceRole, app: INVOICE_APP });
    });
    return;
  }
  // Invoice-only sessions may acquire Calendar access, but only with Calendar's key.
  if (req.session.user?.calendarAccess === false) {
    try {
      req.session.user.role = await checkAppAccess(req.session.user.entraOid, CALENDAR_APP);
      req.session.user.calendarAccess = true;
    } catch (err) { sendAccessError(res, err); return; }
  }
  requireLogin(req, res, () => res.json(req.session.user));
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) { res.status(503).json({ message: "Could not end the session. Please retry." }); return; }
    res.clearCookie("connect.sid", { path: "/" });
    if (req.get("Accept")?.includes("application/json")) res.json({ logoutUrl: LOGOUT_URL });
    else res.redirect(LOGOUT_URL);
  });
});

export default router;
