let cachedGraphToken: { value: string; expiresAt: number } | null = null;

/** Use the existing mail-enabled registration, not the authentication-only one. */
export async function getGraphAccessToken(): Promise<string> {
  const tenantId = process.env.TENANT_ID ?? process.env.ENTRA_TENANT_ID;
  const clientId = process.env.CLIENT_ID ?? process.env.ENTRA_CLIENT_ID;
  const clientSecret = process.env.CLIENT_SECRET ?? process.env.ENTRA_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) throw new Error("Azure mail credentials are not configured.");
  const now = Date.now();
  if (cachedGraphToken && cachedGraphToken.expiresAt > now + 60_000) return cachedGraphToken.value;
  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({
      grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!response.ok) throw new Error(`Microsoft mail authentication failed (${response.status})`);
  const json = await response.json() as { access_token: string; expires_in: number };
  if (!json.access_token || !Number.isFinite(json.expires_in) || json.expires_in <= 0) {
    throw new Error("Microsoft mail authentication returned an invalid response");
  }
  cachedGraphToken = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
  return cachedGraphToken.value;
}
