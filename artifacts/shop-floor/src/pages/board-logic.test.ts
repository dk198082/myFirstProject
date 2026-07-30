import { describe, test, expect, vi, afterEach } from "vitest";
import type { BoardOrder } from "@workspace/api-client-react";
import {
  GROUP_ORDER, FILTER_GROUPS, UNALLOCATED_GROUPS,
  buildBoardData, sortDayOrders, getOrdersForDay, fmtLongDate,
} from "./board-logic";

function order(overrides: Partial<BoardOrder>): BoardOrder {
  return {
    prodid: "P001",
    itemname: "Widget",
    productiongroupid: "Assy01",
    productionstatus: 4,
    resourcecode: "RES-A",
    schedulefromdate: "2026-07-13",
    scheduledenddate: "2026-07-17",
    totalscheduledtime: 8,
    ...overrides,
  } as BoardOrder;
}

const PALETTE_SIZE = 10;
const build = (orders: BoardOrder[], q = "", statuses: number[] = []) =>
  buildBoardData(orders, q, statuses, PALETTE_SIZE);

describe("group constants", () => {
  test("retired Assy08 is not a board group or filter pill", () => {
    expect(GROUP_ORDER).not.toContain("Assy08");
    expect(FILTER_GROUPS).not.toContain("Assy08");
  });

  test("there are 16 pill groups; GenAssy/GenInstr/GenElec/Elec Setup roll up into Unallocated", () => {
    expect(FILTER_GROUPS).toHaveLength(16);
    expect(FILTER_GROUPS).not.toContain("GenAssy");
    expect(FILTER_GROUPS).not.toContain("GenInstr");
    expect(FILTER_GROUPS).not.toContain("GenElec");
    expect(FILTER_GROUPS).not.toContain("Elec Setup");
    expect([...UNALLOCATED_GROUPS]).toEqual(["GenAssy", "GenInstr", "GenElec", "Elec Setup"]);
  });

  test("Paint is the last filter pill, after Elec01-03", () => {
    expect(FILTER_GROUPS[12]).toBe("Elec01");
    expect(FILTER_GROUPS[13]).toBe("Elec02");
    expect(FILTER_GROUPS[14]).toBe("Elec03");
    expect(FILTER_GROUPS[15]).toBe("Paint");
  });
});

