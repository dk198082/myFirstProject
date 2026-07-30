import { ClientSecretCredential } from "@azure/identity";
import { logger } from "./logger";

// Sends email through Exchange Online via the Microsoft Graph API, using the
// same Azure AD app registration (client-credential flow) as the D365
// connections. Requires the app to have the Microsoft Graph APPLICATION
// permission "Mail.Send" with admin consent granted. IT can (and should)
// restrict which mailbox the app may send from using an Exchange Online
// Application Access Policy.
//
// Config (env):
//   STOREROOM_EMAIL          – destination inbox for part requests
//   STOREROOM_SENDER_MAILBOX – mailbox the message is sent from (UPN/email)

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

let credential: ClientSecretCredential | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

export class GraphMailError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "GraphMailError";
  }
}

async function getGraphToken(): Promise<string> {
  if (!tenantId || !clientId || !clientSecret) {
    throw new GraphMailError(
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
  const result = await credential.getToken("https://graph.microsoft.com/.default");
  cachedToken = { token: result.token, expiresAt: result.expiresOnTimestamp };
  logger.info("Azure AD token acquired for Microsoft Graph");
  return result.token;
}

/** Sends a plain-text email from `fromMailbox` via Microsoft Graph. */
export async function sendMailViaGraph(opts: {
  fromMailbox: string;
  to: string;
  cc?: string[];
  subject: string;
  body: string;
}): Promise<void> {
  const token = await getGraphToken();
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(opts.fromMailbox)}/sendMail`;

  const ccRecipients = (opts.cc ?? [])
    .filter((a) => a.trim())
    .map((a) => ({ emailAddress: { address: a.trim() } }));

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: opts.subject,
        body: { contentType: "Text", content: opts.body },
        toRecipients: [{ emailAddress: { address: opts.to } }],
        ...(ccRecipients.length > 0 ? { ccRecipients } : {}),
      },
      saveToSentItems: true,
    }),
  });

  // Graph returns 202 Accepted on success.
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.error(
      { status: resp.status, body: body.slice(0, 2000), to: opts.to, fromMailbox: opts.fromMailbox },
      "Graph sendMail failed",
    );
    if (resp.status === 401 || resp.status === 403) {
      throw new GraphMailError(
        'Exchange rejected the request. The Azure app registration needs the Microsoft Graph application permission "Mail.Send" with admin consent granted (Azure Portal > App registrations > API permissions).',
        resp.status,
        body,
      );
    }
    if (resp.status === 404) {
      throw new GraphMailError(
        `Sender mailbox "${opts.fromMailbox}" was not found in Exchange Online. Check STOREROOM_SENDER_MAILBOX.`,
        resp.status,
        body,
      );
    }
    throw new GraphMailError(`Sending mail failed with status ${resp.status}`, resp.status, body);
  }

  logger.info({ to: opts.to, subject: opts.subject }, "Storeroom request email sent");
}
