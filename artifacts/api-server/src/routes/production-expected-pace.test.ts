import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { expectedConsumedHours } from "../lib/expectedPace.ts";

// All "now" values are UTC instants; the implementation converts to
// America/New_York (EDT = UTC-4 in July) for the plant clock.
// 2026-07-21 is a Tuesday.

describe("expectedConsumedHours", () => {
  test("null when total is missing, zero, or negative", () => {
    assert.equal(expectedConsumedHours(null, "2026-07-20", "2026-07-24"), null);
    assert.equal(expectedConsumedHours(0, "2026-07-20", "2026-07-24"), null);
    assert.equal(expectedConsumedHours(-5, "2026-07-20", "2026-07-24"), null);
  });

  test("null when window dates are missing or inverted", () => {
    assert.equal(expectedConsumedHours(40, null, "2026-07-24"), null);
    assert.equal(expectedConsumedHours(40, "2026-07-20", null), null);
    assert.equal(expectedConsumedHours(40, "2026-07-24", "2026-07-20"), null);
  });

  test("null when the window contains no weekdays", () => {
    // Sat 2026-07-25 → Sun 2026-07-26
    assert.equal(expectedConsumedHours(40, "2026-07-25", "2026-07-26"), null);
  });

  test("0 before the window starts", () => {
    const now = new Date("2026-07-10T16:00:00Z"); // Fri, before window
    assert.equal(expectedConsumedHours(40, "2026-07-20", "2026-07-24", now), 0);
  });

  test("full total after the window ends", () => {
    const now = new Date("2026-07-28T16:00:00Z"); // Tue, after window
    assert.equal(expectedConsumedHours(40, "2026-07-20", "2026-07-24", now), 40);
  });

  test("mid-window: full days elapsed, before today's workday starts", () => {
    // Window Mon 7/20 → Fri 7/24 (5 workdays, 40h → 8h/day).
    // Now = Tue 7/21 07:00 EDT (11:00 UTC): 1 full day (Mon) elapsed, today 0%.
    const now = new Date("2026-07-21T11:00:00Z");
    assert.equal(expectedConsumedHours(40, "2026-07-20", "2026-07-24", now), 8);
  });

  test("mid-window: today counts proportionally within 8:00–16:00", () => {
    // Now = Tue 7/21 12:00 EDT (16:00 UTC): Mon full + Tue half-workday = 1.5/5.
    const now = new Date("2026-07-21T16:00:00Z");
    assert.equal(expectedConsumedHours(40, "2026-07-20", "2026-07-24", now), 12);
  });

  test("mid-window: after today's workday ends counts as a full day", () => {
    // Now = Tue 7/21 18:00 EDT (22:00 UTC): 2/5 days.
    const now = new Date("2026-07-21T22:00:00Z");
    assert.equal(expectedConsumedHours(40, "2026-07-20", "2026-07-24", now), 16);
  });

  test("weekends between elapsed days are not counted", () => {
    // Window Mon 7/13 → Fri 7/24 (10 workdays, 40h → 4h/day).
    // Now = Mon 7/20 07:00 EDT: 5 workdays elapsed (7/13–7/17), weekend skipped.
    const now = new Date("2026-07-20T11:00:00Z");
    assert.equal(expectedConsumedHours(40, "2026-07-13", "2026-07-24", now), 20);
  });

  test("weekend 'now' inside the window adds no partial day", () => {
    // Now = Sat 7/18 12:00 EDT: still 5 elapsed workdays of 10.
    const now = new Date("2026-07-18T16:00:00Z");
    assert.equal(expectedConsumedHours(40, "2026-07-13", "2026-07-24", now), 20);
  });

  test("accepts Date objects and timestamps for window bounds", () => {
    const now = new Date("2026-07-28T16:00:00Z");
    assert.equal(
      expectedConsumedHours(40, new Date("2026-07-20T00:00:00Z"), "2026-07-24T00:00:00.000Z", now),
      40,
    );
  });

  test("EST (winter) timezone conversion: 13:00 EST = 18:00 UTC counts half the workday", () => {
    // Window Mon 2026-01-12 → Fri 2026-01-16 (5 workdays, 40h → 8h/day).
    // Now = Tue 2026-01-13 12:00 EST (17:00 UTC): Mon full + Tue half = 1.5/5.
    const now = new Date("2026-01-13T17:00:00Z");
    assert.equal(expectedConsumedHours(40, "2026-01-12", "2026-01-16", now), 12);
  });

  test("late-evening UTC still maps to the same plant day (no day rollover)", () => {
    // Tue 2026-07-21 23:30 UTC = Tue 19:30 EDT — still Tuesday at the plant,
    // after the workday: 2 full days of 5.
    const now = new Date("2026-07-21T23:30:00Z");
    assert.equal(expectedConsumedHours(40, "2026-07-20", "2026-07-24", now), 16);
  });

  test("Date window bounds with non-midnight times do not shift the day", () => {
    // Bounds carry a mid-day UTC time; date-only truncation keeps 7/20–7/24.
    const now = new Date("2026-07-28T16:00:00Z");
    assert.equal(
      expectedConsumedHours(
        40,
        new Date("2026-07-20T14:30:00Z"),
        new Date("2026-07-24T09:15:00Z"),
        now,
      ),
      40,
    );
  });

  test("string numeric total (PG numeric) is handled", () => {
    const now = new Date("2026-07-28T16:00:00Z");
    assert.equal(
      expectedConsumedHours(Number("23.800000"), "2026-07-20", "2026-07-24", now),
      23.8,
    );
  });
});
