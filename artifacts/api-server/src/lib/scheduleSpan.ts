const DAY_MS = 86_400_000;

type Timestamp = Date | string;

export type BookingDaySpan = {
  dayIndexes: number[];
  dayNumbers: number[];
  totalDayCount: number;
  spanStartDay: number;
  spanEndDay: number;
};

function asDate(value: Timestamp): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayIndex(date: Date, rangeStartMs: number): number {
  const utcDay = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.floor((utcDay - rangeStartMs) / DAY_MS);
}

function dayOfWeek(index: number, rangeStartMs: number): number {
  return new Date(rangeStartMs + index * DAY_MS).getUTCDay();
}

function weekdayCount(startIndex: number, endIndex: number, rangeStartMs: number): number {
  if (endIndex < startIndex) return 0;

  const totalDays = endIndex - startIndex + 1;
  const fullWeeks = Math.floor(totalDays / 7);
  let count = fullWeeks * 5;
  const remainder = totalDays % 7;
  const startDayOfWeek = dayOfWeek(startIndex, rangeStartMs);

  for (let offset = 0; offset < remainder; offset += 1) {
    const currentDayOfWeek = (startDayOfWeek + offset) % 7;
    if (currentDayOfWeek !== 0 && currentDayOfWeek !== 6) count += 1;
  }

  return count;
}

function includedDayCount(
  startDayIndex: number,
  endDayIndex: number,
  throughDayIndex: number,
  rangeStartMs: number,
): number {
  const through = Math.min(endDayIndex, throughDayIndex);
  if (through < startDayIndex) return 0;

  let count = weekdayCount(startDayIndex, through, rangeStartMs);
  if (dayOfWeek(startDayIndex, rangeStartMs) === 0 || dayOfWeek(startDayIndex, rangeStartMs) === 6) {
    count += 1;
  }
  if (
    endDayIndex !== startDayIndex &&
    through >= endDayIndex &&
    (dayOfWeek(endDayIndex, rangeStartMs) === 0 || dayOfWeek(endDayIndex, rangeStartMs) === 6)
  ) {
    count += 1;
  }
  return count;
}

/**
 * Expands one CRM booking into the calendar days on which its chip should
 * appear. Weekdays are always included. Saturday/Sunday are included only
 * when the booking itself starts or effectively ends on that weekend day;
 * weekend days merely crossed by a longer booking are not assumed work days.
 */
export function bookingDaySpan(
  startValue: Timestamp,
  endValue: Timestamp | null | undefined,
  rangeStart: Date,
  dayCount: number,
): BookingDaySpan | null {
  if (dayCount <= 0) return null;

  const start = asDate(startValue);
  if (!start) return null;

  const rangeStartMs = rangeStart.getTime();
  const maxDayIndex = dayCount - 1;
  const startDayIndex = dayIndex(start, rangeStartMs);
  let endDayIndex = startDayIndex;

  if (endValue != null) {
    const end = asDate(endValue);
    if (end) {
      let effectiveEndDayIndex = dayIndex(end, rangeStartMs);
      const endsAtMidnight =
        end.getUTCHours() === 0 &&
        end.getUTCMinutes() === 0 &&
        end.getUTCSeconds() === 0 &&
        end.getUTCMilliseconds() === 0;

      if (endsAtMidnight && effectiveEndDayIndex > startDayIndex) {
        effectiveEndDayIndex -= 1;
      }
      if (effectiveEndDayIndex > endDayIndex) {
        endDayIndex = effectiveEndDayIndex;
      }
    }
  }

  const firstCandidate = Math.max(0, startDayIndex);
  const lastCandidate = Math.min(maxDayIndex, endDayIndex);
  if (firstCandidate > lastCandidate) return null;

  const dayIndexes: number[] = [];
  for (let index = firstCandidate; index <= lastCandidate; index += 1) {
    const currentDayOfWeek = dayOfWeek(index, rangeStartMs);
    const isWeekend = currentDayOfWeek === 0 || currentDayOfWeek === 6;
    const isExplicitBoundary =
      index === startDayIndex || index === endDayIndex;

    if (!isWeekend || isExplicitBoundary) {
      dayIndexes.push(index);
    }
  }

  if (dayIndexes.length === 0) return null;

  const totalDayCount = includedDayCount(
    startDayIndex,
    endDayIndex,
    endDayIndex,
    rangeStartMs,
  );

  return {
    dayIndexes,
    dayNumbers: dayIndexes.map((index) =>
      includedDayCount(startDayIndex, endDayIndex, index, rangeStartMs),
    ),
    totalDayCount,
    spanStartDay: dayIndexes[0],
    spanEndDay: dayIndexes[dayIndexes.length - 1],
  };
}