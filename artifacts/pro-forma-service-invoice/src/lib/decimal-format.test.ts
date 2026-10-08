import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDecimal } from "./decimal-format.ts";

test("formats decimal values consistently without losing precision", () => {
  const cases: [string | null | undefined, string][] = [
    ["0", "0.00"],
    ["1", "1.00"],
    ["3.5", "3.50"],
    ["12.3400", "12.34"],
    ["12.344", "12.34"],
    ["12.345", "12.35"],
    ["999.995", "1,000.00"],
    ["9007199254740993.995", "9,007,199,254,740,994.00"],
    ["-12.345", "-12.35"],
    ["-0.004", "0.00"],
    ["-0.005", "-0.01"],
    ["", "—"],
    [null, "—"],
    [undefined, "—"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(formatDecimal(input), expected, String(input));
  }
});

test("rejects malformed decimal values instead of displaying invented amounts", () => {
  for (const value of ["NaN", "Infinity", "1,000", "1e3", "12.3.4"]) {
    assert.throws(() => formatDecimal(value), /Invalid decimal value/);
  }
});
