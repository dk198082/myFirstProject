import { format, parseISO } from "date-fns";
import type { KpiOrder } from "@workspace/api-client-react";

// ── Date helpers ──────────────────────────────────────────────────────────────
export function toKpiDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  try {
    const dt = parseISO(d.substring(0, 10));
    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
}

export function fmtKpiDate(d: Date | null): string {
  if (!d) return "—";
  return format(d, "dd-MMM-yy");
}

export function fmtKpiHours(h: number | null | undefined): string {
  if (h == null) return "—";
  return h.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

// Excel NETWORKDAYS(first, last): count of weekdays in the inclusive range
// [first, last], excluding Saturdays and Sundays. Holidays are not modeled.
// Weekend endpoints are correctly excluded (e.g. NETWORKDAYS(Sat, Sat) = 0).
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export function networkDays(first: Date | null, last: Date | null): number | null {
  if (!first || !last) return null;
  if (last < first) return null;
  const totalDays = Math.round((last.getTime() - first.getTime()) / MS_PER_DAY) + 1;
  const fullWeeks = Math.floor(totalDays / 7);
  let businessDays = fullWeeks * 5;
  const remaining = totalDays % 7;
  const startDay = first.getDay(); // 0=Sun .. 6=Sat
  for (let i = 0; i < remaining; i++) {
    const d = (startDay + i) % 7;
    if (d !== 0 && d !== 6) businessDays++;
  }
  return businessDays;
}

// ── KPI verdict ───────────────────────────────────────────────────────────────
export type Verdict = "ON TIME" | "LATE" | null;

// STATUS: was the last posting on or before the scheduled delivery date?
export function statusVerdict(o: KpiOrder): Verdict {
  const last = toKpiDate(o.lastposting);
  const delivery = toKpiDate(o.delivery);
  if (!last || !delivery) return null;
  return last <= delivery ? "ON TIME" : "LATE";
}

// ── Computed row ──────────────────────────────────────────────────────────────
export type KpiRow = {
  order: KpiOrder;
  flowTime: number | null;
  activeDays: number | null;
  continuity: number | null; // percentage 0..100
  days: number | null; // Flow Time − Active Days (idle working days)
  status: Verdict;
};

export function computeKpiRow(o: KpiOrder): KpiRow {
  const flowTime = networkDays(toKpiDate(o.firstposting), toKpiDate(o.lastposting));
  const activeDays = o.activedays ?? null;
  // Continuity % = Active Posting Days ÷ Flow Time. Can exceed 100% when
  // postings land on weekend days that the working-day flow time excludes.
  const continuity =
    flowTime && flowTime > 0 && activeDays != null ? (activeDays / flowTime) * 100 : null;
  // Days = Flow Time − Active Days: working days inside the window with no posting.
  const days = flowTime != null && activeDays != null ? flowTime - activeDays : null;
  return {
    order: o,
    flowTime,
    activeDays,
    continuity,
    days,
    status: statusVerdict(o),
  };
}
