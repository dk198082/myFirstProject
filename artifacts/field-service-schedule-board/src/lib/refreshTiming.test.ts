import { describe, expect, it } from "vitest";
import { BOARD_POLL_MS, SAVE_RECHECK_MS } from "./refreshTiming";

describe("live calendar refresh timing", () => {
  it("polls within the normal 20-second ingestion-to-board budget", () => {
    // Eight seconds between ingestion attempts, two seconds for Dataverse's
    // timestamp boundary, then eight seconds until the next board poll.
    expect(8_000 + 2_000 + BOARD_POLL_MS).toBeLessThanOrEqual(20_000);
  });

  it("refetches after direct booking saves while the CRM mirror catches up", () => {
    expect(SAVE_RECHECK_MS).toEqual([5_000, 12_000, 20_000]);
  });
});