describe("buildBoardData: order-to-group assignment", () => {
  test("returns empty structures when data has not loaded", () => {
    const d = buildBoardData(undefined, "", [], PALETTE_SIZE);
    expect(d.groupedOrders).toEqual({});
    expect(d.unscheduledOrders).toEqual([]);
    expect(d.unallocatedOrders).toEqual([]);
  });

  test("groups scheduled orders into a flat array per production group", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1" }),
      order({ prodid: "P2", productiongroupid: "Assy01", resourcecode: "R2" }),
      order({ prodid: "P3", productiongroupid: "Paint",  resourcecode: "R1" }),
    ]);
    expect(d.groupedOrders["Assy01"].map(o => o.prodid).sort()).toEqual(["P1", "P2"]);
    expect(d.groupedOrders["Paint"].map(o => o.prodid)).toEqual(["P3"]);
  });

  test("orders within a group are sorted by scheduledenddate ascending, nulls last", () => {
    const d = build([
      order({ prodid: "P3", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: "2026-07-20" }),
      order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: "2026-07-10" }),
      order({ prodid: "P4", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: null as unknown as string }),
      order({ prodid: "P2", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: "2026-07-15" }),
    ]);
    expect(d.groupedOrders["Assy01"].map(o => o.prodid)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  test("drops orders whose group is not an allowed board group (e.g. Assy08)", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "Assy08" }),
      order({ prodid: "P2", productiongroupid: "SomethingElse" }),
      order({ prodid: "P3", productiongroupid: "Assy02" }),
    ]);
    expect(Object.keys(d.groupedOrders)).toEqual(["Assy02"]);
    expect(d.unallocatedOrders).toEqual([]);
    expect(d.unscheduledOrders).toEqual([]);
  });

  test("orders without a resource are included in the flat group list", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "Inst01", resourcecode: null as unknown as string }),
    ]);
    expect(d.groupedOrders["Inst01"].map(o => o.prodid)).toEqual(["P1"]);
    expect(d.unscheduledOrders.map(o => o.prodid)).toEqual(["P1"]);
  });

  test("status and search filters exclude non-matching orders from the board", () => {
    const orders = [
      order({ prodid: "P1", productionstatus: 4, itemname: "Pump" }),
      order({ prodid: "P2", productionstatus: 3, itemname: "Valve" }),
    ];
    const byStatus = build(orders, "", [4]);
    expect(byStatus.groupedOrders["Assy01"].map(o => o.prodid)).toEqual(["P1"]);

    const bySearch = build(orders, "valve", []);
    expect(bySearch.groupedOrders["Assy01"].map(o => o.prodid)).toEqual(["P2"]);
  });

  test("duplicate prodids within a group produce only one row per production order", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: "2026-07-15" }),
      order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: "2026-07-15" }),
      order({ prodid: "P2", productiongroupid: "Assy01", resourcecode: "R2", scheduledenddate: "2026-07-17" }),
    ]);
    expect(d.groupedOrders["Assy01"].map(o => o.prodid)).toEqual(["P1", "P2"]);
  });

  test("when a prodid appears as both scheduled and unscheduled, the scheduled (resource-assigned) row wins", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1", scheduledenddate: "2026-07-17" }),
      order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: null as unknown as string, scheduledenddate: "2026-07-17" }),
    ]);
    expect(d.groupedOrders["Assy01"]).toHaveLength(1);
    expect(d.groupedOrders["Assy01"][0].resourcecode).toBe("R1");
  });

  test("resource colors are assigned stably by sorted resource code", () => {
    const d = build([
      order({ prodid: "P1", resourcecode: "ZZZ" }),
      order({ prodid: "P2", resourcecode: "AAA" }),
    ]);
    expect(d.resourceColorMap["AAA"]).toBe(0);
    expect(d.resourceColorMap["ZZZ"]).toBe(1);
  });
});

describe("buildBoardData: merged Unallocated section", () => {
  test("all four unallocated groups merge into unallocatedOrders, not group sections", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "GenAssy",   resourcecode: "R1" }),
      order({ prodid: "P2", productiongroupid: "GenInstr",  resourcecode: null as unknown as string }),
      order({ prodid: "P3", productiongroupid: "GenElec",   resourcecode: "R2" }),
      order({ prodid: "P4", productiongroupid: "Elec Setup", resourcecode: null as unknown as string }),
      order({ prodid: "P5", productiongroupid: "Assy01" }),
    ]);
    expect(d.unallocatedOrders.map(o => o.prodid).sort()).toEqual(["P1", "P2", "P3", "P4"]);
    // None of the unallocated groups render as board sections
    expect(d.groupedOrders["GenInstr"]).toBeUndefined();
    expect(d.groupedOrders["GenElec"]).toBeUndefined();
    expect(d.groupedOrders["Elec Setup"]).toBeUndefined();
  });

  test("unallocated orders are deduped by prodid and sorted by start date (missing dates last)", () => {
    const d = build([
      order({ prodid: "U2", productiongroupid: "GenAssy",   schedulefromdate: "2026-07-20" }),
      order({ prodid: "U1", productiongroupid: "GenInstr",  schedulefromdate: "2026-07-10" }),
      order({ prodid: "U2", productiongroupid: "GenAssy",   schedulefromdate: "2026-07-20" }),
      order({ prodid: "U3", productiongroupid: "GenElec",   schedulefromdate: null as unknown as string }),
      order({ prodid: "U4", productiongroupid: "Elec Setup", schedulefromdate: "2026-07-15" }),
    ]);
    expect(d.unallocatedOrders.map(o => o.prodid)).toEqual(["U1", "U4", "U2", "U3"]);
  });

  test("unscheduled unallocated-group orders do NOT create an Unassigned row", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "GenAssy",   resourcecode: null as unknown as string }),
      order({ prodid: "P2", productiongroupid: "GenElec",   resourcecode: null as unknown as string }),
      order({ prodid: "P3", productiongroupid: "Elec Setup", resourcecode: null as unknown as string }),
    ]);
    expect(d.groupedOrders).toEqual({});
    expect(d.unallocatedOrders.map(o => o.prodid).sort()).toEqual(["P1", "P2", "P3"]);
  });

  test("Elec01/Elec02/Elec03 orders go into group sections, not Unallocated", () => {
    const d = build([
      order({ prodid: "E1", productiongroupid: "Elec01", resourcecode: "R1" }),
      order({ prodid: "E2", productiongroupid: "Elec02", resourcecode: "R2" }),
      order({ prodid: "E3", productiongroupid: "Elec03", resourcecode: null as unknown as string }),
    ]);
    expect(d.groupedOrders["Elec01"].map(o => o.prodid)).toEqual(["E1"]);
    expect(d.groupedOrders["Elec02"].map(o => o.prodid)).toEqual(["E2"]);
    expect(d.groupedOrders["Elec03"].map(o => o.prodid)).toEqual(["E3"]);
    expect(d.unallocatedOrders).toEqual([]);
  });
});

