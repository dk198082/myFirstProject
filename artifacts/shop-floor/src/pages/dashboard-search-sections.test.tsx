import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import { useState } from "react";
import type { BoardOrder } from "@workspace/api-client-react";
import { buildBoardData, FILTER_GROUPS } from "./board-logic";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Minimal wrapper that replicates the sections derivation from dashboard.tsx
// (lines 1026–1051). It accepts a controlled order list so tests can swap it
// without remounting, and it exposes a search input exactly as the board does.
// ---------------------------------------------------------------------------

type SectionProps = {
  initialOrders: BoardOrder[];
  visibleGroups?: readonly string[];
};

// Allows the test to push a new order list into the wrapper after mount.
type Handle = { setOrders: (o: BoardOrder[]) => void };

function BoardSectionsHarness({
  initialOrders,
  visibleGroups = FILTER_GROUPS,
  handle,
}: SectionProps & { handle?: Handle }) {
  const [orders, setOrders] = useState<BoardOrder[]>(initialOrders);
  const [rawSearch, setRawSearch] = useState("");

  // Give the caller a way to drive `orders` from outside.
  if (handle) handle.setOrders = setOrders;

  const boardSearchTerm = rawSearch.trim().toLowerCase();

  // Replicate matchesBoardSearch from dashboard.tsx (no group-label map here;
  // groupLabel falls back to the raw group id, which is sufficient for these
  // tests).
  function matchesBoardSearch(o: BoardOrder, groupLabel: string): boolean {
    if (!boardSearchTerm) return true;
    const fields = [
      (o.prodid as string) ?? "",
      (o.itemname as string) ?? "",
      (o.resourcecode as string) ?? "",
      (o.resourcename as string) ?? "",
      groupLabel,
    ];
    return fields.some((f) => f.toLowerCase().includes(boardSearchTerm));
  }

  const { groupedOrders } = buildBoardData(orders, "", [], 10);

  // Replicate the groupSections / sections derivation from dashboard.tsx
  // (flat structure: productiongroupid → BoardOrder[]).
  const groupSections = (visibleGroups as string[]).map((g) => {
    const rawOrders = groupedOrders[g] ?? [];
    const groupLabel = g; // no groupNameMap in this harness — not needed
    const filteredOrders = boardSearchTerm
      ? rawOrders.filter((o) => matchesBoardSearch(o, groupLabel))
      : rawOrders;
    return { key: g, orders: filteredOrders };
  });

  const sections = [
    ...(boardSearchTerm
      ? groupSections.filter((s) => s.orders.length > 0)
      : groupSections),
    { key: "__unallocated__", orders: [] as BoardOrder[] },
  ];

  return (
    <div>
      <input
        data-testid="search-input"
        value={rawSearch}
        onChange={(e) => setRawSearch(e.target.value)}
        placeholder="Search…"
      />
      <ul>
        {sections.map((s) => (
          <li key={s.key} data-testid={`section-${s.key}`}>
            {s.key}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function order(overrides: Partial<BoardOrder>): BoardOrder {
  return {
    prodid: "P001",
    itemname: "Widget",
    productiongroupid: "Assy01",
    productionstatus: 4,
    resourcecode: "R1",
    schedulefromdate: "2026-07-13",
    scheduledenddate: "2026-07-17",
    totalscheduledtime: 8,
    ...overrides,
  } as BoardOrder;
}

function sectionKeys(): string[] {
  return screen.getAllByRole("listitem").map((li) => li.getAttribute("data-testid")!);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dashboard sections: search bar narrows visible groups", () => {
  test("without a search term, all visible groups and Unallocated are shown", () => {
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", productiongroupid: "Paint",  resourcecode: "R2" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Paint"]}
      />,
    );

    // Three groups + Unallocated
    expect(sectionKeys()).toContain("section-Assy01");
    expect(sectionKeys()).toContain("section-Assy02");
    expect(sectionKeys()).toContain("section-Paint");
    expect(sectionKeys()).toContain("section-__unallocated__");
  });

  test("typing a search term hides groups with no matching orders", () => {
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", itemname: "Pump Assembly",  productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", itemname: "Valve Block",    productiongroupid: "Assy02", resourcecode: "R2" }),
          order({ prodid: "P3", itemname: "Motor Drive",    productiongroupid: "Paint",  resourcecode: "R3" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Paint"]}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "valve" } });

    const keys = sectionKeys();
    expect(keys).not.toContain("section-Assy01");
    expect(keys).toContain("section-Assy02");
    expect(keys).not.toContain("section-Paint");
    // Unallocated is always present (appended after the filtered list)
    expect(keys).toContain("section-__unallocated__");
  });

  test("clearing the search term restores all visible groups", () => {
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", itemname: "Pump",  productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", itemname: "Valve", productiongroupid: "Assy02", resourcecode: "R2" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Paint"]}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "valve" } });
    expect(sectionKeys()).not.toContain("section-Assy01");

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "" } });

    const keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).toContain("section-Assy02");
    expect(keys).toContain("section-Paint");
  });
});

