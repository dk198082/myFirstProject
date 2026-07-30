import { test } from "node:test";
import assert from "node:assert/strict";
import { parseISO, format } from "date-fns";
import { addBusinessDays, subBusinessDays, computeSlotDates } from "./business-days.ts";

const ymd = (date: Date) => format(date, "yyyy-MM-dd");

// Reference weekdays used below (year 2026):
//   2026-06-01 Monday   2026-06-05 Friday
//   2026-06-08 Monday   2026-06-12 Friday
//   2026-05-29 Friday

test("addBusinessDays adds within the same week", () => {
  assert.equal(ymd(addBusinessDays(parseISO("2026-06-01"), 1)), "2026-06-02");
  assert.equal(ymd(addBusinessDays(parseISO("2026-06-01"), 3)), "2026-06-04");
});

test("addBusinessDays skips weekends", () => {
  // Friday + 1 business day lands on Monday, not Saturday.
  assert.equal(ymd(addBusinessDays(parseISO("2026-06-05"), 1)), "2026-06-08");
  // Monday + 5 business days lands on the following Monday.
  assert.equal(ymd(addBusinessDays(parseISO("2026-06-01"), 5)), "2026-06-08");
  // Friday + 5 business days lands on the following Friday.
  assert.equal(ymd(addBusinessDays(parseISO("2026-06-05"), 5)), "2026-06-12");
});

test("addBusinessDays with zero days returns the same date", () => {
  assert.equal(ymd(addBusinessDays(parseISO("2026-06-01"), 0)), "2026-06-01");
});

test("subBusinessDays subtracts within the same week", () => {
  assert.equal(ymd(subBusinessDays(parseISO("2026-06-05"), 1)), "2026-06-04");
});

test("subBusinessDays skips weekends", () => {
  // Monday - 1 business day lands on the previous Friday.
  assert.equal(ymd(subBusinessDays(parseISO("2026-06-08"), 1)), "2026-06-05");
  assert.equal(ymd(subBusinessDays(parseISO("2026-06-01"), 1)), "2026-05-29");
  // Friday - 5 business days lands on the previous Friday.
  assert.equal(ymd(subBusinessDays(parseISO("2026-06-12"), 5)), "2026-06-05");
});

test("subBusinessDays with zero days returns the same date", () => {
  assert.equal(ymd(subBusinessDays(parseISO("2026-06-08"), 0)), "2026-06-08");
});

test("addBusinessDays / subBusinessDays do not mutate the input date", () => {
  const input = parseISO("2026-06-01");
  addBusinessDays(input, 5);
  subBusinessDays(input, 5);
  assert.equal(ymd(input), "2026-06-01");
});

test("computeSlotDates chains pick -> assy -> pack windows", () => {
  // productionStart Monday, pickDays=2, assyDays=3, packDays=1
  const result = computeSlotDates("2026-06-01", 3, 1, 2);
  assert.deepEqual(result, {
    pickStart: "2026-06-01", // Mon
    pickEnd: "2026-06-03", // Wed (Mon + 2 business days)
    assyStart: "2026-06-03", // Assy Start = Pick End
    assyEnd: "2026-06-08", // Wed + 3 business days skips the weekend -> Mon
    packStart: "2026-06-08", // Pack Start = Assy End
    packEnd: "2026-06-09", // Mon + 1 business day -> Tue
    ship: "2026-06-09", // Ship Date = Pack End
  });
});

test("computeSlotDates: Pack Start = Assy End and Pack End = Ship Date", () => {
  const result = computeSlotDates("2026-06-05", 4, 3, 2);
  assert.equal(result.packStart, result.assyEnd);
  assert.equal(result.packEnd, result.ship);
});

test("computeSlotDates skips weekends across windows", () => {
  // Friday production start, single-day pick crosses the weekend.
  const result = computeSlotDates("2026-06-05", 1, 1, 1);
  assert.equal(result.pickStart, "2026-06-05"); // Fri
  assert.equal(result.pickEnd, "2026-06-08"); // Mon (skips weekend)
  assert.equal(result.assyStart, "2026-06-08");
  assert.equal(result.assyEnd, "2026-06-09"); // Tue
  assert.equal(result.packStart, "2026-06-09");
  assert.equal(result.packEnd, "2026-06-10"); // Wed
  assert.equal(result.ship, "2026-06-10");
});

test("computeSlotDates with zero durations collapses every window to the start", () => {
  const result = computeSlotDates("2026-06-01", 0, 0, 0);
  for (const value of Object.values(result)) {
    assert.equal(value, "2026-06-01");
  }
});

const emptySchedule = {
  pickStart: null,
  pickEnd: null,
  assyStart: null,
  assyEnd: null,
  packStart: null,
  packEnd: null,
  ship: null,
};

test("computeSlotDates returns an empty schedule for null/undefined/empty input", () => {
  assert.deepEqual(computeSlotDates(null, 1, 1, 1), emptySchedule);
  assert.deepEqual(computeSlotDates(undefined, 1, 1, 1), emptySchedule);
  assert.deepEqual(computeSlotDates("", 1, 1, 1), emptySchedule);
});

test("computeSlotDates returns an empty schedule for an unparseable date", () => {
  assert.deepEqual(computeSlotDates("not-a-date", 1, 1, 1), emptySchedule);
  assert.deepEqual(computeSlotDates("2026-13-99", 1, 1, 1), emptySchedule);
});
