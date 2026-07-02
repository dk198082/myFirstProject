// Pure date-shift logic for the Schedule Board.
//
// When a booking is dropped onto a different day column, its start/end ISO
// timestamps are shifted by the column delta while preserving time-of-day.
// This helper is kept free of React/component state so the shift math can be
// unit-tested directly.

// Shift an ISO timestamp by whole UTC days, preserving time-of-day. The board
// assigns jobs to day columns by UTC date, so shifting by the column delta both
// preserves the booking's time/duration and lands it in the dropped-on column.
export function shiftIsoDays(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}
