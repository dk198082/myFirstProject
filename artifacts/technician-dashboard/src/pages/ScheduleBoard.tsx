import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useGetScheduleBoard, useGetUnscheduledJobs, UnscheduledJob } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft, CalendarClock, ChevronLeft, ChevronRight,
  Globe, Phone, Briefcase, AlertTriangle, Printer, User,
  MapPin, Clock,
} from "lucide-react";

type ViewMode = "week" | "month" | "tech";

function statusCode(s: string | null | undefined): string {
  switch ((s ?? "").toLowerCase()) {
    case "scheduled":   return "SCH";
    case "completed":   return "CMP";
    case "in progress": return "IP";
    case "cancelled":   return "CAN";
    case "invoiced":    return "INV";
    default:            return (s ?? "").slice(0, 3).toUpperCase() || "—";
  }
}

function startOfWeekISO(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function startOfMonthISO(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
    .toISOString().slice(0, 10);
}

function fmtDayHeader(iso: string, mode: ViewMode): { dow: string; date: string } {
  const d = new Date(iso + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date: mode === "week"
      ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : String(d.getUTCDate()),
  };
}

function fmtRangeLabel(start: string, dayCount: number, mode: ViewMode): string {
  const s = new Date(start + "T00:00:00Z");
  if (mode === "month") {
    return s.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const e = new Date(start + "T00:00:00Z");
  e.setUTCDate(e.getUTCDate() + Math.max(0, dayCount - 1));
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}, ${s.getUTCFullYear()}`;
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  const hhmm = t.length >= 5 ? t.slice(0, 5) : t;
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  if (!Number.isFinite(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mStr ?? "00"} ${period}`;
}

function timeToMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr ?? "0");
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function fmtDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "";
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const mins = Math.max(0, toMin(end) - toMin(start));
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Distinct, accessible palette for technicians. Each entry pairs a
// chip background/border with a matching dot for the technician label.
const TECH_PALETTE = [
  { chip: "bg-blue-100   text-blue-900   border-blue-400   hover:bg-blue-200",   dot: "bg-blue-500" },
  { chip: "bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200", dot: "bg-emerald-500" },
  { chip: "bg-amber-100  text-amber-900  border-amber-400  hover:bg-amber-200",  dot: "bg-amber-500" },
  { chip: "bg-rose-100   text-rose-900   border-rose-400   hover:bg-rose-200",   dot: "bg-rose-500" },
  { chip: "bg-violet-100 text-violet-900 border-violet-400 hover:bg-violet-200", dot: "bg-violet-500" },
  { chip: "bg-cyan-100   text-cyan-900   border-cyan-400   hover:bg-cyan-200",   dot: "bg-cyan-500" },
  { chip: "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-400 hover:bg-fuchsia-200", dot: "bg-fuchsia-500" },
  { chip: "bg-lime-100   text-lime-900   border-lime-500   hover:bg-lime-200",   dot: "bg-lime-500" },
  { chip: "bg-orange-100 text-orange-900 border-orange-400 hover:bg-orange-200", dot: "bg-orange-500" },
  { chip: "bg-teal-100   text-teal-900   border-teal-400   hover:bg-teal-200",   dot: "bg-teal-500" },
  { chip: "bg-pink-100   text-pink-900   border-pink-400   hover:bg-pink-200",   dot: "bg-pink-500" },
  { chip: "bg-indigo-100 text-indigo-900 border-indigo-400 hover:bg-indigo-200", dot: "bg-indigo-500" },
  { chip: "bg-sky-100    text-sky-900    border-sky-400    hover:bg-sky-200",    dot: "bg-sky-500" },
  { chip: "bg-yellow-100 text-yellow-900 border-yellow-500 hover:bg-yellow-200", dot: "bg-yellow-500" },
  { chip: "bg-red-100    text-red-900    border-red-400    hover:bg-red-200",    dot: "bg-red-500" },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function techColor(technicianId: string | null | undefined) {
  if (!technicianId) return TECH_PALETTE[0];
  return TECH_PALETTE[hashStr(technicianId) % TECH_PALETTE.length];
}

function cancelledChipColor() {
  return "bg-gray-100 text-gray-500 border-gray-300 line-through hover:bg-gray-200";
}

// ── Unscheduled card helpers ──────────────────────────────────────────────────

function fmtMins(mins: number | null | undefined): string {
  if (mins == null || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "No due date";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function getBucketIndex(dueDateISO: string | null | undefined): number {
  if (!dueDateISO) return 2;
  const d = new Date(dueDateISO + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 2;
  const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 14) return 0;
  if (diffDays <= 28) return 1;
  return 2;
}

function sortByDue(a: UnscheduledJob, b: UnscheduledJob): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
}

function fmtFamiliarity(t: { city_jobs: number; region_jobs: number; same_region: boolean; region?: string | null }): string {
  const parts: string[] = [];
  if (t.same_region && t.region) parts.push(t.region);
  if (t.city_jobs > 0) parts.push(`${t.city_jobs} prior in city`);
  else if (t.region_jobs > 0) parts.push(`${t.region_jobs} prior in region`);
  return parts.join(" · ") || (t.region ?? "");
}

const UNSCHEDULED_BUCKETS = [
  {
    label: "Due Within 2 Weeks", sublabel: "Highest priority",
    border: "border-red-400", headerClass: "bg-red-50 border-b border-red-200 text-red-900",
    badgeClass: "bg-red-100 text-red-800 border border-red-200", dateClass: "text-red-700 font-semibold",
  },
  {
    label: "Due in 3–4 Weeks", sublabel: "Plan ahead",
    border: "border-amber-400", headerClass: "bg-amber-50 border-b border-amber-200 text-amber-900",
    badgeClass: "bg-amber-100 text-amber-800 border border-amber-200", dateClass: "text-amber-700 font-semibold",
  },
  {
    label: "Due in 4+ Weeks", sublabel: "Future / unset",
    border: "border-slate-300", headerClass: "bg-slate-50 border-b border-slate-200 text-slate-800",
    badgeClass: "bg-slate-100 text-slate-700 border border-slate-200", dateClass: "text-slate-600",
  },
];

function UnscheduledJobCard({ job, bucketIdx }: { job: UnscheduledJob; bucketIdx: number }) {
  const t1 = job.best_fit_techs?.[0];
  const t2 = job.best_fit_techs?.[1];
  const duration = fmtMins(job.duration_minutes);
  const loc = [job.city, job.state].filter(Boolean).join(", ");
  const dateClass = UNSCHEDULED_BUCKETS[bucketIdx].dateClass;

  return (
    <div className="bg-white rounded-lg border border-card-border shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-3 min-w-[260px] max-w-[300px] w-[280px] shrink-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {job.work_order_id ? (
            <Link href={`/work-order/${job.work_order_id}`} className="text-primary hover:underline font-mono font-bold text-sm">
              WO# {job.work_order_number ?? "—"}
            </Link>
          ) : (
            <span className="font-mono font-bold text-sm">WO# {job.work_order_number ?? "—"}</span>
          )}
          {job.work_order_type && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge
                variant="outline"
                className={`text-xs px-1.5 py-0 h-4 font-normal ${
                  job.work_order_type.toLowerCase() === "install"
                    ? "border-violet-400 text-violet-700 bg-violet-50"
                    : "border-blue-300 text-blue-700 bg-blue-50"
                }`}
              >
                {job.work_order_type}
              </Badge>
              {job.work_order_type.toLowerCase() === "install" && job.sales_order_number && (
                <span className="text-xs text-muted-foreground font-mono">SO: {job.sales_order_number}</span>
              )}
            </div>
          )}
        </div>
        <span className={`text-xs whitespace-nowrap shrink-0 ${dateClass}`}>
          {fmtDateShort(job.due_date)}
        </span>
      </div>

      <div>
        <div className="text-sm font-semibold text-foreground leading-tight">{job.customer_name ?? "—"}</div>
        {job.servicelocation && (
          <div className="text-xs text-muted-foreground truncate">{job.servicelocation}</div>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{loc || "—"}</span>
        {job.region && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 ml-auto shrink-0">{job.region}</Badge>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {job.po_number && <span className="font-mono truncate">PO: {job.po_number}</span>}
        {duration && (
          <span className="flex items-center gap-1 shrink-0">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}
      </div>

      {(job.contact_name || job.contact_phone) && (
        <div className="text-xs text-muted-foreground flex items-start gap-1.5">
          <User className="h-3 w-3 shrink-0 mt-0.5" />
          <div className="min-w-0">
            {job.contact_name && <div className="truncate">{job.contact_name}</div>}
            {job.contact_phone && (
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3 shrink-0" />
                <span className="truncate">{job.contact_phone}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(t1 || t2) && (
        <div className="pt-2 border-t border-border space-y-1 mt-auto">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Best Fit</div>
          {[t1, t2].filter(Boolean).map((t, i) => (
            <div key={i} className="text-xs flex items-center justify-between gap-1">
              <span className="font-medium truncate">{t!.resource_name ?? "—"}</span>
              <span className="text-muted-foreground shrink-0 text-right">{fmtFamiliarity(t!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

type ScheduleJob = {
  booking_id: string;
  work_order_id?: string | null;
  work_order_number?: string | null;
  title?: string | null;
  system_status?: string | null;
  booking_status?: string | null;
  customer_name?: string | null;
  technician_name?: string | null;
  contact_name?: string | null;
  contact_businessphone?: string | null;
  crmstart_time?: string | null;
  crmstarttime?: string | null;
  crmend_time?: string | null;
  crmendtime?: string | null;
  city?: string | null;
  state?: string | null;
  day_index: number;
};

function JobChip({ job, compact, colorClass, isConflict }: { job: ScheduleJob; compact: boolean; colorClass: string; isConflict?: boolean }) {
  const isCancelled = (job.system_status ?? "").toLowerCase() === "cancelled";
  const chip = (
    <div
      className={`text-[11px] leading-tight rounded border ${compact ? "px-1 py-0.5" : "px-1.5 py-1"} cursor-default transition-colors ${isCancelled ? cancelledChipColor() : colorClass} ${isConflict ? "ring-2 ring-amber-400 ring-offset-0" : ""}`}
      data-testid={`chip-job-${job.booking_id}`}
    >
      <div className="flex items-center gap-1">
        <span className="font-semibold truncate">{job.work_order_number ?? "WO"}</span>
        {isConflict && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Double-booked" />
        )}
      </div>
      {!compact && (job.crmstarttime || job.crmendtime) && (
        <div className="opacity-80 truncate">
          {fmtTime(job.crmstarttime)}{job.crmendtime ? `–${fmtTime(job.crmendtime)}` : ""}
        </div>
      )}
      {!compact && (
        <div className="opacity-90 truncate">{job.customer_name ?? "—"}</div>
      )}
    </div>
  );

  const inner = job.work_order_id
    ? <Link href={`/work-order/${job.work_order_id}`} className="block">{chip}</Link>
    : chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{inner}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs p-3 space-y-1.5 text-xs">
        <div className="font-bold text-sm">{job.work_order_number ?? "Work Order"}</div>
        {job.title && <div className="text-muted-foreground -mt-1">{job.title}</div>}
        <div className="border-t border-border pt-1.5 space-y-1">
          <div><span className="font-medium text-muted-foreground">Customer:</span> {job.customer_name ?? "—"}</div>
          <div><span className="font-medium text-muted-foreground">Technician:</span> {job.technician_name ?? "—"}</div>
          <div>
            <span className="font-medium text-muted-foreground">Contact:</span>{" "}
            {job.contact_name ?? "—"}
            {job.contact_businessphone && (
              <span className="flex items-center gap-1 mt-0.5">
                <Phone className="h-3 w-3" />{job.contact_businessphone}
              </span>
            )}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">CRM Start:</span>{" "}
            {job.crmstart_time ?? "—"} {fmtTime(job.crmstarttime)}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">CRM End:</span>{" "}
            {job.crmend_time ?? "—"} {fmtTime(job.crmendtime)}
          </div>
          {job.system_status && (
            <div className="pt-0.5">
              <Badge variant="outline" className="text-[10px]">{job.system_status}</Badge>
            </div>
          )}
          {isConflict && (
            <div className="flex items-center gap-1 pt-1 text-amber-600 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              Double-booked — time conflict
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ScheduleBoard() {
  const [view, setView] = useState<ViewMode>("week");
  const [start, setStart] = useState<string>(() => startOfWeekISO(new Date()));
  const [selectedRegions, setSelectedRegions] = useState<Set<string> | null>(null);
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string> | null>(null);

  // Tech view reuses month data from the API.
  const apiView: "week" | "month" = view === "week" ? "week" : "month";
  const { data, isLoading, error } = useGetScheduleBoard(
    { start, view: apiView },
    { query: { queryKey: ["getScheduleBoard", apiView, start] } }
  );

  const { data: unscheduledData } = useGetUnscheduledJobs({
    query: { queryKey: ["getUnscheduledJobs"] },
  });
  const unscheduledJobs = unscheduledData?.jobs ?? [];

  // Time horizon for unscheduled jobs driven by the active view (no separate toggle)
  const unscheduledHorizonDays = view === "week" ? 7 : view === "month" ? 30 : 30;

  const dayCount = data?.day_count ?? (view === "week" ? 7 : 30);
  const rangeStart = data?.range_start ?? start;

  const dayHeaders = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => {
      const iso = addDaysISO(rangeStart, i);
      return { iso, ...fmtDayHeader(iso, view) };
    }),
    [rangeStart, dayCount, view]
  );

  const allRegions = data?.regions ?? [];
  const regions = useMemo(
    () => selectedRegions === null
      ? allRegions
      : allRegions.filter((r) => selectedRegions.has(r.regionid_id)),
    [allRegions, selectedRegions]
  );

  const totalJobs = regions.reduce(
    (s, r) => s + r.technicians.reduce((ts, t) => ts + t.jobs.length, 0),
    0
  );

  // Map selected regionid_ids → region name strings for unscheduled job filtering
  const activeRegionNames = useMemo(() => {
    if (selectedRegions === null) return null;
    return new Set(
      allRegions.filter((r) => selectedRegions.has(r.regionid_id)).map((r) => r.region)
    );
  }, [allRegions, selectedRegions]);

  // Unscheduled jobs filtered by active region + view-derived horizon
  const visibleUnscheduledJobs = useMemo(() => {
    return unscheduledJobs.filter((j) => {
      if (activeRegionNames !== null && (j.region == null || !activeRegionNames.has(j.region))) return false;
      if (!j.due_date) return unscheduledHorizonDays >= 30;
      const diffDays = (new Date(j.due_date + "T00:00:00Z").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return diffDays <= unscheduledHorizonDays;
    });
  }, [unscheduledJobs, activeRegionNames, unscheduledHorizonDays]);

  // Detect double-booked jobs: same tech, same day, overlapping time windows.
  const conflictedBookingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of allRegions) {
      for (const t of r.technicians) {
        const jobs = (t.jobs ?? []) as ScheduleJob[];
        // Group by day_index
        const byDay = new Map<number, ScheduleJob[]>();
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
              const aStart = timeToMins(ja.crmstarttime);
              const aEnd   = timeToMins(ja.crmendtime);
              const bStart = timeToMins(jb.crmstarttime);
              const bEnd   = timeToMins(jb.crmendtime);
              // Need at least start times to compare
              if (aStart == null || bStart == null) continue;
              const aEndE = aEnd ?? aStart + 1;
              const bEndE = bEnd ?? bStart + 1;
              if (aStart < bEndE && aEndE > bStart) {
                ids.add(ja.booking_id);
                ids.add(jb.booking_id);
              }
            }
          }
        }
      }
    }
    return ids;
  }, [allRegions]);

  const toggleRegion = (id: string) => {
    setSelectedRegions((prev) => {
      const current = prev ?? new Set(allRegions.map((r) => r.regionid_id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // If user re-selects everything, drop the filter (back to "all")
      if (next.size === allRegions.length) return null;
      return next;
    });
  };
  const selectAllRegions = () => setSelectedRegions(null);
  const clearRegions = () => setSelectedRegions(new Set());
  const isRegionSelected = (id: string) =>
    selectedRegions === null || selectedRegions.has(id);

  const goPrev = () => setStart(view === "week" ? addDaysISO(start, -7) : addMonthsISO(start, -1));
  const goNext = () => setStart(view === "week" ? addDaysISO(start, 7) : addMonthsISO(start, 1));
  const goToday = () => setStart(view === "week" ? startOfWeekISO(new Date()) : startOfMonthISO(new Date()));

  const onChangeView = (next: ViewMode) => {
    if (next === view) return;
    // When switching, anchor to the equivalent start for the new mode
    const seed = new Date(start + "T00:00:00Z");
    setStart(next === "week" ? startOfWeekISO(seed) : startOfMonthISO(seed));
    setView(next);
  };

  // ---- Per-Tech (printable) view derivations ----
  // Flat list of techs from filtered regions (deduped by technician_id, sorted by name)
  const allTechs = useMemo(() => {
    const m = new Map<string, { id: string; name: string; region: string; jobs: ScheduleJob[] }>();
    for (const r of regions) {
      for (const t of r.technicians) {
        if (!m.has(t.technician_id)) {
          m.set(t.technician_id, {
            id: t.technician_id,
            name: t.resource_name ?? "Unassigned",
            region: r.region,
            jobs: (t.jobs ?? []) as ScheduleJob[],
          });
        }
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [regions]);

  const techsToPrint = useMemo(
    () => selectedTechIds === null
      ? allTechs
      : allTechs.filter((t) => selectedTechIds.has(t.id)),
    [allTechs, selectedTechIds]
  );

  const toggleTech = (id: string) => {
    setSelectedTechIds((prev) => {
      const current = prev ?? new Set(allTechs.map((t) => t.id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === allTechs.length) return null;
      return next;
    });
  };
  const selectAllTechs = () => setSelectedTechIds(null);
  const clearTechs = () => setSelectedTechIds(new Set());
  const isTechSelected = (id: string) =>
    selectedTechIds === null || selectedTechIds.has(id);

  // For tech view, build Mon-Fri × week-rows from the month data.
  // Each week-row keyed by the Monday-of-that-week ISO date.
  const techWeekRows = useMemo(() => {
    if (view !== "tech" || dayCount <= 0) return [] as { mondayISO: string; label: string }[];
    const seen = new Map<string, string>(); // mondayISO -> label like "3/30"
    for (let i = 0; i < dayCount; i++) {
      const iso = addDaysISO(rangeStart, i);
      const d = new Date(iso + "T00:00:00Z");
      const dow = d.getUTCDay(); // 0=Sun..6=Sat
      if (dow === 0 || dow === 6) continue;
      const mondayOffset = dow === 0 ? -6 : 1 - dow;
      const monday = addDaysISO(iso, mondayOffset);
      if (!seen.has(monday)) {
        const md = new Date(monday + "T00:00:00Z");
        seen.set(monday, `${md.getUTCMonth() + 1}/${md.getUTCDate()}`);
      }
    }
    return [...seen.entries()].map(([mondayISO, label]) => ({ mondayISO, label }));
  }, [view, dayCount, rangeStart]);

  // Drop selected tech ids that no longer exist after region/month change
  useEffect(() => {
    if (selectedTechIds === null) return;
    const validIds = new Set(allTechs.map((t) => t.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedTechIds) {
      if (validIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) {
      setSelectedTechIds(next.size === allTechs.length ? null : next);
    }
  }, [allTechs, selectedTechIds]);

  // Combined calendar grid for tech view: mondayISO -> [Mon..Fri][] of {tech,job}
  type TechJobEntry = { tech: { id: string; name: string; region: string }; job: ScheduleJob };
  const combinedGrid = useMemo(() => {
    const grid = new Map<string, TechJobEntry[][]>();
    if (view !== "tech") return grid;
    for (const row of techWeekRows) grid.set(row.mondayISO, [[], [], [], [], []]);
    for (const tech of techsToPrint) {
      for (const j of tech.jobs) {
        const iso = addDaysISO(rangeStart, j.day_index ?? 0);
        const d = new Date(iso + "T00:00:00Z");
        const dow = d.getUTCDay();
        if (dow === 0 || dow === 6) continue;
        const colIdx = dow - 1;
        const monday = addDaysISO(iso, 1 - dow);
        const row = grid.get(monday);
        if (row) row[colIdx].push({ tech: { id: tech.id, name: tech.name, region: tech.region }, job: j });
      }
    }
    return grid;
  }, [view, techsToPrint, techWeekRows, rangeStart]);

  // Grid column template: tech label + N day cells
  // Per-day min width: week → 1fr; month → 80px (forces horizontal scroll)
  const dayColTemplate = view === "week"
    ? `180px repeat(${dayCount}, minmax(0, 1fr))`
    : `180px repeat(${dayCount}, minmax(80px, 1fr))`;
  const minBoardWidth = view === "week" ? 1000 : 180 + dayCount * 80;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="min-h-screen bg-background">
        <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            <Link href="/" data-testid="link-back" className="flex items-center gap-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm font-medium hidden sm:inline">Back</span>
            </Link>
            <span className="text-sidebar-foreground/40 mx-1">|</span>
            <CalendarClock className="h-6 w-6 text-sidebar-primary shrink-0" />
            <h1 className="text-xl font-bold tracking-tight flex-1">Schedule Board</h1>
            <Link
              href="/jobs-by-region"
              className="text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground flex items-center gap-1.5 font-medium"
              data-testid="link-jobs-by-region"
            >
              <Globe className="h-4 w-4" />
              <span className="hidden sm:inline">By Region</span>
            </Link>
            <Link
              href="/unscheduled"
              className="text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground flex items-center gap-1.5 font-medium"
              data-testid="link-unscheduled"
            >
              <Briefcase className="h-4 w-4" />
              <span className="hidden sm:inline">Unscheduled</span>
            </Link>
            <Link
              href="/utilization"
              className="text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground flex items-center gap-1.5 font-medium"
              data-testid="link-utilization"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Utilization</span>
            </Link>
          </div>
        </header>

        <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
          {/* Controls */}
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="icon"
                onClick={goPrev}
                data-testid="btn-prev"
                aria-label={view === "week" ? "Previous week" : "Previous month"}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-base font-semibold tabular-nums px-2 min-w-[200px] text-center" data-testid="text-range">
                {fmtRangeLabel(rangeStart, dayCount, view)}
              </div>
              <Button
                variant="outline" size="icon"
                onClick={goNext}
                data-testid="btn-next"
                aria-label={view === "week" ? "Next week" : "Next month"}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={goToday}
                data-testid="btn-today"
              >
                Today
              </Button>
            </div>

            {/* View toggle */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="inline-flex rounded-md border border-border bg-card overflow-hidden" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "week"}
                  onClick={() => onChangeView("week")}
                  data-testid="btn-view-week"
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    view === "week"
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  Week
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "month"}
                  onClick={() => onChangeView("month")}
                  data-testid="btn-view-month"
                  className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
                    view === "month"
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  Month
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === "tech"}
                  onClick={() => onChangeView("tech")}
                  data-testid="btn-view-tech"
                  className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
                    view === "tech"
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  Per Tech
                </button>
              </div>
              {view === "tech" && allTechs.length > 0 && (
                <Button
                  variant="outline" size="sm"
                  onClick={() => window.print()}
                  data-testid="btn-print"
                  className="gap-1.5"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print
                </Button>
              )}
              {!isLoading && data && (
                <div className="text-sm text-muted-foreground flex gap-3">
                  <span><span className="font-semibold text-foreground">{regions.length}</span>{selectedRegions !== null && <span className="text-muted-foreground">/{allRegions.length}</span>} regions</span>
                  <span>·</span>
                  <span><span className="font-semibold text-foreground">
                    {regions.reduce((s, r) => s + r.technicians.length, 0)}
                  </span> techs</span>
                  <span>·</span>
                  <span><span className="font-semibold text-foreground">{totalJobs}</span> jobs</span>
                </div>
              )}
            </div>
          </div>

          {/* Region filter */}
          {!isLoading && allRegions.length > 0 && (
            <div className="mb-5 flex items-center gap-2 flex-wrap" data-testid="region-filter">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1">
                Filter regions:
              </span>
              {allRegions.map((rg) => {
                const active = isRegionSelected(rg.regionid_id);
                return (
                  <button
                    key={rg.regionid_id}
                    type="button"
                    onClick={() => toggleRegion(rg.regionid_id)}
                    aria-pressed={active}
                    data-testid={`filter-region-${rg.region}`}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-accent"
                    }`}
                  >
                    {rg.region}
                    {rg.company && <span className="ml-1 opacity-70">({rg.company})</span>}
                  </button>
                );
              })}
              <div className="ml-1 flex gap-1">
                <button
                  type="button"
                  onClick={selectAllRegions}
                  data-testid="filter-all"
                  className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  All
                </button>
                <span className="text-muted-foreground text-xs">|</span>
                <button
                  type="button"
                  onClick={clearRegions}
                  data-testid="filter-none"
                  className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  None
                </button>
              </div>
            </div>
          )}

          {/* Tech filter (multi-select) — only in Per Tech view */}
          {view === "tech" && !isLoading && allTechs.length > 0 && (
            <div className="mb-5 flex items-start gap-2 flex-wrap print:hidden" data-testid="tech-filter">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1 pt-1.5">
                Technicians:
              </span>
              {allTechs.map((t) => {
                const active = isTechSelected(t.id);
                const palette = techColor(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTech(t.id)}
                    aria-pressed={active}
                    data-testid={`filter-tech-${t.id}`}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors inline-flex items-center gap-1.5 ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:bg-accent"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${palette.dot}`} aria-hidden />
                    {t.name}
                  </button>
                );
              })}
              <div className="ml-1 flex gap-1 pt-0.5">
                <button
                  type="button"
                  onClick={selectAllTechs}
                  data-testid="filter-tech-all"
                  className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  All
                </button>
                <span className="text-muted-foreground text-xs">|</span>
                <button
                  type="button"
                  onClick={clearTechs}
                  data-testid="filter-tech-none"
                  className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  None
                </button>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
            </div>
          )}

          {error && (
            <div className="text-center py-20 text-destructive" data-testid="error-schedule-board">
              <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
              <p className="font-medium">Failed to load schedule board.</p>
            </div>
          )}

          {view !== "tech" && !isLoading && !error && regions.length === 0 && (
            <div className="text-center py-20 text-muted-foreground" data-testid="empty-schedule">
              <CalendarClock className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No regions configured.</p>
            </div>
          )}

          {/* Per-Tech printable view — single combined calendar with one or more techs */}
          {view === "tech" && !isLoading && !error && techsToPrint.length > 0 && (
            <div data-testid="tech-view">
              <Card
                className="overflow-hidden border-2 border-foreground/80 shadow-sm print:shadow-none bg-white"
                data-testid="tech-combined-card"
              >
                {/* Header: tech name(s) with color dots */}
                <div className="px-6 py-4 border-b-2 border-foreground/80 flex items-center justify-between gap-4 bg-white flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap min-w-0">
                    {techsToPrint.length === 1 ? (
                      <>
                        <span className={`h-3 w-3 rounded-full ${techColor(techsToPrint[0].id).dot} print:hidden`} aria-hidden />
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                          {techsToPrint[0].name}
                        </h2>
                        <span className="text-xs px-2 py-0.5 rounded border border-foreground/30 font-mono font-semibold text-foreground/70">
                          {techsToPrint[0].region}
                        </span>
                      </>
                    ) : (
                      <>
                        <h2 className="text-2xl font-bold tracking-tight text-foreground">
                          {techsToPrint.length} Technicians
                        </h2>
                        <div className="flex items-center gap-2 flex-wrap">
                          {techsToPrint.map((t) => {
                            const palette = techColor(t.id);
                            return (
                              <span
                                key={t.id}
                                className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground/80"
                                data-testid={`tech-legend-${t.id}`}
                              >
                                <span className={`h-2.5 w-2.5 rounded-full ${palette.dot}`} aria-hidden />
                                {t.name}
                              </span>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <CardContent className="p-0 overflow-x-auto">
                  <div style={{ minWidth: "1060px" }}>
                  {/* Day headers Mon-Fri */}
                  <div
                    className="grid border-b-2 border-foreground/80 bg-white"
                    style={{ gridTemplateColumns: "60px repeat(5, 200px)" }}
                  >
                    <div className="border-r border-foreground/40" />
                    {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((d) => (
                      <div key={d} className="px-2 py-2 text-sm font-bold text-center border-r border-foreground/40 last:border-r-0 text-foreground">
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Week rows */}
                  {techWeekRows.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground italic">
                      No weekdays in this range.
                    </div>
                  )}
                  {techWeekRows.map((row) => {
                    const cols = combinedGrid.get(row.mondayISO) ?? [[], [], [], [], []];
                    return (
                      <div
                        key={row.mondayISO}
                        className="grid border-b border-foreground/40 last:border-b-0 min-h-[140px]"
                        style={{ gridTemplateColumns: "60px repeat(5, 200px)" }}
                        data-testid={`week-row-${row.mondayISO}`}
                      >
                        <div className="px-2 py-3 border-r border-foreground/40 text-sm font-bold text-foreground/70 tabular-nums">
                          {row.label}
                        </div>
                        {cols.map((entries, i) => (
                          <div
                            key={i}
                            className="px-2 py-2 border-r border-foreground/40 last:border-r-0 space-y-2"
                            data-testid={`tech-cell-${row.mondayISO}-${i}`}
                          >
                            {entries.map(({ tech, job: j }) => {
                              const isCancelled = (j.system_status ?? "").toLowerCase() === "cancelled";
                              const palette = techColor(tech.id);
                              const isConflict = conflictedBookingIds.has(j.booking_id);
                              return (
                                <Link
                                  key={j.booking_id}
                                  href={j.work_order_id ? `/work-orders/${j.work_order_id}` : "#"}
                                  className={`block text-[11px] leading-tight rounded border-l-4 pl-1.5 ${palette.chip.replace(/hover:bg-\S+/g, "").trim()} ${isCancelled ? "opacity-50 line-through" : ""} ${isConflict ? "ring-2 ring-amber-400" : ""}`}
                                  style={{ borderLeftColor: "currentColor" }}
                                  data-testid={`tech-job-${j.booking_id}`}
                                >
                                  {isConflict && (
                                    <div className="flex items-center gap-0.5 text-amber-600 font-semibold">
                                      <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                      <span>Conflict</span>
                                    </div>
                                  )}
                                  {techsToPrint.length > 1 && (
                                    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide opacity-80">
                                      <span className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} aria-hidden />
                                      {tech.name}
                                    </div>
                                  )}
                                  <div className="font-bold text-foreground truncate">
                                    {j.customer_name ?? "—"}
                                  </div>
                                  {(j.city || j.state) && (
                                    <div className="text-foreground/70 truncate">
                                      {[j.city, j.state].filter(Boolean).join(", ")}
                                    </div>
                                  )}
                                  {(j.crmstarttime || j.crmendtime) && (
                                    <div className="text-foreground/70 tabular-nums">
                                      {fmtTime(j.crmstarttime)}{j.crmendtime ? `–${fmtTime(j.crmendtime)}` : ""}
                                      {fmtDuration(j.crmstarttime, j.crmendtime) && (
                                        <span className="ml-1 text-foreground/60">· {fmtDuration(j.crmstarttime, j.crmendtime)}</span>
                                      )}
                                    </div>
                                  )}
                                  <div className="font-mono font-semibold text-foreground tabular-nums">
                                    {j.work_order_number ?? "—"}
                                  </div>
                                  <div className="text-foreground/60 font-semibold">
                                    ({statusCode(j.system_status)})
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  </div>
                </CardContent>

                {/* Footer: month + year */}
                <div className="px-6 py-3 border-t-2 border-foreground/80 text-center text-sm font-bold uppercase tracking-widest text-foreground bg-white">
                  {fmtRangeLabel(rangeStart, dayCount, "month")}
                </div>
              </Card>
            </div>
          )}

          {view === "tech" && !isLoading && !error && techsToPrint.length === 0 && (
            <div className="text-center py-20 text-muted-foreground" data-testid="empty-tech">
              <User className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No technicians match the current filters.</p>
            </div>
          )}

          {view !== "tech" && !isLoading && !error && regions.length > 0 && (
            <div className="space-y-6">
              {regions.map((rg) => {
                const regionJobCount = rg.technicians.reduce((s, t) => s + t.jobs.length, 0);

                return (
                  <Card key={rg.regionid_id} className="overflow-hidden border border-card-border shadow-sm" data-testid={`region-${rg.region}`}>
                    <div className="bg-sidebar text-sidebar-foreground px-4 py-3 flex items-center gap-3 flex-wrap">
                      <Globe className="h-5 w-5 text-sidebar-primary" />
                      <span className="text-lg font-bold">{rg.region}</span>
                      {rg.company && (
                        <span className="text-xs px-2 py-0.5 rounded bg-sidebar-accent text-sidebar-accent-foreground font-mono font-semibold">
                          {rg.company}
                        </span>
                      )}
                      <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                        {rg.technicians.length} techs
                      </Badge>
                      <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                        {regionJobCount} jobs
                      </Badge>
                    </div>

                    <CardContent className="p-0 overflow-x-auto">
                      <div style={{ minWidth: `${minBoardWidth}px` }}>
                        {/* Day headers */}
                        <div
                          className="grid bg-muted border-b border-border"
                          style={{ gridTemplateColumns: dayColTemplate }}
                        >
                          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-r border-border">
                            Technician
                          </div>
                          {dayHeaders.map((dh) => (
                            <div key={dh.iso} className="px-2 py-2 text-xs font-semibold text-center border-r border-border last:border-r-0">
                              <div className="text-foreground">{dh.dow}</div>
                              <div className="text-muted-foreground font-normal">{dh.date}</div>
                            </div>
                          ))}
                        </div>

                        {rg.technicians.length === 0 && (
                          <div className="px-4 py-6 text-sm text-muted-foreground italic">
                            No technicians in this region.
                          </div>
                        )}
                        {rg.technicians.map((tech) => {
                          const palette = techColor(tech.technician_id);
                          const jobsByDay: ScheduleJob[][] = Array.from({ length: dayCount }, () => []);
                          for (const j of tech.jobs) {
                            const idx = Math.max(0, Math.min(dayCount - 1, j.day_index ?? 0));
                            jobsByDay[idx].push(j as ScheduleJob);
                          }
                          // Sort jobs within each day by start time ascending
                          for (const dayJobs of jobsByDay) {
                            dayJobs.sort((a, b) => {
                              const am = timeToMins(a.crmstarttime);
                              const bm = timeToMins(b.crmstarttime);
                              if (am == null && bm == null) return 0;
                              if (am == null) return 1;
                              if (bm == null) return -1;
                              return am - bm;
                            });
                          }
                          return (
                            <div
                              key={tech.technician_id}
                              className="grid border-b border-border last:border-b-0 hover:bg-accent/20"
                              style={{ gridTemplateColumns: dayColTemplate }}
                              data-testid={`row-tech-${tech.technician_id}`}
                            >
                              <div className="px-3 py-2 border-r border-border flex items-start gap-2">
                                <span
                                  className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${palette.dot}`}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-foreground truncate">
                                    {tech.resource_name ?? "Unassigned"}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {tech.jobs.length} job{tech.jobs.length !== 1 ? "s" : ""}
                                  </div>
                                </div>
                              </div>
                              {jobsByDay.map((jobs, i) => (
                                <div
                                  key={i}
                                  className="border-r border-border last:border-r-0 p-1 space-y-1 min-h-[60px]"
                                  data-testid={`cell-${tech.technician_id}-${i}`}
                                >
                                  {jobs.map((j) => (
                                    <JobChip
                                      key={j.booking_id}
                                      job={j}
                                      compact={view === "month"}
                                      colorClass={palette.chip}
                                      isConflict={conflictedBookingIds.has(j.booking_id)}
                                    />
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {!isLoading && (() => {
            const buckets: UnscheduledJob[][] = [[], [], []];
            for (const j of visibleUnscheduledJobs) buckets[getBucketIndex(j.due_date)].push(j);
            buckets.forEach((b) => b.sort(sortByDue));
            const horizonLabel = view === "week" ? "next 7 days" : "next 30 days";
            return (
              <div className="mt-6 space-y-3" data-testid="card-unscheduled-jobs">
                {/* Section header */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Unscheduled Jobs</h2>
                  <Badge variant="secondary" className="ml-1 text-[10px]">{visibleUnscheduledJobs.length}</Badge>
                  <span className="text-xs text-muted-foreground">· due within {horizonLabel}</span>
                  {activeRegionNames !== null && (
                    <span className="text-xs text-muted-foreground">
                      · {activeRegionNames.size} region{activeRegionNames.size !== 1 ? "s" : ""} selected
                    </span>
                  )}
                </div>

                {visibleUnscheduledJobs.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground italic bg-card border border-card-border rounded-lg">
                    No unscheduled jobs match the current filters.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {UNSCHEDULED_BUCKETS.map((bucket, bi) => (
                      <div
                        key={bi}
                        className={`rounded-lg border-2 ${bucket.border} overflow-hidden`}
                        data-testid={`unscheduled-bucket-${bi}`}
                      >
                        {/* Bucket header */}
                        <div className={`px-4 py-2.5 flex items-center gap-2 ${bucket.headerClass}`}>
                          <span className="text-sm font-semibold">{bucket.label}</span>
                          <span className="text-xs opacity-70">{bucket.sublabel}</span>
                          <span className={`ml-auto text-xs font-semibold px-1.5 py-0.5 rounded ${bucket.badgeClass}`}>
                            {buckets[bi].length}
                          </span>
                        </div>

                        {/* Horizontal card strip */}
                        <div className="bg-slate-50/60 px-3 py-3 overflow-x-auto">
                          {buckets[bi].length === 0 ? (
                            <div className="text-center text-xs text-muted-foreground italic py-4 min-h-[60px] flex items-center justify-center">
                              No jobs in this window
                            </div>
                          ) : (
                            <div className="flex gap-3 pb-1">
                              {buckets[bi].map((job) => (
                                <UnscheduledJobCard
                                  key={job.work_order_id ?? job.work_order_number}
                                  job={job}
                                  bucketIdx={bi}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {view !== "tech" && !isLoading && totalJobs === 0 && regions.length > 0 && (
            <div className="mt-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Briefcase className="h-4 w-4" />
              No jobs scheduled this {view}. Try a different {view}.
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
