import { describe, it, expect } from "vitest";
import { shiftIsoDays } from "./dateShift";

describe("shiftIsoDays", () => {
  it("shifts forward by a positive day delta", () => {
    expect(shiftIsoDays("2026-06-17T09:30:00.000Z", 1)).toBe("2026-06-18T09:30:00.000Z");
    expect(shiftIsoDays("2026-06-17T09:30:00.000Z", 3)).toBe("2026-06-20T09:30:00.000Z");
  });

  it("shifts backward by a negative day delta", () => {
    expect(shiftIsoDays("2026-06-17T09:30:00.000Z", -1)).toBe("2026-06-16T09:30:00.000Z");
    expect(shiftIsoDays("2026-06-17T09:30:00.000Z", -5)).toBe("2026-06-12T09:30:00.000Z");
  });

  it("is a no-op for a zero delta but normalizes to ISO form", () => {
    expect(shiftIsoDays("2026-06-17T09:30:00.000Z", 0)).toBe("2026-06-17T09:30:00.000Z");
  });

  it("preserves time-of-day across the shift", () => {
    const out = shiftIsoDays("2026-06-17T14:45:30.000Z", 7);
    expect(out).toBe("2026-06-24T14:45:30.000Z");
    const d = new Date(out!);
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(45);
    expect(d.getUTCSeconds()).toBe(30);
  });

  it("rolls over month boundaries while keeping time-of-day", () => {
    expect(shiftIsoDays("2026-06-30T08:00:00.000Z", 1)).toBe("2026-07-01T08:00:00.000Z");
    expect(shiftIsoDays("2026-01-01T08:00:00.000Z", -1)).toBe("2025-12-31T08:00:00.000Z");
  });

  it("returns null for missing inputs", () => {
    expect(shiftIsoDays(null, 1)).toBeNull();
    expect(shiftIsoDays(undefined, 1)).toBeNull();
    expect(shiftIsoDays("", 1)).toBeNull();
  });

  it("returns null for unparseable timestamps", () => {
    expect(shiftIsoDays("not-a-date", 1)).toBeNull();
  });

  it("normalizes ISO timestamps without milliseconds", () => {
    expect(shiftIsoDays("2026-06-17T09:30:00Z", 1)).toBe("2026-06-18T09:30:00.000Z");
  });
});
