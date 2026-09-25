import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Dataverse modified entity pagination", () => {
  it("reads all pages and keeps annotation fields for board status rendering", async () => {
    vi.stubEnv("TENANT_ID", "example-tenant");
    vi.stubEnv("CLIENT_ID", "example-client");
    vi.stubEnv("CLIENT_SECRET", "example-secret");
    vi.stubEnv("DATAVERSE_URL", "https://crm.example.test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ access_token: "test-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true, json: async () => ({
          value: [{ bookableresourcebookingid: "first", "_bookingstatus_value@OData.Community.Display.V1.FormattedValue": "Scheduled" }],
          "@odata.nextLink": "https://crm.example.test/api/data/v9.2/bookableresourcebookings?$skiptoken=next",
        }),
      })
      .mockResolvedValueOnce({
        ok: true, json: async () => ({ value: [{ bookableresourcebookingid: "second" }] }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const { fetchModifiedEntities } = await import("./dataverse.js");
    const rows = await fetchModifiedEntities(
      "bookableresourcebookings", "2026-09-22T12:00:00Z", "2026-09-22T12:05:00Z",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["_bookingstatus_value@OData.Community.Display.V1.FormattedValue"]).toBe("Scheduled");
    const url = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(url.searchParams.get("$filter")).toContain("modifiedon ge 2026-09-22T12:00:00Z");
    expect(url.searchParams.has("$top")).toBe(false); // $top would silently cap the whole result set
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a failed next page rather than returning a partial sync", async () => {
    vi.stubEnv("TENANT_ID", "example-tenant");
    vi.stubEnv("CLIENT_ID", "example-client");
    vi.stubEnv("CLIENT_SECRET", "example-secret");
    vi.stubEnv("DATAVERSE_URL", "https://crm.example.test");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "token", expires_in: 3600 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: [{}], "@odata.nextLink": "https://crm.example.test/api/data/v9.2/msdyn_workorders?$skiptoken=next" }),
      })
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers({ "retry-after": "10" }) }));
    const { fetchModifiedEntities } = await import("./dataverse.js");
    await expect(fetchModifiedEntities("msdyn_workorders", "2026-09-22T12:00:00Z", "2026-09-22T12:05:00Z"))
      .rejects.toThrow("retry after 10s");
  });
});