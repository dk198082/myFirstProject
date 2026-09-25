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

// ---------------------------------------------------------------------------
// Dataverse read helpers — used by the CRM mirror back-fill endpoint
// ---------------------------------------------------------------------------

export interface DataverseWorkOrder {
  msdyn_workorderid: string;
  msdyn_name: string;
  msdyn_systemstatus: number | null;
  msdyn_serviceterritory: string | null;
  msdyn_serviceaccount: string | null;
  cf_servicelocation: string | null;
  msdyn_workordertype: string | null;
  msdyn_city: string | null;
  msdyn_stateorprovince: string | null;
  new_customerrequirement: string | null;
  ownerid: string | null;
  createdon: string | null;
  modifiedon: string | null;
  rawJson: Record<string, unknown>;
}

export interface DataverseBooking {
  bookableresourcebookingid: string;
  name: string | null;
  starttime: string | null;
  endtime: string | null;
  duration: number | null;
  resource: string | null;
  bookingstatus: string | null;
  msdyn_workorder: string | null;
  msdyn_actualarrivaltime: string | null;
  msdyn_actualtravelduration: number | null;
  msdyn_estimatedtravelduration: number | null;
  cf_actualarrivaltime: string | null;
  cf_endtime: string | null;
  cf_durationschedule: number | null;
  cf_duration: number | null;
  cf_fieldnotes: string | null;
  cf_internalfieldnotes: string | null;
  createdon: string | null;
  modifiedon: string | null;
  rawJson: Record<string, unknown>;
}

/**
 * Fetch one or more work orders from Dataverse by their msdyn_name (WO number).
 * Returns full entity data including formatted-value annotations for raw_json storage.
 */
export async function fetchWorkOrdersByName(woNames: string[]): Promise<DataverseWorkOrder[]> {
  if (woNames.length === 0) return [];
  const { baseUrl } = requireConfig();
  const token = await getAccessToken();

  const filter = woNames.map((n) => `msdyn_name eq '${n.replace(/'/g, "''")}'`).join(" or ");
  const url =
    `${baseUrl}/api/data/${API_VERSION}/msdyn_workorders` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$top=${woNames.length + 10}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dataverse WO fetch failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { value: Record<string, unknown>[] };
  return json.value.map((e) => ({
    msdyn_workorderid: e["msdyn_workorderid"] as string,
    msdyn_name: e["msdyn_name"] as string,
    msdyn_systemstatus: (e["msdyn_systemstatus"] as number | null) ?? null,
    msdyn_serviceterritory: (e["_msdyn_serviceterritory_value"] as string | null) ?? null,
    msdyn_serviceaccount: (e["_msdyn_serviceaccount_value"] as string | null) ?? null,
    cf_servicelocation: (e["_cf_servicelocation_value"] as string | null) ?? null,
    msdyn_workordertype: (e["_msdyn_workordertype_value"] as string | null) ?? null,
    msdyn_city: (e["msdyn_city"] as string | null) ?? null,
    msdyn_stateorprovince: (e["msdyn_stateorprovince"] as string | null) ?? null,
    new_customerrequirement: (e["new_customerrequirement"] as string | null) ?? null,
    ownerid: (e["_ownerid_value"] as string | null) ?? null,
    createdon: (e["createdon"] as string | null) ?? null,
    modifiedon: (e["modifiedon"] as string | null) ?? null,
    rawJson: e,
  }));
}

/**
 * Fetch all non-cancelled bookings for the given work order IDs.
 */
