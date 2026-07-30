import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTab, isTab, buildTabCaseSql, TABS } from "./classification.ts";

test("classifyTab buckets each known Machine classification", () => {
  assert.equal(classifyTab("Machine", "300SL"), "300SL");
  assert.equal(classifyTab("Machine", "600SL"), "600SL");
  assert.equal(classifyTab("Machine", "1000SL"), "1000/2000SL");
  assert.equal(classifyTab("Machine", "2000SL"), "1000/2000SL");
  assert.equal(classifyTab("Machine", "IT406"), "MetalsImpact");
  assert.equal(classifyTab("Machine", "IT542"), "MetalsImpact");
});

test("classifyTab buckets the MFI tab from Machine class 2 only", () => {
  assert.equal(classifyTab("Machine", "MP1200"), "MFI");
  assert.equal(classifyTab("Machine", "MP1200MAN"), "MFI");
  assert.equal(classifyTab("Machine", "MP1200MWLD"), "MFI");
  assert.equal(classifyTab("Machine", "MP1500"), "MFI");
  // class 2 must be 'Machine' — the 'MFI' class is not accepted.
  assert.equal(classifyTab("MFI", "MP1500"), null);
  assert.equal(classifyTab("MFI", "MP1200"), null);
  // The MP1200ETO variant is excluded.
  assert.equal(classifyTab("Machine", "MP1200ETO"), null);
});

test("classifyTab returns null when class 2 is not 'Machine'", () => {
  assert.equal(classifyTab("Spare", "300SL"), null);
  assert.equal(classifyTab("Service", "IT406"), null);
  assert.equal(classifyTab("", "300SL"), null);
  // Case-sensitive: only the exact value 'Machine' qualifies.
  assert.equal(classifyTab("machine", "300SL"), null);
  assert.equal(classifyTab("MACHINE", "300SL"), null);
});

test("classifyTab returns null for a Machine with an unmapped class 3", () => {
  assert.equal(classifyTab("Machine", "9000SL"), null);
  assert.equal(classifyTab("Machine", "IT999"), null);
  assert.equal(classifyTab("Machine", ""), null);
  // Case-sensitive on class 3 too.
  assert.equal(classifyTab("Machine", "it406"), null);
});

test("classifyTab returns null for missing/empty inputs", () => {
  assert.equal(classifyTab(null, null), null);
  assert.equal(classifyTab(undefined, undefined), null);
  assert.equal(classifyTab("Machine", null), null);
  assert.equal(classifyTab("Machine", undefined), null);
  assert.equal(classifyTab(null, "300SL"), null);
  assert.equal(classifyTab(undefined, "300SL"), null);
});

test("every value returned by classifyTab is a known tab", () => {
  for (const [c2, c3] of [
    ["Machine", "300SL"],
    ["Machine", "600SL"],
    ["Machine", "1000SL"],
    ["Machine", "2000SL"],
    ["Machine", "IT406"],
    ["Machine", "IT542"],
  ] as const) {
    const tab = classifyTab(c2, c3);
    assert.ok(tab !== null && isTab(tab));
  }
});

test("isTab recognizes only the known tabs", () => {
  for (const t of TABS) assert.equal(isTab(t), true);
  assert.equal(isTab("1000SL"), false);
  assert.equal(isTab("Machine"), false);
  assert.equal(isTab(""), false);
  assert.equal(isTab(null), false);
  assert.equal(isTab(undefined), false);
  assert.equal(isTab(42), false);
});

test("buildTabCaseSql mirrors classifyTab and quotes columns/values", () => {
  const sql = buildTabCaseSql("r.salesclassification2", "r.salesclassification3");
  // Wraps in a CASE ... END with a NULL fallback.
  assert.match(sql, /CASE/);
  assert.match(sql, /ELSE NULL/);
  assert.match(sql, /END/);
  // Every tab and class-3 value appears in the generated SQL.
  for (const tab of TABS) assert.ok(sql.includes(`THEN '${tab}'`));
  for (const c3 of [
    "300SL",
    "600SL",
    "1000SL",
    "2000SL",
    "IT406",
    "IT542",
    "MP1200",
    "MP1200MAN",
    "MP1200MWLD",
    "MP1500",
  ]) {
    assert.ok(sql.includes(`'${c3}'`));
  }
  // Uses the provided column references and the 'Machine' class-2 guard.
  assert.ok(sql.includes("r.salesclassification2 IN ('Machine')"));
  assert.ok(sql.includes("r.salesclassification3 IN"));
});