describe("buildBoardData: unknown group warning", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  test("console.warn is suppressed in the test environment (MODE=test)", () => {
    // The warning block in board-logic.ts is gated on
    // import.meta.env.MODE !== "test". Vitest sets MODE to "test", so the
    // warn path is never reached. This test documents that contract and
    // protects against accidental noise being introduced in known-group paths.
    const warnSpy = vi.spyOn(console, "warn");
    build([
      order({ prodid: "P1", productiongroupid: "Assy08" }),
      order({ prodid: "P2", productiongroupid: "SomethingNew" }),
    ]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("unknown-group orders are still dropped even though no warning fires in tests", () => {
    const d = build([
      order({ prodid: "P1", productiongroupid: "Assy11" }),
      order({ prodid: "P2", productiongroupid: "Assy01" }),
    ]);
    expect(Object.keys(d.groupedOrders)).toEqual(["Assy01"]);
    expect(d.unallocatedOrders).toEqual([]);
  });
});

describe("buildBoardData: board search filtering", () => {
  const base = [
    order({ prodid: "P001", itemname: "Pump Assembly",  productiongroupid: "Assy01", resourcecode: "R1" }),
    order({ prodid: "P002", itemname: "Valve Block",    productiongroupid: "Assy02", resourcecode: "R2" }),
    order({ prodid: "P003", itemname: "MOTOR DRIVE",    productiongroupid: "Inst01", resourcecode: "R3" }),
    order({ prodid: "P004", itemname: "pump housing",   productiongroupid: "Assy01", resourcecode: "R4" }),
  ];

  test("search matches prodid case-insensitively", () => {
    const d = build(base, "p001", []);
    const ids = Object.values(d.groupedOrders).flat().map(o => o.prodid);
    expect(ids).toEqual(["P001"]);
  });

  test("search matches prodid with mixed case", () => {
    const d = build(base, "P001", []);
    const ids = Object.values(d.groupedOrders).flat().map(o => o.prodid);
    expect(ids).toEqual(["P001"]);
  });

  test("search matches itemname case-insensitively", () => {
    const d = build(base, "VALVE", []);
    const ids = Object.values(d.groupedOrders).flat().map(o => o.prodid);
    expect(ids).toEqual(["P002"]);
  });

  test("search matches itemname with lowercase term against upper-case name", () => {
    const d = build(base, "motor", []);
    const ids = Object.values(d.groupedOrders).flat().map(o => o.prodid);
    expect(ids).toEqual(["P003"]);
  });

  test("search matches partial substring in itemname", () => {
    const d = build(base, "pump", []);
    const ids = Object.values(d.groupedOrders).flat().map(o => o.prodid).sort();
    expect(ids).toEqual(["P001", "P004"]);
  });

  test("non-matching orders are excluded from the group's flat list", () => {
    const d = build(base, "valve", []);
    expect(d.groupedOrders["Assy01"]).toBeUndefined();
    expect(d.groupedOrders["Inst01"]).toBeUndefined();
    expect(d.groupedOrders["Assy02"].map(o => o.prodid)).toEqual(["P002"]);
  });

  test("a group with zero matching orders does not appear in groupedOrders", () => {
    const d = build(base, "pump", []);
    expect(d.groupedOrders["Assy01"]).toBeDefined();
    expect(d.groupedOrders["Assy02"]).toBeUndefined();
    expect(d.groupedOrders["Inst01"]).toBeUndefined();
  });

  test("clearing search (empty string) restores all orders", () => {
    const searched = build(base, "pump", []);
    const cleared  = build(base, "", []);
    const searchedIds = Object.values(searched.groupedOrders).flat().map(o => o.prodid).sort();
    const clearedIds  = Object.values(cleared.groupedOrders).flat().map(o => o.prodid).sort();
    expect(searchedIds).not.toEqual(clearedIds);
    expect(clearedIds).toEqual(["P001", "P002", "P003", "P004"]);
  });

  test("search and status filter applied together narrow correctly", () => {
    const orders = [
      order({ prodid: "A1", itemname: "Pump", productionstatus: 4, resourcecode: "R1" }),
      order({ prodid: "A2", itemname: "Pump", productionstatus: 3, resourcecode: "R1" }),
      order({ prodid: "B1", itemname: "Valve", productionstatus: 4, resourcecode: "R1" }),
    ];
    // search="pump" + status=[4] should match only A1
    const d = build(orders, "pump", [4]);
    const ids = Object.values(d.groupedOrders).flat().map(o => o.prodid);
    expect(ids).toEqual(["A1"]);
  });

  test("search + group-pill filter: matching orders in a pill-excluded group are hidden", () => {
    // buildBoardData returns groupedOrders keyed by group; the pill filter in
    // dashboard.tsx limits which keys are rendered. We verify both dimensions:
    // search narrows within each group and the pill set controls which groups show.
    const orders = [
      order({ prodid: "A1", itemname: "Widget", productiongroupid: "Assy01", resourcecode: "R1" }),
      order({ prodid: "B1", itemname: "Widget", productiongroupid: "Assy02", resourcecode: "R2" }),
      order({ prodid: "C1", itemname: "Other",  productiongroupid: "Assy01", resourcecode: "R3" }),
    ];
    const d = build(orders, "widget", []);
    // Both Assy01 and Assy02 match the search term
    expect(Object.keys(d.groupedOrders)).toContain("Assy01");
    expect(Object.keys(d.groupedOrders)).toContain("Assy02");
    // Simulate pill filter selecting only Assy01 (as dashboard.tsx does via visibleGroups)
    const pillGroups = new Set(["Assy01"]);
    const visible = Object.fromEntries(
      Object.entries(d.groupedOrders).filter(([g]) => pillGroups.has(g)),
    );
    const ids = Object.values(visible).flat().map(o => o.prodid);
    expect(ids).toEqual(["A1"]);
    expect(ids).not.toContain("B1");
  });

  test("unallocated orders filtered by search (prodid match)", () => {
    const orders = [
      order({ prodid: "U1", itemname: "Pump",  productiongroupid: "GenAssy" }),
      order({ prodid: "U2", itemname: "Valve", productiongroupid: "GenInstr" }),
      order({ prodid: "U3", itemname: "Motor", productiongroupid: "GenElec" }),
    ];
    const d = build(orders, "U1", []);
    expect(d.unallocatedOrders.map(o => o.prodid)).toEqual(["U1"]);
  });

  test("unallocated orders filtered by search (itemname match)", () => {
    const orders = [
      order({ prodid: "U1", itemname: "Pump Housing", productiongroupid: "GenAssy" }),
      order({ prodid: "U2", itemname: "Valve Block",  productiongroupid: "GenInstr" }),
    ];
    const d = build(orders, "valve", []);
    expect(d.unallocatedOrders.map(o => o.prodid)).toEqual(["U2"]);
  });

  test("search with no matches returns empty groupedOrders and unallocatedOrders", () => {
    const d = build(base, "zzz-nomatch", []);
    expect(d.groupedOrders).toEqual({});
    expect(d.unallocatedOrders).toEqual([]);
  });
});

describe("getOrdersForDay: day bucketing", () => {
  const weekStart = new Date(2026, 6, 13); // Mon Jul 13 2026
  const weekEnd   = new Date(2026, 6, 17); // Fri Jul 17 2026
  const forDay = (orders: BoardOrder[], day: Date) =>
    getOrdersForDay(orders, day, weekStart, weekEnd);

  test("an order appears in every day its start-end window overlaps", () => {
    const o = order({ schedulefromdate: "2026-07-14", scheduledenddate: "2026-07-16" });
    expect(forDay([o], new Date(2026, 6, 13))).toHaveLength(0);
    expect(forDay([o], new Date(2026, 6, 14))).toHaveLength(1);
    expect(forDay([o], new Date(2026, 6, 15))).toHaveLength(1);
    expect(forDay([o], new Date(2026, 6, 16))).toHaveLength(1);
    expect(forDay([o], new Date(2026, 6, 17))).toHaveLength(0);
  });

  test("orders entirely outside the visible window are dropped", () => {
    const before = order({ schedulefromdate: "2026-07-01", scheduledenddate: "2026-07-10" });
    const after  = order({ schedulefromdate: "2026-07-20", scheduledenddate: "2026-07-24" });
    expect(forDay([before, after], new Date(2026, 6, 15))).toHaveLength(0);
  });

  test("an order with no end date occupies only its start day", () => {
    const o = order({ schedulefromdate: "2026-07-15", scheduledenddate: null as unknown as string });
    expect(forDay([o], new Date(2026, 6, 15))).toHaveLength(1);
    expect(forDay([o], new Date(2026, 6, 16))).toHaveLength(0);
  });

  test("an order with no start date never appears", () => {
    const o = order({ schedulefromdate: null as unknown as string });
    expect(forDay([o], new Date(2026, 6, 15))).toHaveLength(0);
  });

  test("timestamps are truncated to their date part", () => {
    const o = order({
      schedulefromdate: "2026-07-15T23:59:00Z",
      scheduledenddate: "2026-07-15T00:00:00Z",
    });
    expect(forDay([o], new Date(2026, 6, 15))).toHaveLength(1);
  });
});

describe("sortDayOrders", () => {
  const orders = [
    order({ prodid: "P3", totalscheduledtime: 5 }),
    order({ prodid: "P1", totalscheduledtime: 10 }),
    order({ prodid: "P2", totalscheduledtime: 10 }),
    order({ prodid: "P4", totalscheduledtime: null as unknown as number }),
  ];

  test("default sorts by production order id", () => {
    expect(sortDayOrders(orders, "prodid").map(o => o.prodid)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  test("time-desc sorts longest first, ties broken by prodid; null time treated as 0", () => {
    expect(sortDayOrders(orders, "time-desc").map(o => o.prodid)).toEqual(["P1", "P2", "P3", "P4"]);
  });

  test("time-asc sorts shortest first", () => {
    expect(sortDayOrders(orders, "time-asc").map(o => o.prodid)).toEqual(["P4", "P3", "P1", "P2"]);
  });

  test("does not mutate the input array", () => {
    const input = [...orders];
    sortDayOrders(input, "time-desc");
    expect(input.map(o => o.prodid)).toEqual(["P3", "P1", "P2", "P4"]);
  });
});

// Regression: D365 exports dates as UTC-midnight timestamps. Formatting must
// keep the calendar date regardless of local timezone (new Date() would shift
// it one day back in timezones behind UTC).
describe("fmtLongDate", () => {
  test("UTC-midnight timestamp keeps its calendar date", () => {
    expect(fmtLongDate("2026-07-17T00:00:00Z")).toBe("Jul 17, 2026");
  });

  test("bare date string formats unchanged", () => {
    expect(fmtLongDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  test("null/undefined return N/A", () => {
    expect(fmtLongDate(null)).toBe("N/A");
    expect(fmtLongDate(undefined)).toBe("N/A");
  });
});
