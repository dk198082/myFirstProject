import { describe, test, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PickStatusDot, OrderCardTooltip } from "./dashboard";
import type { ComponentProps } from "react";

afterEach(cleanup);

type TooltipProps = ComponentProps<typeof OrderCardTooltip>;

const baseOrder = {
  prodid: "P000123",
  itemname: "Test Widget",
  productconfiguration: null,
  schedulefromdate: "2026-07-06",
  scheduledenddate: "2026-07-10",
  totalscheduledtime: 12,
} as TooltipProps["order"];

function renderTooltip(overrides: Partial<TooltipProps>) {
  const result = render(
    <TooltipProvider delayDuration={0}>
      <OrderCardTooltip
        order={baseOrder}
        pickItems={undefined}
        pickLoaded={false}
        groupName="300SL"
        {...overrides}
      >
        <button>card</button>
      </OrderCardTooltip>
    </TooltipProvider>,
  );
  // Focus opens a Radix tooltip immediately (no hover delay).
  fireEvent.focus(result.getByText("card"));
  return result;
}

describe("PickStatusDot", () => {
  test("renders nothing while picking data is loading", () => {
    render(<PickStatusDot loaded={false} hasRemaining={true} prodid="P1" />);
    expect(screen.queryByTestId("dot-pick-P1")).toBeNull();
  });

  test("shows a red dot when items remain to pick", () => {
    render(<PickStatusDot loaded={true} hasRemaining={true} prodid="P1" />);
    const dot = screen.getByTestId("dot-pick-P1");
    expect(dot.className).toContain("bg-red-500");
    expect(dot.getAttribute("aria-label")).toBe("Items remaining to pick");
  });

  test("shows a green dot when everything is picked", () => {
    render(<PickStatusDot loaded={true} hasRemaining={false} prodid="P1" />);
    const dot = screen.getByTestId("dot-pick-P1");
    expect(dot.className).toContain("bg-emerald-500");
    expect(dot.getAttribute("aria-label")).toBe("All items picked");
  });
});

describe("OrderCardTooltip pick section", () => {
  test("shows loading text while picking data loads", () => {
    renderTooltip({ pickLoaded: false, pickError: false });
    expect(screen.getAllByText("Loading pick status…").length).toBeGreaterThan(0);
    expect(screen.queryByText("All items picked")).toBeNull();
    expect(screen.queryByText("Remaining to pick:")).toBeNull();
  });

  test("lists remaining items with quantity, unit, item number, description", () => {
    renderTooltip({
      pickLoaded: true,
      pickItems: [
        { itemnumber: "ITEM-1", description: "Steel plate", remaining: 4.5, unit: "kg" },
        { itemnumber: "ITEM-2", description: null, remaining: 2, unit: null },
      ],
    });
    expect(screen.getAllByText("Remaining to pick:").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.5 kg").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ITEM-1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(": Steel plate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ITEM-2").length).toBeGreaterThan(0);
    expect(screen.queryByText("All items picked")).toBeNull();
  });

  test('shows "All items picked" when loaded with no remaining items', () => {
    renderTooltip({ pickLoaded: true, pickItems: undefined });
    expect(screen.getAllByText("All items picked").length).toBeGreaterThan(0);
    expect(screen.queryByText("Remaining to pick:")).toBeNull();
  });

  test('shows "All items picked" for an empty item list too', () => {
    renderTooltip({ pickLoaded: true, pickItems: [] });
    expect(screen.getAllByText("All items picked").length).toBeGreaterThan(0);
  });

  test('shows "Pick status unavailable" when the picking fetch fails', () => {
    renderTooltip({ pickLoaded: false, pickError: true });
    expect(screen.getAllByText("Pick status unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loading pick status…")).toBeNull();
    expect(screen.queryByText("All items picked")).toBeNull();
    expect(screen.queryByText("Remaining to pick:")).toBeNull();
  });

  test("always shows order id and group name", () => {
    renderTooltip({ pickLoaded: true });
    expect(screen.getAllByText("P000123").length).toBeGreaterThan(0);
    expect(screen.getAllByText("300SL").length).toBeGreaterThan(0);
  });
});
