// Pure drop-decision logic for the Schedule Board.
//
// When a booking tile is dropped onto a cell, the drop handler must decide
// whether the move is a no-op, whether it needs a double-booking confirmation,
// and what start/end/technician payload to write back. This logic is kept free
// of React/component state (mutations, confirm dialogs, drag refs) so the
// delta computation, no-op detection, conflict gating, and the resulting
// write-back payload can be unit-tested directly.

import { shiftIsoDays } from "./dateShift";

// The minimal shape of a dragged booking the drop planner needs. Mirrors the
// fields read off a board tile (ScheduleJob) without coupling to the component.
export type DraggableBooking = {
  booking_id: string | null;
  day_index?: number | null;
  start_time?: string | null;
  end_time?: string | null;
};

// The write-back payload sent to the booking update mutation.
export type DropUpdate = {
  start_time: string | null;
  end_time: string | null;
  technician_id: string;
};

// The outcome of planning a drop:
// - "noop": nothing to do (dropped back on its own cell, or missing booking id)
// - "reschedule": stage a write-back; `requiresConfirmation` is true when the
//   move would double-book the target technician, so the caller can prompt
//   before committing.
export type DropDecision =
  | { action: "noop"; reason: "same-cell" | "missing-booking" }
  | {
      action: "reschedule";
      requiresConfirmation: boolean;
      bookingId: string;
      deltaDays: number;
      update: DropUpdate;
    };

// Decide what should happen when `job` (currently on `sourceTechId`) is dropped
// onto the cell (`targetTechId`, `targetDayIndex`). The move preserves the
// booking's time-of-day; only the date (shifted by the column delta) and the
// technician change. `hasConflict` is the precomputed double-booking cue for the
// target cell — when true the decision asks the caller to confirm before
// committing. Dropping a tile back onto its own cell, or a tile without a
// booking id, is a no-op.
export function planDrop(
  job: DraggableBooking,
  sourceTechId: string,
  targetTechId: string,
  targetDayIndex: number,
  hasConflict: boolean,
): DropDecision {
  const deltaDays = targetDayIndex - (job.day_index ?? 0);
  if (targetTechId === sourceTechId && deltaDays === 0) {
    return { action: "noop", reason: "same-cell" };
  }
  if (!job.booking_id) {
    return { action: "noop", reason: "missing-booking" };
  }
  return {
    action: "reschedule",
    requiresConfirmation: hasConflict,
    bookingId: job.booking_id,
    deltaDays,
    update: {
      start_time: shiftIsoDays(job.start_time, deltaDays),
      end_time: shiftIsoDays(job.end_time, deltaDays),
      technician_id: targetTechId,
    },
  };
}
