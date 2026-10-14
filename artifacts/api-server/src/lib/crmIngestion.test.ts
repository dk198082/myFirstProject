import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchModifiedEntities: vi.fn(),
  fetchWorkOrderById: vi.fn(),
  connect: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("./crmDb.js", () => ({
  getCrmPool: () => ({ connect: mocks.connect }),
  isCrmConfigured: () => true,
}));
vi.mock("./dataverse.js", () => ({
  DataverseThrottleError: class extends Error { retryAfterMs = 30000; },
  fetchModifiedEntities: mocks.fetchModifiedEntities,
  fetchWorkOrderById: mocks.fetchWorkOrderById,
  isDataverseConfigured: () => true,
}));
vi.mock("./logger.js", () => ({ logger: { error: mocks.error, info: mocks.info } }));

import { ingestCrmChanges, windowStart } from "./crmIngestion.js";

const id = "00000000-0000-4000-8000-000000000001";
const woId = "00000000-0000-4000-8000-000000000002";

function fakeClient() {
  const statements: Array<{ text: string; params: unknown[] }> = [];
  const query = vi.fn(async (text: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
    statements.push({ text, params });
    if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }], rowCount: 1 };
    if (text.includes("SELECT checkpoint")) return { rows: [{ checkpoint: new Date("2026-09-22T12:00:00Z") }], rowCount: 1 };
    if (text.includes("SELECT EXISTS")) return { rows: [{ found: true }], rowCount: 1 };
    if (text.includes("SELECT 1 FROM crm.workorder")) return { rowCount: 1, rows: [{}] };
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  mocks.connect.mockResolvedValue({ query, release });
  return { statements, query, release };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchModifiedEntities.mockResolvedValue([]);
});