describe("dashboard sections: group visibility updates when orders move between groups", () => {
  test("moving the matching order out of a group removes that group from sections", () => {
    const handle: Handle = { setOrders: () => {} };

    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", itemname: "Pump", productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", itemname: "Gear", productiongroupid: "Assy02", resourcecode: "R2" }),
        ]}
        visibleGroups={["Assy01", "Assy02"]}
        handle={handle}
      />,
    );

    // Search for "pump" — only Assy01 should be visible.
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "pump" } });
    expect(sectionKeys()).toContain("section-Assy01");
    expect(sectionKeys()).not.toContain("section-Assy02");

    // Backend re-assigns P1 to Assy02 (group change mid-session).
    act(() => {
      handle.setOrders([
        order({ prodid: "P1", itemname: "Pump", productiongroupid: "Assy02", resourcecode: "R2" }),
        order({ prodid: "P2", itemname: "Gear", productiongroupid: "Assy01", resourcecode: "R1" }),
      ]);
    });

    // After the move, only Assy02 has the matching order — Assy01 must vanish.
    const keys = sectionKeys();
    expect(keys).not.toContain("section-Assy01");
    expect(keys).toContain("section-Assy02");
  });

  test("a formerly-hidden group reappears when a matching order moves into it", () => {
    const handle: Handle = { setOrders: () => {} };

    render(
      <BoardSectionsHarness
        initialOrders={[
          // Initially, "valve" only lives in Assy01; Assy02 has no match.
          order({ prodid: "P1", itemname: "Valve",  productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", itemname: "Widget", productiongroupid: "Assy02", resourcecode: "R2" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Inst01"]}
        handle={handle}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "valve" } });

    // Before the move: only Assy01 visible, Assy02 and Inst01 hidden.
    let keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).not.toContain("section-Assy02");
    expect(keys).not.toContain("section-Inst01");

    // Backend moves the Valve order from Assy01 → Assy02, and adds a new
    // matching order to Inst01 (formerly empty / hidden).
    act(() => {
      handle.setOrders([
        order({ prodid: "P1", itemname: "Valve",  productiongroupid: "Assy02", resourcecode: "R2" }),
        order({ prodid: "P3", itemname: "Valve Stem", productiongroupid: "Inst01", resourcecode: "R3" }),
        order({ prodid: "P2", itemname: "Widget", productiongroupid: "Assy01", resourcecode: "R1" }),
      ]);
    });

    // Assy01 lost its matching order, Assy02 and Inst01 gained matching orders.
    keys = sectionKeys();
    expect(keys).not.toContain("section-Assy01");
    expect(keys).toContain("section-Assy02");
    expect(keys).toContain("section-Inst01");
  });

  test("a group that was entirely empty before a move shows once the matching order arrives", () => {
    const handle: Handle = { setOrders: () => {} };

    render(
      <BoardSectionsHarness
        initialOrders={[
          // Paint has no orders at all initially.
          order({ prodid: "P1", itemname: "Motor", productiongroupid: "Assy01", resourcecode: "R1" }),
        ]}
        visibleGroups={["Assy01", "Paint"]}
        handle={handle}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "motor" } });

    // Only Assy01 visible, Paint absent.
    let keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).not.toContain("section-Paint");

    // P1 gets re-assigned to Paint.
    act(() => {
      handle.setOrders([
        order({ prodid: "P1", itemname: "Motor", productiongroupid: "Paint", resourcecode: "R2" }),
      ]);
    });

    keys = sectionKeys();
    expect(keys).not.toContain("section-Assy01");
    expect(keys).toContain("section-Paint");
  });

  test("searching by resource code shows only the group that contains orders with that code", () => {
    // Use FILTER_GROUPS-valid group IDs so buildBoardData does not drop the orders.
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", itemname: "Frame", productiongroupid: "Assy01", resourcecode: "R-WELD" }),
          order({ prodid: "P2", itemname: "Panel", productiongroupid: "Paint",  resourcecode: "R-PAINT" }),
          order({ prodid: "P3", itemname: "Shaft", productiongroupid: "Inst01", resourcecode: "R-MACH" }),
        ]}
        visibleGroups={["Assy01", "Paint", "Inst01"]}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "R-WELD" } });

    const keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).not.toContain("section-Paint");
    expect(keys).not.toContain("section-Inst01");
    expect(keys).toContain("section-__unallocated__");
  });

  test("partial resource code match narrows to only groups with that code substring", () => {
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R-WELD-01" }),
          order({ prodid: "P2", productiongroupid: "Assy02", resourcecode: "R-WELD-02" }),
          order({ prodid: "P3", productiongroupid: "Paint",  resourcecode: "R-PAINT-01" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Paint"]}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "weld" } });

    const keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).toContain("section-Assy02");
    expect(keys).not.toContain("section-Paint");
  });

  test("searching by group label prefix shows all groups whose label starts with that string", () => {
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", productiongroupid: "Assy02", resourcecode: "R2" }),
          order({ prodid: "P3", productiongroupid: "Paint",  resourcecode: "R3" }),
          order({ prodid: "P4", productiongroupid: "Inst01", resourcecode: "R4" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Paint", "Inst01"]}
      />,
    );

    // "Assy" is both the group-id prefix and the groupLabel used in the harness.
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "Assy" } });

    const keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).toContain("section-Assy02");
    expect(keys).not.toContain("section-Paint");
    expect(keys).not.toContain("section-Inst01");
    expect(keys).toContain("section-__unallocated__");
  });

  test("an empty string resource code does not match a non-empty search term", () => {
    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", itemname: "Bracket", productiongroupid: "Assy01", resourcecode: "" }),
          order({ prodid: "P2", itemname: "Gasket",  productiongroupid: "Paint",  resourcecode: "R-PAINT" }),
        ]}
        visibleGroups={["Assy01", "Paint"]}
      />,
    );

    // Searching "R-PAINT" must NOT match the empty-resourcecode order in Assy01.
    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "R-PAINT" } });

    const keys = sectionKeys();
    expect(keys).not.toContain("section-Assy01");
    expect(keys).toContain("section-Paint");
  });

  test("changing an order's resource code causes the old group to hide and the new group to appear", () => {
    const handle: Handle = { setOrders: () => {} };

    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", productiongroupid: "Assy01", resourcecode: "R-WELD" }),
          order({ prodid: "P2", productiongroupid: "Paint",  resourcecode: "R-PAINT" }),
        ]}
        visibleGroups={["Assy01", "Paint"]}
        handle={handle}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "R-WELD" } });

    // Before: only Assy01 visible (it has R-WELD).
    let keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).not.toContain("section-Paint");

    // Backend re-assigns P1 to Paint, keeping R-WELD as its resource code.
    act(() => {
      handle.setOrders([
        order({ prodid: "P1", productiongroupid: "Paint",  resourcecode: "R-WELD" }),
        order({ prodid: "P2", productiongroupid: "Assy01", resourcecode: "R-PAINT" }),
      ]);
    });

    // After: P1 now in Paint with R-WELD; Assy01 loses the match.
    keys = sectionKeys();
    expect(keys).not.toContain("section-Assy01");
    expect(keys).toContain("section-Paint");
  });

  test("sections remain stable when an unrelated order changes group (matching order stays put)", () => {
    const handle: Handle = { setOrders: () => {} };

    render(
      <BoardSectionsHarness
        initialOrders={[
          order({ prodid: "P1", itemname: "Pump",  productiongroupid: "Assy01", resourcecode: "R1" }),
          order({ prodid: "P2", itemname: "Screw", productiongroupid: "Assy02", resourcecode: "R2" }),
          order({ prodid: "P3", itemname: "Bolt",  productiongroupid: "Assy03", resourcecode: "R3" }),
        ]}
        visibleGroups={["Assy01", "Assy02", "Assy03"]}
        handle={handle}
      />,
    );

    fireEvent.change(screen.getByTestId("search-input"), { target: { value: "pump" } });

    // Only Assy01 matches.
    let keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).not.toContain("section-Assy02");
    expect(keys).not.toContain("section-Assy03");

    // P2 and P3 move between groups — P1 (the match) stays in Assy01.
    act(() => {
      handle.setOrders([
        order({ prodid: "P1", itemname: "Pump",  productiongroupid: "Assy01", resourcecode: "R1" }),
        order({ prodid: "P2", itemname: "Screw", productiongroupid: "Assy03", resourcecode: "R3" }),
        order({ prodid: "P3", itemname: "Bolt",  productiongroupid: "Assy02", resourcecode: "R2" }),
      ]);
    });

    // Sections unchanged — Assy01 still the only visible group.
    keys = sectionKeys();
    expect(keys).toContain("section-Assy01");
    expect(keys).not.toContain("section-Assy02");
    expect(keys).not.toContain("section-Assy03");
  });
});
