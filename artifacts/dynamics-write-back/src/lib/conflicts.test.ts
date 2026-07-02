import { describe, it, expect } from "vitest";
import {
  timeToMins,
  windowsOverlap,
  conflictedIdsForTech,
  wouldDropConflict,
  type BookingWindow,
} from "./conflicts";

describe("timeToMins", () => {
  it("parses HH:MM into minutes since midnight", () => {
    expect(timeToMins("00:00")).toBe(0);
    expect(timeToMins("09:30")).toBe(570);
    expect(timeToMins("23:59")).toBe(1439);
  });

  it("treats a bare hour (missing minutes) as :00", () => {
    expect(timeToMins("8")).toBe(480);
  });

  it("returns null for missing or unparseable values", () => {
    expect(timeToMins(null)).toBeNull();
    expect(timeToMins(undefined)).toBeNull();
    expect(timeToMins("")).toBeNull();
    expect(timeToMins("not-a-time")).toBeNull();
  });
});

describe("windowsOverlap", () => {
  it("detects overlapping windows", () => {
    expect(windowsOverlap("09:00", "10:00", "09:30", "10:30")).toBe(true);
  });

  it("treats adjacent (touching) windows as non-overlapping", () => {
    // a ends exactly when b starts
    expect(windowsOverlap("09:00", "10:00", "10:00", "11:00")).toBe(false);
    // b ends exactly when a starts
    expect(windowsOverlap("10:00", "11:00", "09:00", "10:00")).toBe(false);
  });

  it("treats a fully contained window as overlapping", () => {
    expect(windowsOverlap("09:00", "12:00", "10:00", "11:00")).toBe(true);
  });

  it("treats a missing end as a 1-minute window at its start", () => {
    // a: 09:00 -> 09:01, b starts 09:00 -> overlaps
    expect(windowsOverlap("09:00", null, "09:00", "10:00")).toBe(true);
    // a: 09:00 -> 09:01, b starts 09:01 -> adjacent, no overlap
    expect(windowsOverlap("09:00", null, "09:01", "10:00")).toBe(false);
    // both missing ends, same start -> overlap
    expect(windowsOverlap("09:00", null, "09:00", null)).toBe(true);
    // both missing ends, different starts -> no overlap
    expect(windowsOverlap("09:00", null, "09:30", null)).toBe(false);
  });

  it("returns false when either start time is missing", () => {
    expect(windowsOverlap(null, "10:00", "09:00", "10:00")).toBe(false);
    expect(windowsOverlap("09:00", "10:00", null, "10:00")).toBe(false);
  });
});

describe("conflictedIdsForTech", () => {
  const job = (
    id: string,
    day_index: number,
    crmstarttime: string | null,
    crmendtime: string | null,
  ): BookingWindow => ({ booking_id: id, day_index, crmstarttime, crmendtime });

  it("flags both bookings of an overlapping same-day pair", () => {
    const ids = conflictedIdsForTech([
      job("a", 0, "09:00", "10:00"),
      job("b", 0, "09:30", "10:30"),
    ]);
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("does not flag adjacent (touching) same-day bookings", () => {
    const ids = conflictedIdsForTech([
      job("a", 0, "09:00", "10:00"),
      job("b", 0, "10:00", "11:00"),
    ]);
    expect(ids.size).toBe(0);
  });

  it("does not flag same-time bookings on different days", () => {
    const ids = conflictedIdsForTech([
      job("a", 0, "09:00", "10:00"),
      job("b", 1, "09:00", "10:00"),
    ]);
    expect(ids.size).toBe(0);
  });

  it("flags overlap caused by a missing end time", () => {
    const ids = conflictedIdsForTech([
      job("a", 0, "09:00", null),
      job("b", 0, "09:00", "10:00"),
    ]);
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("only flags the conflicting subset, leaving non-overlapping bookings alone", () => {
    const ids = conflictedIdsForTech([
      job("a", 0, "09:00", "10:00"),
      job("b", 0, "09:30", "10:30"),
      job("c", 0, "13:00", "14:00"),
    ]);
    expect(ids).toEqual(new Set(["a", "b"]));
  });

  it("returns an empty set when a single booking exists per day", () => {
    expect(conflictedIdsForTech([job("a", 0, "09:00", "10:00")]).size).toBe(0);
  });
});

describe("wouldDropConflict", () => {
  const dragged: BookingWindow = {
    booking_id: "drag",
    day_index: 0,
    crmstarttime: "09:00",
    crmendtime: "10:00",
  };

  it("returns false for a no-op drop (same tech, same day)", () => {
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 0,
      crmstarttime: "09:00",
      crmendtime: "10:00",
    };
    expect(wouldDropConflict(dragged, "t1", "t1", 0, [dragged, target])).toBe(false);
  });

  it("detects a conflict when moving to a different technician's overlapping slot", () => {
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 0,
      crmstarttime: "09:30",
      crmendtime: "10:30",
    };
    expect(wouldDropConflict(dragged, "t1", "t2", 0, [target])).toBe(true);
  });

  it("detects a conflict when moving to a different day with an overlapping booking", () => {
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 2,
      crmstarttime: "09:30",
      crmendtime: "10:30",
    };
    expect(wouldDropConflict(dragged, "t1", "t1", 2, [dragged, target])).toBe(true);
  });

  it("does not conflict with the target tech's bookings on other days", () => {
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 1,
      crmstarttime: "09:00",
      crmendtime: "10:00",
    };
    expect(wouldDropConflict(dragged, "t1", "t2", 0, [target])).toBe(false);
  });

  it("treats adjacent (touching) windows as non-conflicting", () => {
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 0,
      crmstarttime: "10:00",
      crmendtime: "11:00",
    };
    expect(wouldDropConflict(dragged, "t1", "t2", 0, [target])).toBe(false);
  });

  it("ignores the dragged booking itself in the target list", () => {
    expect(wouldDropConflict(dragged, "t1", "t2", 0, [dragged])).toBe(false);
  });

  it("returns false when the dragged booking has no parseable start time", () => {
    const noStart: BookingWindow = { ...dragged, crmstarttime: null };
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 0,
      crmstarttime: "09:00",
      crmendtime: "10:00",
    };
    expect(wouldDropConflict(noStart, "t1", "t2", 0, [target])).toBe(false);
  });

  it("flags overlap caused by a missing end on the dragged booking", () => {
    const noEnd: BookingWindow = { ...dragged, crmendtime: null };
    const target: BookingWindow = {
      booking_id: "other",
      day_index: 0,
      crmstarttime: "09:00",
      crmendtime: "10:00",
    };
    expect(wouldDropConflict(noEnd, "t1", "t2", 0, [target])).toBe(true);
  });
});
