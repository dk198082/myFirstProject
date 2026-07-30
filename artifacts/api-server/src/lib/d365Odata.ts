import { ClientSecretCredential } from "@azure/identity";
import { logger } from "./logger";

// Real-time write-back to Dynamics 365 Finance & Operations via its OData API.
// Uses the same Azure AD app registration (client-credential flow) as the
// staging database, but with the D365 environment as the token audience. The
// app must ALSO be registered inside D365 under
// System administration > Setup > Microsoft Entra ID applications, otherwise
// D365 rejects the call with 401/403 even though the token itself is valid.

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

/** D365 F&O environment base URL, e.g. https://toprod.operations.dynamics.com */
const d365Url = (process.env.D365_URL ?? "").replace(/\/+$/, "");

let credential: ClientSecretCredential | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

export class D365Error extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "D365Error";
  }
}

async function getToken(): Promise<string> {
  if (!d365Url) {
    throw new D365Error("D365_URL is not configured");
  }
  if (!tenantId || !clientId || !clientSecret) {
    throw new D365Error(
      "Azure AD credentials missing (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)",
    );
  }
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.token;
  }
  if (!credential) {
    credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  const result = await credential.getToken(`${d365Url}/.default`);
  cachedToken = { token: result.token, expiresAt: result.expiresOnTimestamp };
  logger.info("Azure AD token acquired for D365 OData");
  return result.token;
}

/**
 * Updates the production group of a production order in D365 F&O.
 * PATCHes the custom TO_SOProdTable data entity (backed directly by ProdTable)
 * keyed by company + production order id. The standard ProductionOrderHeaders
 * entity is NOT used because its entity-level validation only allows updates
 * on orders with status Created — TO_SOProdTable relies on ProdTable's own
 * table validation, which permits group changes on Started orders (it only
 * blocks Ended orders). `cross-company=true` is required because the entity
 * key includes a dataAreaId that may differ from the app user's default
 * company.
 *
 * Throws D365Error on any failure — callers must surface it, never swallow it.
 */
export async function updateProductionGroupInD365(
  dataAreaId: string,
  productionOrderNumber: string,
  productionGroupId: string,
): Promise<void> {
  const token = await getToken();
  const key = `dataAreaId='${encodeURIComponent(dataAreaId)}',ProdId='${encodeURIComponent(productionOrderNumber)}'`;
  const url = `${d365Url}/data/TO_SOProdTable(${key})?cross-company=true`;

  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "If-Match": "*",
    },
    body: JSON.stringify({ ProdGroupId: productionGroupId }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.error(
      { status: resp.status, body: body.slice(0, 2000), productionOrderNumber, productionGroupId },
      "D365 production-group update failed",
    );
    if (resp.status === 401 || resp.status === 403) {
      throw new D365Error(
        "D365 rejected the request (authorization). The Azure app registration must be added in D365 under System administration > Setup > Microsoft Entra ID applications with a user that has permission to update production orders.",
        resp.status,
        body,
      );
    }
    throw new D365Error(
      `D365 update failed with status ${resp.status}`,
      resp.status,
      body,
    );
  }

  logger.info(
    { productionOrderNumber, productionGroupId },
    "D365 production group updated",
  );
}
