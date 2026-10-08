import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

export const CALENDAR_APP = "Field Service Calendar";
export const INVOICE_APP = "Pro Forma Service Invoice";
export const acDataSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  roles: z.array(z.string()),
});

export class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Credentials and grants are app-scoped even though Microsoft identity is shared. */
export async function checkAppAccess(entraOid: string, app: typeof CALENDAR_APP | typeof INVOICE_APP) {
  const url = process.env.ADMIN_CONSOLE_URL;
  const key = app === INVOICE_APP ? process.env.PROFORMA_ADMIN_CONSOLE_API_KEY : process.env.ADMIN_CONSOLE_API_KEY;
  if (!url || !key) throw new AccessError(500, `Auth not configured: ADMIN_CONSOLE_URL or ${app === INVOICE_APP ? "PROFORMA_ADMIN_CONSOLE_API_KEY" : "ADMIN_CONSOLE_API_KEY"} is not set`);
  let body: unknown;
  try {
    const response = await fetch(
      `${url.replace(/\/$/, "")}/api/access-check?entraObjectId=${encodeURIComponent(entraOid)}&app=${encodeURIComponent(app)}`,
      { headers: { "X-API-Key": key }, signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) throw new AccessError(503, "Authorisation service unavailable");
    try { body = JSON.parse(await response.text()); }
    catch { throw new AccessError(503, "Unexpected response from authorisation service"); }
  } catch (err) {
    if (err instanceof AccessError) throw err;
    throw new AccessError(503, "Authorisation service unavailable");
  }
  const parsed = acDataSchema.safeParse(body);
  if (!parsed.success) throw new AccessError(503, "Unexpected response from authorisation service");
  if (!parsed.data.allowed) throw new AccessError(403, `User is authenticated but not authorized: ${parsed.data.reason ?? "No access configured"}`);
  const otherApp = app === INVOICE_APP ? CALENDAR_APP : INVOICE_APP;
  const roles = parsed.data.roles.filter((role) => !role.trim().toLowerCase().startsWith(otherApp.toLowerCase()));
  if (parsed.data.roles.length && !roles.length) throw new AccessError(403, "Access denied: no role assigned for this application");
  return roles.some((role) => /read\s*\/\s*write/i.test(role)) ? "editor" as const : "viewer" as const;
}

export function sendAccessError(res: Response, err: unknown) {
  const error = err instanceof AccessError ? err : new AccessError(503, "Authorisation service unavailable");
  res.status(error.status).json({ message: error.message, error: error.message });
}

/** Always revalidate invoice grants: role changes/revocations affect the next request. */
export async function requireInvoiceAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.session.user) { res.status(401).json({ message: "Login required" }); return; }
  try {
    res.locals.invoiceRole = await checkAppAccess(req.session.user.entraOid, INVOICE_APP);
    next();
  } catch (err) { sendAccessError(res, err); }
}
