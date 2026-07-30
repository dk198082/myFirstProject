import { addDays, isWeekend, subDays, parseISO, format, isValid } from "date-fns";

export function addBusinessDays(date: Date, days: number): Date {
  let result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result = addDays(result, 1);
    if (!isWeekend(result)) {
      remaining--;
    }
  }
  return result;
}

export function subBusinessDays(date: Date, days: number): Date {
  let result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result = subDays(result, 1);
    if (!isWeekend(result)) {
      remaining--;
    }
  }
  return result;
}

export interface SlotSchedule {
  pickStart: string | null;
  pickEnd: string | null;
  assyStart: string | null;
  assyEnd: string | null;
  packStart: string | null;
  packEnd: string | null;
  ship: string | null;
}

/**
 * Forward working-day schedule derived from Production Start, mirroring the
 * "NEW Booking" spreadsheet sequence:
 *   Production Start = Pick Start --(pickDays)--> Pick End = Assy Start
 *     --(assyDays)--> Assy End = Pack Start --(packDays)--> Pack End = Ship Date
 * `packDays` is carried in the slot's `packDays` field. All offsets skip weekends.
 */
export function computeSlotDates(
  productionStart: string | null | undefined,
  assyDays: number,
  packDays: number,
  pickDays: number,
): SlotSchedule {
  const empty: SlotSchedule = {
    pickStart: null,
    pickEnd: null,
    assyStart: null,
    assyEnd: null,
    packStart: null,
    packEnd: null,
    ship: null,
  };
  if (!productionStart) return empty;
  const start = parseISO(productionStart);
  if (!isValid(start)) return empty;

  const pickStart = start;
  const pickEnd = addBusinessDays(start, pickDays);
  const assyStart = pickEnd;
  const assyEnd = addBusinessDays(assyStart, assyDays);
  // Pack window: Pack End = Ship Date, Pack Start = Ship Date - pack days (= Assy End).
  const ship = addBusinessDays(assyEnd, packDays);
  const packStart = assyEnd;
  const packEnd = ship;

  return {
    pickStart: format(pickStart, "yyyy-MM-dd"),
    pickEnd: format(pickEnd, "yyyy-MM-dd"),
    assyStart: format(assyStart, "yyyy-MM-dd"),
    assyEnd: format(assyEnd, "yyyy-MM-dd"),
    packStart: format(packStart, "yyyy-MM-dd"),
    packEnd: format(packEnd, "yyyy-MM-dd"),
    ship: format(ship, "yyyy-MM-dd"),
  };
}
