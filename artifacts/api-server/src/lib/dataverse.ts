import { logger } from "./logger.js";

const TENANT_ID = process.env.TENANT_ID?.trim();
const CLIENT_ID = process.env.CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.CLIENT_SECRET?.trim();
const DATAVERSE_URL = process.env.DATAVERSE_URL?.trim().replace(/\/+$/, "");

const API_VERSION = "v9.2";

export function isDataverseConfigured(): boolean {
  return Boolean(TENANT_ID && CLIENT_ID && CLIENT_SECRET && DATAVERSE_URL);
}

function requireConfig(): {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  baseUrl: string;
} {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !DATAVERSE_URL) {
    throw new Error(
      "Dataverse is not configured. Set TENANT_ID, CLIENT_ID, CLIENT_SECRET, and DATAVERSE_URL.",
    );
  }
  return {
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    baseUrl: DATAVERSE_URL,
  };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const { tenantId, clientId, clientSecret, baseUrl } = requireConfig();

  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${baseUrl}/.default`,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to acquire Dataverse token (${res.status}): ${text}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: now + json.expires_in * 1000,
  };
  return cachedToken.value;
}

export interface BookingPatch {
  startTime?: string | null;
  endTime?: string | null;
  resourceId?: string | null;
}

/**
 * PATCH a bookableresourcebooking in Dataverse. Only non-null fields are sent so
 * staged edits never wipe required values. Returns when Dataverse confirms the update.
 */
export async function patchBooking(bookingId: string, patch: BookingPatch): Promise<void> {
  const { baseUrl } = requireConfig();
  const token = await getAccessToken();

  const payload: Record<string, unknown> = {};
  if (patch.startTime) payload.starttime = patch.startTime;
  if (patch.endTime) payload.endtime = patch.endTime;
  if (patch.resourceId) {
    payload["Resource@odata.bind"] = `/bookableresources(${patch.resourceId})`;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error("No syncable fields on this write-back (start, end, and technician are all empty).");
  }

  const url = `${baseUrl}/api/data/${API_VERSION}/bookableresourcebookings(${bookingId})`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
      "If-Match": "*",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // keep raw text
    }
    logger.error({ bookingId, status: res.status, message }, "Dataverse booking PATCH failed");
    throw new Error(`Dataverse update failed (${res.status}): ${message}`);
  }
}

export interface BookingCreate {
  workOrderId: string;
  startTime?: string | null;
  endTime?: string | null;
  resourceId?: string | null;
}

/**
 * Create a new bookableresourcebooking in Dataverse for an unscheduled work
 * order. The booking is bound to the work order (and resource, when provided).
 * Start and end times are required so Dataverse can place the booking on the
 * schedule. Throws with the Dataverse error message on failure.
 */
export async function createBooking(create: BookingCreate): Promise<void> {
  const { baseUrl } = requireConfig();
  const token = await getAccessToken();

  if (!create.startTime || !create.endTime) {
    throw new Error("A new booking requires both a start and end time.");
  }

  const payload: Record<string, unknown> = {
    starttime: create.startTime,
    endtime: create.endTime,
    "msdyn_WorkOrder@odata.bind": `/msdyn_workorders(${create.workOrderId})`,
  };
  if (create.resourceId) {
    payload["Resource@odata.bind"] = `/bookableresources(${create.resourceId})`;
  }

  const url = `${baseUrl}/api/data/${API_VERSION}/bookableresourcebookings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // keep raw text
    }
    logger.error(
      { workOrderId: create.workOrderId, status: res.status, message },
      "Dataverse booking CREATE failed",
    );
    throw new Error(`Dataverse create failed (${res.status}): ${message}`);
  }
}