export async function fetchBookingsForWorkOrders(woIds: string[]): Promise<DataverseBooking[]> {
  if (woIds.length === 0) return [];
  const { baseUrl } = requireConfig();
  const token = await getAccessToken();

  const filter = woIds
    .map((id) => `_msdyn_workorder_value eq ${id}`)
    .join(" or ");
  const url =
    `${baseUrl}/api/data/${API_VERSION}/bookableresourcebookings` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$top=${woIds.length * 5 + 20}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dataverse booking fetch failed (${res.status}): ${text.slice(0, 500)}`);
  }

  const json = (await res.json()) as { value: Record<string, unknown>[] };
  return json.value.map((e) => ({
    bookableresourcebookingid: e["bookableresourcebookingid"] as string,
    name: (e["name"] as string | null) ?? null,
    starttime: (e["starttime"] as string | null) ?? null,
    endtime: (e["endtime"] as string | null) ?? null,
    duration: (e["duration"] as number | null) ?? null,
    resource: (e["_resource_value"] as string | null) ?? null,
    bookingstatus: (e["_bookingstatus_value"] as string | null) ?? null,
    msdyn_workorder: (e["_msdyn_workorder_value"] as string | null) ?? null,
    msdyn_actualarrivaltime: (e["msdyn_actualarrivaltime"] as string | null) ?? null,
    msdyn_actualtravelduration: (e["msdyn_actualtravelduration"] as number | null) ?? null,
    msdyn_estimatedtravelduration: (e["msdyn_estimatedtravelduration"] as number | null) ?? null,
    cf_actualarrivaltime: (e["cf_actualarrivaltime"] as string | null) ?? null,
    cf_endtime: (e["cf_endtime"] as string | null) ?? null,
    cf_durationschedule: (e["cf_durationschedule"] as number | null) ?? null,
    cf_duration: (e["cf_duration"] as number | null) ?? null,
    cf_fieldnotes: (e["cf_fieldnotes"] as string | null) ?? null,
    cf_internalfieldnotes: (e["cf_internalfieldnotes"] as string | null) ?? null,
    createdon: (e["createdon"] as string | null) ?? null,
    modifiedon: (e["modifiedon"] as string | null) ?? null,
    rawJson: e,
  }));
}

type DataverseEntity = Record<string, unknown>;

export class DataverseThrottleError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Dataverse ingestion throttled; retry after ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

/**
 * Fetch every page of recently changed records. A failed or incomplete page
 * throws so the ingestion checkpoint is never advanced past missing data.
 */
export async function fetchModifiedEntities(
  entitySet: "msdyn_workorders" | "bookableresourcebookings",
  from: string,
  through: string,
): Promise<DataverseEntity[]> {
  const { baseUrl } = requireConfig();
  const origin = new URL(baseUrl).origin;
  const root = `${baseUrl}/api/data/${API_VERSION}/${entitySet}`;
  const filter = `modifiedon ge ${from} and modifiedon le ${through}`;
  let next: string | null = `${root}?${new URLSearchParams({
    "$filter": filter,
    "$orderby": "modifiedon asc",
  })}`;
  const rows: DataverseEntity[] = [];
  const visited = new Set<string>();
  while (next) {
    const url = new URL(next, baseUrl);
    if (url.origin !== origin || !url.pathname.startsWith(`${new URL(baseUrl).pathname.replace(/\/$/, "")}/api/data/${API_VERSION}/${entitySet}`)) {
      throw new Error("Unexpected Dataverse paging URL");
    }
    if (visited.has(url.href)) throw new Error("Repeated Dataverse paging URL");
    visited.add(url.href);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=500',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const retryAfter = res.headers.get("retry-after");
      if (res.status === 429 || res.status === 503) {
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const delay = Number.isFinite(seconds) ? seconds * 1000
          : retryAfter ? Date.parse(retryAfter) - Date.now() : 30_000;
        throw new DataverseThrottleError(Math.max(8_000, Number.isFinite(delay) ? delay : 30_000));
      }
      throw new Error(`Dataverse ${entitySet} ingestion failed (${res.status})`);
    }
    const data = await res.json() as { value?: DataverseEntity[]; "@odata.nextLink"?: string };
    if (!Array.isArray(data.value)) throw new Error(`Invalid Dataverse ${entitySet} response`);
    rows.push(...data.value);
    next = data["@odata.nextLink"] ?? null;
  }
  return rows;
}

export async function fetchWorkOrderById(id: string): Promise<Record<string, unknown>> {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid work order ID");
  const { baseUrl } = requireConfig();
  const res = await fetch(`${baseUrl}/api/data/${API_VERSION}/msdyn_workorders(${id})`, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Dataverse parent work order fetch failed (${res.status})`);
  return res.json() as Promise<Record<string, unknown>>;
}

export async function fetchBookingById(id: string): Promise<Record<string, unknown>> {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) {
    throw new Error("Invalid booking ID");
  }
  const { baseUrl } = requireConfig();
  const res = await fetch(`${baseUrl}/api/data/${API_VERSION}/bookableresourcebookings(${id})`, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      Accept: "application/json",
      Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Dataverse booking read-back failed (${res.status})`);
  return res.json() as Promise<Record<string, unknown>>;
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