describe("CRM calendar ingestion", () => {
  it("includes fee lines in the same serialized recurring cycle", async () => {
    fakeClient();
    await ingestCrmChanges();
    expect(mocks.fetchModifiedEntities.mock.calls.map(([entity]) => entity)).toEqual([
      "msdyn_workorders", "bookableresourcebookings", "msdyn_workorderservices",
    ]);
  });
  it("catches up fees from the old mirror snapshot, beyond the seven-day calendar window", async () => {
    const { query, statements } = fakeClient();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (text: string, params?: unknown[]) => {
      if (text.includes("SELECT checkpoint")) return { rows: [{ checkpoint: null }], rowCount: 1 };
      if (text.includes("max(modifiedon)")) return {
        rows: [{ checkpoint: new Date("2026-09-25T19:36:10Z") }], rowCount: 1,
      };
      return original(text, params);
    });
    mocks.fetchModifiedEntities.mockResolvedValue([{
      msdyn_workorderserviceid: id, _msdyn_workorder_value: woId,
      modifiedon: "2026-10-09T09:53:05Z", msdyn_unitcost: 100,
      "cf_projectcategorylist@OData.Community.Display.V1.FormattedValue": "Test Fee",
    }]);
    await ingestCrmChanges(["msdyn_workorderservices"]);
    expect(mocks.fetchModifiedEntities.mock.calls[0][1]).toBe("2026-09-25T19:26:10.000Z");
    const feeIndex = statements.findIndex((s) => s.text.includes("INSERT INTO crm.fees"));
    const checkpointIndex = statements.findIndex((s) => s.text.includes("checkpoint = EXCLUDED.checkpoint"));
    expect(feeIndex).toBeGreaterThan(-1);
    expect(checkpointIndex).toBeGreaterThan(feeIndex);
    expect(statements.findIndex((s) => s.text === "COMMIT")).toBeGreaterThan(checkpointIndex);
  });
  it("rolls back failed fee writes without advancing the fee checkpoint", async () => {
    const { query, statements } = fakeClient();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (text: string, params?: unknown[]) => {
      if (text.includes("INSERT INTO crm.fees")) throw new Error("Fee write failed");
      return original(text, params);
    });
    mocks.fetchModifiedEntities.mockResolvedValue([{
      msdyn_workorderserviceid: id, modifiedon: "2026-10-09T00:00:00Z",
    }]);
    await ingestCrmChanges(["msdyn_workorderservices"]);
    expect(statements.some((s) => s.text === "ROLLBACK")).toBe(true);
    expect(statements.some((s) => s.text.includes("checkpoint = EXCLUDED.checkpoint"))).toBe(false);
    expect(statements.some((s) => s.text.includes("pg_advisory_unlock"))).toBe(true);
  });
  it("overlaps the previous checkpoint so boundary changes are recaptured", () => {
    expect(windowStart(new Date("2026-09-22T12:00:00Z"), new Date("2026-09-22T12:05:00Z")))
      .toBe("2026-09-22T11:50:00.000Z");
  });

  it("ingests externally changed bookings and advances only after the upsert commits", async () => {
    const { statements, release } = fakeClient();
    mocks.fetchModifiedEntities.mockImplementation(async (entity: string) => entity === "bookableresourcebookings"
      ? [{
          bookableresourcebookingid: id, _msdyn_workorder_value: woId,
          name: "Updated", starttime: "2026-09-30T12:00:00Z",
          endtime: "2026-09-30T20:30:00Z", modifiedon: "2026-09-22T12:03:00Z",
          _resource_value: id, _bookingstatus_value: id,
        }]
      : []);
    await ingestCrmChanges();
    const bookingIndex = statements.findIndex((s) => s.text.includes("INSERT INTO crm.booking ("));
    const commitIndex = statements.findIndex((s, i) => i > bookingIndex && s.text === "COMMIT");
    const checkpointIndex = statements.findIndex((s, i) =>
      i > bookingIndex && s.text.includes("checkpoint = EXCLUDED.checkpoint"));
    expect(bookingIndex).toBeGreaterThan(-1);
    expect(statements[bookingIndex]?.params).toContain("2026-09-30T20:30:00Z");
    expect(checkpointIndex).toBeGreaterThan(bookingIndex);
    expect(commitIndex).toBeGreaterThan(checkpointIndex);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not advance a checkpoint on an incomplete Dataverse page", async () => {
    const { statements } = fakeClient();
    mocks.fetchModifiedEntities.mockRejectedValueOnce(new Error("Dataverse page failed"));
    await ingestCrmChanges();
    expect(statements.some((s) => s.text.includes("checkpoint = EXCLUDED.checkpoint"))).toBe(false);
    expect(statements.some((s) => s.text.includes("pg_advisory_unlock"))).toBe(true);
    expect(mocks.error).toHaveBeenCalled();
  });

  it("handles mirror connection failures without rejecting an API request or timer tick", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("CRM mirror unavailable"));
    await expect(ingestCrmChanges()).resolves.toBeUndefined();
    expect(mocks.error).toHaveBeenCalled();
  });

  it("does not checkpoint a booking whose resource cannot appear on the board", async () => {
    const { statements, query } = fakeClient();
    query.mockImplementation(async (text: string) => {
      statements.push({ text, params: [] });
      if (text.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }], rowCount: 1 };
      if (text.includes("SELECT checkpoint")) return { rows: [{ checkpoint: new Date() }], rowCount: 1 };
      if (text.includes("SELECT 1 FROM crm.workorder")) return { rows: [{}], rowCount: 1 };
      if (text.includes("crm.bookableresource WHERE")) return { rows: [{ found: false }], rowCount: 1 };
      if (text.includes("SELECT EXISTS")) return { rows: [{ found: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.fetchModifiedEntities.mockImplementation(async (entity: string) => entity === "bookableresourcebookings"
      ? [{ bookableresourcebookingid: id, _msdyn_workorder_value: woId, _resource_value: id }]
      : []);
    await ingestCrmChanges();
    expect(statements.some((s) => s.text === "ROLLBACK")).toBe(true);
    expect(statements.filter((s) => s.text.includes("checkpoint = EXCLUDED.checkpoint"))).toHaveLength(1);
  });
});