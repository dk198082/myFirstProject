// Pure double-booking conflict logic for the Schedule Board.
//
// A drop double-books a technician when the moved booking overlaps an existing
// booking for the same technician on the same day, preserving time-of-day.
// These helpers are kept free of React/component state so the overlap rules can
// be unit-tested directly.

export type BookingWindow = {
  booking_id: string;
  day_index?: number | null;
  crmstarttime?: string | null;
  crmendtime?: string | null;
};

// Parse an "HH:MM" time string into minutes since midnight. Returns null for
// missing or unparseable values so callers can decide how to treat them.
export function timeToMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

// Do two time windows (each "HH:MM" start/end) overlap? A window with a missing
// end is treated as a 1-minute window at its start. Adjacent (touching) windows
// do NOT overlap. Returns false when either start time is missing/unparseable.
export function windowsOverlap(
  aStartT: string | null | undefined,
  aEndT: string | null | undefined,
  bStartT: string | null | undefined,
  bEndT: string | null | undefined,
): boolean {
  const aStart = timeToMins(aStartT);
  const bStart = timeToMins(bStartT);
  if (aStart == null || bStart == null) return false;
  const aEnd = timeToMins(aEndT) ?? aStart + 1;
  const bEnd = timeToMins(bEndT) ?? bStart + 1;
  return aStart < bEnd && aEnd > bStart;
}

// Find every booking that double-books a single technician: same day, with an
// overlapping time window. Bookings are grouped by day_index (defaulting to 0)
// so same-time-different-day bookings never conflict.
export function conflictedIdsForTech(jobs: BookingWindow[]): Set<string> {
  const ids = new Set<string>();
  const byDay = new Map<number, BookingWindow[]>();
  for (const j of jobs) {
    const d = j.day_index ?? 0;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(j);
  }
  for (const dayJobs of byDay.values()) {
    if (dayJobs.length < 2) continue;
    for (let a = 0; a < dayJobs.length; a++) {
      for (let b = a + 1; b < dayJobs.length; b++) {
        const ja = dayJobs[a];
        const jb = dayJobs[b];
        if (windowsOverlap(ja.crmstarttime, ja.crmendtime, jb.crmstarttime, jb.crmendtime)) {
          ids.add(ja.booking_id);
          ids.add(jb.booking_id);
        }
      }
    }
  }
  return ids;
}

// Would moving `dragged` (currently on `sourceTechId`) onto the cell
// (`targetTechId`, `targetDayIndex`) overlap one of `targetTechJobs`? The move
// preserves the booking's time-of-day. Returns false for the no-op drop (same
// technician and same day) and when the dragged start time is missing.
export function wouldDropConflict(
  dragged: BookingWindow,
  sourceTechId: string,
  targetTechId: string,
  targetDayIndex: number,
  targetTechJobs: BookingWindow[],
): boolean {
  const deltaDays = targetDayIndex - (dragged.day_index ?? 0);
  if (targetTechId === sourceTechId && deltaDays === 0) return false; // no-op
  if (timeToMins(dragged.crmstarttime) == null) return false;
  for (const other of targetTechJobs) {
    if (other.booking_id === dragged.booking_id) continue;
    if ((other.day_index ?? 0) !== targetDayIndex) continue;
    if (
      windowsOverlap(
        dragged.crmstarttime,
        dragged.crmendtime,
        other.crmstarttime,
        other.crmendtime,
      )
    ) {
      return true;
    }
  }
  return false;
}
