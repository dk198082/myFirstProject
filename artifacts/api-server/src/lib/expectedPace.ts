// ── Expected consumption pace ───────────────────────────────────────────────
// Given an order's production window (route start/end, excluding the warehouse
// bookend ops) and its total scheduled hours, compute how many hours SHOULD be
// posted by now if the work were spread evenly across the working days
// (Mon–Fri) of the window. The partial current day is counted proportionally
// by time-of-day within an 8:00–16:00 working day (the Schedule Board's
// Mon–Fri 8h/day convention). Clamped to [0, total].
const PLANT_TZ = "America/New_York";
const WORKDAY_START_HOUR = 8;
const WORKDAY_LENGTH_HOURS = 8;

/** Extract {dateStr, weekday(0=Sun..6=Sat), fractional hour} for `date` in the plant timezone. */
function plantClock(date: Date): { dateStr: string; weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PLANT_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    dateStr: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: weekdayNames.indexOf(get("weekday")),
    // "24" can appear for midnight with hour12:false in some ICU versions.
    hour: (Number(get("hour")) % 24) + Number(get("minute")) / 60,
  };
}

/** Count Mon–Fri days in the inclusive [start, end] date range (date-only, yyyy-mm-dd strings). */
function countWeekdays(startStr: string, endStr: string): number {
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;
  let n = 0;
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) n++;
  }
  return n;
}

/** Normalize a date/timestamp value from PG to a yyyy-mm-dd string, or null. */
function toDateOnly(val: unknown): string | null {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString().substring(0, 10);
  if (typeof val === "string" && val.length >= 10) return val.substring(0, 10);
  return null;
}

/**
 * Expected posted hours as of `now`, or null when the window/total is unusable.
 * expected = total × (elapsed working days ÷ total working days in window).
 */
export function expectedConsumedHours(
  total: number | null | undefined,
  windowStart: unknown,
  windowEnd: unknown,
  now: Date = new Date(),
): number | null {
  const t = Number(total);
  if (!t || !isFinite(t) || t <= 0) return null;
  const startStr = toDateOnly(windowStart);
  const endStr = toDateOnly(windowEnd);
  if (!startStr || !endStr || startStr > endStr) return null;

  const totalWorkdays = countWeekdays(startStr, endStr);
  if (totalWorkdays <= 0) return null;

  const clock = plantClock(now);
  if (clock.dateStr < startStr) return 0;
  if (clock.dateStr > endStr) return t;

  // Fully elapsed weekdays strictly before today (within the window)…
  let elapsed = 0;
  {
    const start = new Date(`${startStr}T00:00:00Z`);
    const today = new Date(`${clock.dateStr}T00:00:00Z`);
    for (let ts = start.getTime(); ts < today.getTime(); ts += 86_400_000) {
      const dow = new Date(ts).getUTCDay();
      if (dow >= 1 && dow <= 5) elapsed++;
    }
  }
  // …plus today's proportional share of the 8:00–16:00 working day.
  if (clock.weekday >= 1 && clock.weekday <= 5) {
    const frac = (clock.hour - WORKDAY_START_HOUR) / WORKDAY_LENGTH_HOURS;
    elapsed += Math.min(1, Math.max(0, frac));
  }

  const ratio = Math.min(1, Math.max(0, elapsed / totalWorkdays));
  return Math.round(t * ratio * 100) / 100;
}
