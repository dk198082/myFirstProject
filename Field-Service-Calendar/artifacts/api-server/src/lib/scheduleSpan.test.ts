import { describe, expect, it } from "vitest";
import { bookingDaySpan } from "./scheduleSpan.js";

const rangeStart = new Date("2026-09-28T00:00:00.000Z");

describe("bookingDaySpan", () => {
  it("skips the interior weekend for a multi-week weekday booking", () => {
    const span = bookingDaySpan(
      "2026-09-28T14:00:00.000Z",
      "2026-10-07T23:00:00.000Z",
      rangeStart,
      14,
    );

    expect(span).toEqual({
      dayIndexes: [0, 1, 2, 3, 4, 7, 8, 9],
      dayNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
      totalDayCount: 8,
      spanStartDay: 0,
      spanEndDay: 9,
    });
  });

  it("keeps continuation weekdays when the booking starts before the view", () => {
    const span = bookingDaySpan(
      "2026-09-28T14:00:00.000Z",
      "2026-10-07T23:00:00.000Z",
      new Date("2026-10-01T00:00:00.000Z"),
      31,
    );

    expect(span).toEqual({
      dayIndexes: [0, 1, 4, 5, 6],
      dayNumbers: [4, 5, 6, 7, 8],
      totalDayCount: 8,
      spanStartDay: 0,
      spanEndDay: 6,
    });
  });

  it("keeps a weekend date when the booking explicitly starts there", () => {
    const span = bookingDaySpan(
      "2026-10-03T14:00:00.000Z",
      "2026-10-05T23:00:00.000Z",
      rangeStart,
      14,
    );

    expect(span?.dayIndexes).toEqual([5, 7]);
    expect(span?.dayNumbers).toEqual([1, 2]);
    expect(span?.totalDayCount).toBe(2);
  });

  it("keeps a weekend date when the booking explicitly ends there", () => {
    const span = bookingDaySpan(
      "2026-10-02T14:00:00.000Z",
      "2026-10-04T18:00:00.000Z",
      rangeStart,
      14,
    );

    expect(span?.dayIndexes).toEqual([4, 6]);
    expect(span?.dayNumbers).toEqual([1, 2]);
    expect(span?.totalDayCount).toBe(2);
  });

  it("does not add a trailing day when a booking ends at midnight", () => {
    const span = bookingDaySpan(
      "2026-10-01T14:00:00.000Z",
      "2026-10-03T00:00:00.000Z",
      rangeStart,
      14,
    );

    expect(span?.dayIndexes).toEqual([3, 4]);
    expect(span?.dayNumbers).toEqual([1, 2]);
    expect(span?.totalDayCount).toBe(2);
  });

  it("preserves whole-booking numbering in a later weekly view", () => {
    const span = bookingDaySpan(
      "2026-09-28T14:00:00.000Z",
      "2026-10-07T23:00:00.000Z",
      new Date("2026-10-05T00:00:00.000Z"),
      7,
    );

    expect(span).toEqual({
      dayIndexes: [0, 1, 2],
      dayNumbers: [6, 7, 8],
      totalDayCount: 8,
      spanStartDay: 0,
      spanEndDay: 2,
    });
  });
});