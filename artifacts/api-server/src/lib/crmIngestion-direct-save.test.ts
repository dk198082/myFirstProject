import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchBookingById } from "./dataverse.js";
import { getCrmPool } from "./crmDb.js";
import { mirrorSavedBooking } from "./crmIngestion.js";

vi.mock("./dataverse.js", () => ({
  fetchBookingById: vi.fn(),
  fetchWorkOrderById: vi.fn(),
  fetchModifiedEntities: vi.fn(),
  isDataverseConfigured: vi.fn(() => true),
  DataverseThrottleError: class extends Error {},
}));
vi.mock("./crmDb.js", () => ({
  getCrmPool: vi.fn(),
  isCrmConfigured: vi.fn(() => true),
}));
vi.mock("./logger.js", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

const bookingId = "11111111-1111-1111-1111-111111111111";
const startTime = "2026-09-25T09:00:00.000Z";
const endTime = "2026-09-25T10:00:00.000Z";
const savedBooking = {
  bookableresourcebookingid: bookingId,
  starttime: startTime,
  endtime: endTime,
  modifiedon: "2026-09-24T10:00:00Z",
};

describe("mirrorSavedBooking", () => {
  const query = vi.fn();
  const release = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchBookingById).mockResolvedValue(savedBooking);
    query.mockResolvedValue({ rows: [{ found: false }], rowCount: 1 });
    vi.mocked(getCrmPool).mockReturnValue({ connect: async () => ({ query, release }) } as never);
  });

  it("reads the confirmed booking and commits its CRM values to the mirror", async () => {
    await mirrorSavedBooking(bookingId, { startTime, endTime });
    expect(fetchBookingById).toHaveBeenCalledWith(bookingId);
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      expect.stringContaining("crm.bookableresource"),
      expect.stringContaining("crm.bookingstatus"),
      expect.stringContaining("INSERT INTO crm.booking"),
      "COMMIT",
    ]);
    const insertArgs = query.mock.calls[3][1] as unknown[];
    expect(insertArgs.slice(0, 4)).toEqual([bookingId, null, startTime, endTime]);
    expect(insertArgs.at(-1)).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("does not overwrite the mirror with a stale CRM read-back", async () => {
    vi.mocked(fetchBookingById).mockResolvedValue({ ...savedBooking, starttime: "2026-09-24T09:00:00Z" });
    await expect(mirrorSavedBooking(bookingId, { startTime })).rejects.toThrow("not reflected");
    expect(getCrmPool).not.toHaveBeenCalled();
  });

  it("rolls back if the mirror insert fails", async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO crm.booking")) throw new Error("mirror unavailable");
      return { rows: [{ found: false }], rowCount: 1 };
    });
    await expect(mirrorSavedBooking(bookingId, { startTime })).rejects.toThrow("mirror unavailable");
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});