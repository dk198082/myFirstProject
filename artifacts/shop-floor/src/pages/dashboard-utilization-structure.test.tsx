import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { format, addDays } from "date-fns";
import { ResourceUtilization } from "./dashboard";
import type { UtilizationEntry } from "@workspace/api-client-react";

afterEach(cleanup);

// Two-week window: Mon–Fri of two consecutive weeks (10 day columns), matching
// how the dashboard builds `days` in 2 Weeks mode.
const week1Monday = new Date("2026-07-06T00:00:00");
const days: Date[] = [
  ...Array.from({ length: 5 }, (_, i) => addDays(week1Monday, i)),
  ...Array.from({ length: 5 }, (_, i) => addDays(week1Monday, 7 + i)),
];
const dayKeys = days.map((d) => format(d, "yyyy-MM-dd"));

const entries: UtilizationEntry[] = [
  { productiongroupid: "G1", prodid: "P001", itemname: "Widget", operationnumber: 10, operationname: "Weld", day: dayKeys[0], postedhours: 4 },
  { productiongroupid: "G1", prodid: "P001", itemname: "Widget", operationnumber: 10, operationname: "Weld", day: dayKeys[7], postedhours: 2.5 },
  { productiongroupid: "G1", prodid: "P002", itemname: "Gadget", operationnumber: 20, operationname: "Paint", day: dayKeys[9], postedhours: 1 },
];

function renderBoard() {
  return render(
    <ResourceUtilization
      utilization={entries}
      days={days}
      weeksToShow={2}
      visibleGroups={["G1"]}
      groupNameMap={{ G1: "300SL" }}
      groupedOrders={{ G1: [{ prodid: "P001", itemname: "Widget" } as never] }}
      onOpenOrder={() => {}}
    />,
  );
}

// Effective column count of a row, accounting for colSpan.
function colCount(row: HTMLTableRowElement): number {
  return Array.from(row.cells).reduce((n, c) => n + c.colSpan, 0);
}

describe("ResourceUtilization detail structure (2-week view)", () => {
  test("renders a single table with 10 day columns in the header", () => {
    const { container, getByTestId } = renderBoard();
    fireEvent.click(getByTestId("row-util-G1"));

    // Regression: detail rows must NOT be a nested table.
    expect(container.querySelectorAll("table")).toHaveLength(1);

    const table = container.querySelector("table")!;
    const headerRow = within(table).getAllByRole("row")[0] as HTMLTableRowElement;
    // Group + Posted/Cap + Utilization + 10 days + No hours posted = 14 columns.
    expect(colCount(headerRow)).toBe(14);
  });

  test("expanded detail rows are sibling rows in the same tbody with matching column spans", () => {
    const { container, getByTestId } = renderBoard();
    const groupRow = getByTestId("row-util-G1") as HTMLTableRowElement;
    fireEvent.click(groupRow);

    const tbody = container.querySelector("tbody")!;
    // Group row, drill header row, and the op rows all share one tbody.
    expect(groupRow.parentElement).toBe(tbody);
    const rows = Array.from(tbody.querySelectorAll("tr")) as HTMLTableRowElement[];
    // 1 group row + 1 drill header + 2 op rows (P001/Weld, P002/Paint) = 4.
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.parentElement).toBe(tbody);
      expect(row.querySelector("table")).toBeNull();
      expect(colCount(row)).toBe(14);
    }
  });

  test("detail day values land in the same column index as their header day", () => {
    const { container, getByTestId } = renderBoard();
    fireEvent.click(getByTestId("row-util-G1"));

    const rows = Array.from(container.querySelectorAll("tbody tr")) as HTMLTableRowElement[];
    const opRow = rows[2]; // first op row (P001 / Weld)

    // Build a map of effective column index -> cell text, expanding colSpan.
    const cellsByCol = (row: HTMLTableRowElement) => {
      const map: Record<number, string> = {};
      let col = 0;
      for (const cell of Array.from(row.cells)) {
        map[col] = cell.textContent?.trim() ?? "";
        col += cell.colSpan;
      }
      return map;
    };

    const opCells = cellsByCol(opRow);
    // Day columns occupy effective indexes 3..12 (after Group, Posted/Cap, Utilization).
    expect(opCells[3]).toBe("4.0");   // Mon of week 1 (dayKeys[0])
    expect(opCells[10]).toBe("2.5");  // Mon of week 2 (dayKeys[7])
    // Empty days render the dot placeholder, keeping alignment.
    expect(opCells[4]).toBe("·");
  });
});
