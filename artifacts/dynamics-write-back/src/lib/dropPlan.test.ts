import { describe, it, expect } from "vitest";
import { planDrop, type DraggableBooking } from "./dropPlan";

const job: DraggableBooking = {
  booking_id: "bk1",
  day_index: 0,
  start_time: "2026-06-17T09:00:00.000Z",
  end_time: "2026-06-17T10:00:00.000Z",
};

describe("planDrop", () => {
  it("is a no-op when dropped back on its own cell (same tech, same day)", () => {
    const decision = planDrop(job, "t1", "t1", 0, false);
    expect(decision).toEqual({ action: "noop", reason: "same-cell" });
  });

  it("treats same tech + same day as a no-op even when a conflict is reported", () => {
    const decision = planDrop(job, "t1", "t1", 0, true);
    expect(decision).toEqual({ action: "noop", reason: "same-cell" });
  });

  it("is a no-op when the dragged tile has no booking id", () => {
    const decision = planDrop({ ...job, booking_id: null }, "t1", "t2", 0, false);
    expect(decision).toEqual({ action: "noop", reason: "missing-booking" });
  });

  it("shifts start/end by the column delta on a cross-day drop, keeping the tech", () => {
    const decision = planDrop(job, "t1", "t1", 2, false);
    expect(decision).toEqual({
      action: "reschedule",
      requiresConfirmation: false,
      bookingId: "bk1",
      deltaDays: 2,
      update: {
        start_time: "2026-06-19T09:00:00.000Z",
        end_time: "2026-06-19T10:00:00.000Z",
        technician_id: "t1",
      },
    });
  });

  it("shifts backward for a negative column delta", () => {
    const dragged: DraggableBooking = { ...job, day_index: 3 };
    const decision = planDrop(dragged, "t1", "t1", 1, false);
    expect(decision).toMatchObject({
      action: "reschedule",
      deltaDays: -2,
      update: {
        start_time: "2026-06-15T09:00:00.000Z",
        end_time: "2026-06-15T10:00:00.000Z",
        technician_id: "t1",
      },
    });
  });

  it("reassigns the technician on a same-day cross-technician drop without shifting dates", () => {
    const decision = planDrop(job, "t1", "t2", 0, false);
    expect(decision).toEqual({
      action: "reschedule",
      requiresConfirmation: false,
      bookingId: "bk1",
      deltaDays: 0,
      update: {
        start_time: "2026-06-17T09:00:00.000Z",
        end_time: "2026-06-17T10:00:00.000Z",
        technician_id: "t2",
      },
    });
  });

  it("shifts dates and reassigns the technician on a cross-day cross-tech drop", () => {
    const decision = planDrop(job, "t1", "t2", 4, false);
    expect(decision).toMatchObject({
      action: "reschedule",
      deltaDays: 4,
      update: {
        start_time: "2026-06-21T09:00:00.000Z",
        end_time: "2026-06-21T10:00:00.000Z",
        technician_id: "t2",
      },
    });
  });

  it("requires confirmation when the drop would double-book the target tech", () => {
    const decision = planDrop(job, "t1", "t2", 0, true);
    expect(decision).toEqual({
      action: "reschedule",
      requiresConfirmation: true,
      bookingId: "bk1",
      deltaDays: 0,
      update: {
        start_time: "2026-06-17T09:00:00.000Z",
        end_time: "2026-06-17T10:00:00.000Z",
        technician_id: "t2",
      },
    });
  });

  it("defaults a missing day_index to 0 when computing the delta", () => {
    const dragged: DraggableBooking = { ...job, day_index: null };
    const decision = planDrop(dragged, "t1", "t1", 3, false);
    expect(decision).toMatchObject({ action: "reschedule", deltaDays: 3 });
  });

  it("carries null start/end through when the booking has no timestamps", () => {
    const dragged: DraggableBooking = {
      booking_id: "bk2",
      day_index: 0,
      start_time: null,
      end_time: null,
    };
    const decision = planDrop(dragged, "t1", "t2", 1, false);
    expect(decision).toMatchObject({
      action: "reschedule",
      update: { start_time: null, end_time: null, technician_id: "t2" },
    });
  });
});
