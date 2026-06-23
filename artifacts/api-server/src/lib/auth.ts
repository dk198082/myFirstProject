import { type Request, type Response, type NextFunction } from "express";
import {
  ConfidentialClientApplication,
  type Configuration,
} from "@azure/msal-node";
import { logger } from "./logger.js";

// The Azure App Registration credentials are stored in this project under
// CLIENT_ID / TENANT_ID / CLIENT_SECRET. We also accept the ENTRA_* names used
// by the original reference server so either naming works.
const CLIENT_ID = process.env.ENTRA_CLIENT_ID ?? process.env.CLIENT_ID;
const TENANT_ID = process.env.ENTRA_TENANT_ID ?? process.env.TENANT_ID;
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET ?? process.env.CLIENT_SECRET;

// The redirect URI must exactly match one registered on the Azure app
// registration. Auth routes are mounted under /api, so the callback lives at
// /api/auth/callback. Falls back to the current Replit domain.
export const REDIRECT_URI =
  process.env.ENTRA_REDIRECT_URI ??
  (process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/api/auth/callback`
    : "http://localhost:8080/api/auth/callback");

export const LOGIN_SCOPES = ["openid", "profile", "email"];

export function isAuthConfigured(): boolean {
  return Boolean(CLIENT_ID && TENANT_ID && CLIENT_SECRET);
}

let cachedClient: ConfidentialClientApplication | null = null;

// Lazily construct the MSAL client so the API server still boots when auth is
// not configured; the auth routes surface a clear 503 in that case.
export function getMsalClient(): ConfidentialClientApplication {
  if (!isAuthConfigured()) {
    throw new Error(
      "Azure auth is not configured: set CLIENT_ID, TENANT_ID and CLIENT_SECRET",
    );
  }
  if (!cachedClient) {
    const config: Configuration = {
      auth: {
        clientId: CLIENT_ID as string,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: CLIENT_SECRET as string,
      },
    };
    cachedClient = new ConfidentialClientApplication(config);
  }
  return cachedClient;
}

export const LOGOUT_URL = `https://login.microsoftonline.com/${TENANT_ID ?? "common"}/oauth2/v2.0/logout`;

export interface SessionUser {
  entraOid: string;
  email: string | undefined;
  displayName: string | undefined;
  role: string;
}

export function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ message: "Login required" });
    return;
  }
  next();
}

export function requireRole(...roles: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.session.user) {
      res.status(401).json({ message: "Login required" });
      return;
    }
    if (!roles.includes(req.session.user.role)) {
      res.status(403).json({ message: "Access denied" });
      return;
    }
    next();
  };
}

if (!isAuthConfigured()) {
  logger.warn(
    "Azure auth credentials are not fully set (CLIENT_ID/TENANT_ID/CLIENT_SECRET); /api/login will return 503 until configured",
  );
}

// Augment express-session so req.session.user / authState are typed everywhere.
declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    authState?: string;
    returnTo?: string;
  }
}

// Only allow same-origin relative paths as post-login redirect targets, to
// avoid open-redirect via the returnTo parameter.
export function safeReturnTo(value: unknown): string {
  if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }
  return "/";
}
