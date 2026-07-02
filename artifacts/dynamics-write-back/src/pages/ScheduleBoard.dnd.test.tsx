// @vitest-environment jsdom
//
// End-to-end (component) coverage for drag-to-reschedule on the Schedule Board.
// The pure drop-decision helpers (planDrop, shiftIsoDays, conflict math) are
// unit-tested elsewhere; this exercises the real wiring: a drag gesture on a job
// tile, the drop target cells, the conflict confirmation prompt, and the booking
// write-back mutation payload. It drives actual dragStart/dragOver/drop events
// against the rendered board and asserts what gets sent to the update mutation.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

// Spy that stands in for the booking-update mutation's `mutate`. Captured via
// vi.hoisted so the vi.mock factory below (hoisted to the top of the module) can
// close over it, while tests can still assert against it.
const { mutateSpy } = vi.hoisted(() => ({ mutateSpy: vi.fn() }));

vi.mock("@workspace/api-client-react", () => {
  const noopKey = () => ["mock-key"];
  return {
    // Board + side-panel data hooks. Only useGetWbScheduleBoard returns real
    // fixture data; the others return empty payloads so the board renders.
    useGetWbScheduleBoard: () => ({ data: boardData, isLoading: false, error: null }),
    useGetWbUnscheduledJobs: () => ({ data: { jobs: [] } }),
    useGetWbResourceUtilization: () => ({ data: undefined, isLoading: false }),
    // The reschedule mutation under test — hand back our spy as `mutate`.
    useUpdateWbBooking: () => ({ mutate: mutateSpy, isPending: false }),
    // Referenced by EditBookingDialog (never rendered here) — present as no-ops.
    useCreateWbBooking: () => ({ mutate: vi.fn(), isPending: false }),
    useListWbTechnicians: () => ({ data: { technicians: [] } }),
    // Query-key helpers used for cache invalidation in onSuccess.
    getListWbWorkOrdersQueryKey: noopKey,
    getListWbWritebacksQueryKey: noopKey,
    getGetWbScheduleBoardQueryKey: noopKey,
    getGetWbResourceUtilizationQueryKey: noopKey,
    getGetWbUnscheduledJobsQueryKey: noopKey,
  };
});

import ScheduleBoard from "./ScheduleBoard";

// Two technicians in one region. t1 has a 9–10am job on day 0; t2 has a 9–10am
// job on day 1. Dropping t1's job onto t2/day-1 therefore overlaps (conflict),
// while other target cells are free.
const boardData = {
  range_start: "2026-06-15",
  day_count: 7,
  regions: [
    {
      regionid_id: "r1",
      region: "North",
      company: "ACME",
      technicians: [
        {
          technician_id: "t1",
          resource_name: "Alice",
          jobs: [
            {
              booking_id: "bkA",
              work_order_id: "woA",
              work_order_number: "WO-A",
              customer_name: "Cust A",
              system_status: "Scheduled",
              day_index: 0,
              crmstarttime: "09:00",
              crmendtime: "10:00",
              start_time: "2026-06-15T09:00:00.000Z",
              end_time: "2026-06-15T10:00:00.000Z",
            },
          ],
        },
        {
          technician_id: "t2",
          resource_name: "Bob",
          jobs: [
            {
              booking_id: "bkB",
              work_order_id: "woB",
              work_order_number: "WO-B",
              customer_name: "Cust B",
              system_status: "Scheduled",
              day_index: 1,
              crmstarttime: "09:00",
              crmendtime: "10:00",
              start_time: "2026-06-16T09:00:00.000Z",
              end_time: "2026-06-16T10:00:00.000Z",
            },
          ],
        },
      ],
    },
  ],
};

// A DataTransfer stand-in. jsdom doesn't implement DataTransfer, and the drag
// handlers read/write effectAllowed/dropEffect and call setData/getData.
function makeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: "",
    dropEffect: "",
    setData: (type: string, val: string) => {
      store[type] = val;
    },
    getData: (type: string) => store[type] ?? "",
  };
}

// Drag `chip` and drop it on `cell`, sharing one dataTransfer across the gesture
// like a real browser would.
function dragAndDrop(chip: HTMLElement, cell: HTMLElement) {
  const dataTransfer = makeDataTransfer();
  fireEvent.dragStart(chip, { dataTransfer });
  fireEvent.dragOver(cell, { dataTransfer });
  fireEvent.drop(cell, { dataTransfer });
}

function renderBoard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ScheduleBoard />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("ScheduleBoard drag-to-reschedule (end to end)", () => {
  beforeEach(() => {
    mutateSpy.mockReset();
    vi.restoreAllMocks();
    cleanup();
  });

  it("writes back a shifted start/end and new technician when a tile is dragged onto another cell", () => {
    renderBoard();

    const chip = screen.getByTestId("chip-job-bkA");
    // Drop onto Bob's day-3 column: cross-tech (t1 -> t2) and cross-day (0 -> 3).
    const targetCell = screen.getByTestId("cell-t2-3");
    dragAndDrop(chip, targetCell);

    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [variables] = mutateSpy.mock.calls[0];
    expect(variables).toEqual({
      bookingId: "bkA",
      data: {
        // 09:00–10:00 on day 0 shifted +3 days, keeping time-of-day.
        start_time: "2026-06-18T09:00:00.000Z",
        end_time: "2026-06-18T10:00:00.000Z",
        technician_id: "t2",
      },
    });
  });

  it("prompts for confirmation on an overlapping drop and only writes back when confirmed", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBoard();

    const chip = screen.getByTestId("chip-job-bkA");
    // Bob already has a 9–10am job on day 1; dropping the 9–10am tile here overlaps.
    const conflictCell = screen.getByTestId("cell-t2-1");

    // First attempt: dispatcher declines the confirmation -> no write-back.
    dragAndDrop(chip, conflictCell);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(mutateSpy).not.toHaveBeenCalled();

    // Second attempt: dispatcher confirms -> write-back is sent.
    confirmSpy.mockReturnValue(true);
    dragAndDrop(chip, conflictCell);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(mutateSpy).toHaveBeenCalledTimes(1);
    const [variables] = mutateSpy.mock.calls[0];
    expect(variables).toEqual({
      bookingId: "bkA",
      data: {
        start_time: "2026-06-16T09:00:00.000Z",
        end_time: "2026-06-16T10:00:00.000Z",
        technician_id: "t2",
      },
    });
  });

  it("sends no write-back when a tile is dropped back on its own cell", () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    renderBoard();

    const chip = screen.getByTestId("chip-job-bkA");
    // Alice's day-0 column is the tile's own cell -> no-op.
    const sameCell = screen.getByTestId("cell-t1-0");
    dragAndDrop(chip, sameCell);

    expect(mutateSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
