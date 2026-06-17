import { useEffect, useMemo, useState } from "react";
import {
  useGetWbScheduleBoard,
  type WbWorkOrder,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Globe,
  Phone,
  Briefcase,
  AlertTriangle,
  Printer,
  User,
} from "lucide-react";
import { EditBookingDialog } from "@/components/EditBookingDialog";

type ViewMode = "week" | "month" | "tech";

function statusCode(s: string | null | undefined): string {
  switch ((s ?? "").toLowerCase()) {
    case "scheduled":
      return "SCH";
    case "completed":
      return "CMP";
    case "in progress":
      return "IP";
    case "cancelled":
      return "CAN";
    case "invoiced":
      return "INV";
    default:
      return (s ?? "").slice(0, 3).toUpperCase() || "—";
  }
}

function startOfWeekISO(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
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
    .toISOString()
    .slice(0, 10);
}

function fmtDayHeader(iso: string, mode: ViewMode): { dow: string; date: string } {
  const d = new Date(iso + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date:
      mode === "week"
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
  { chip: "bg-blue-100   text-blue-900   border-blue-400   hover:bg-blue-200", dot: "bg-blue-500" },
  { chip: "bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200", dot: "bg-emerald-500" },
  { chip: "bg-amber-100  text-amber-900  border-amber-400  hover:bg-amber-200", dot: "bg-amber-500" },
  { chip: "bg-rose-100   text-rose-900   border-rose-400   hover:bg-rose-200", dot: "bg-rose-500" },
  { chip: "bg-violet-100 text-violet-900 border-violet-400 hover:bg-violet-200", dot: "bg-violet-500" },
  { chip: "bg-cyan-100   text-cyan-900   border-cyan-400   hover:bg-cyan-200", dot: "bg-cyan-500" },
  { chip: "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-400 hover:bg-fuchsia-200", dot: "bg-fuchsia-500" },
  { chip: "bg-lime-100   text-lime-900   border-lime-500   hover:bg-lime-200", dot: "bg-lime-500" },
  { chip: "bg-orange-100 text-orange-900 border-orange-400 hover:bg-orange-200", dot: "bg-orange-500" },
  { chip: "bg-teal-100   text-teal-900   border-teal-400   hover:bg-teal-200", dot: "bg-teal-500" },
  { chip: "bg-pink-100   text-pink-900   border-pink-400   hover:bg-pink-200", dot: "bg-pink-500" },
  { chip: "bg-indigo-100 text-indigo-900 border-indigo-400 hover:bg-indigo-200", dot: "bg-indigo-500" },
  { chip: "bg-sky-100    text-sky-900    border-sky-400    hover:bg-sky-200", dot: "bg-sky-500" },
  { chip: "bg-yellow-100 text-yellow-900 border-yellow-500 hover:bg-yellow-200", dot: "bg-yellow-500" },
  { chip: "bg-red-100    text-red-900    border-red-400    hover:bg-red-200", dot: "bg-red-500" },
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
  start_time?: string | null;
  end_time?: string | null;
  city?: string | null;
  state?: string | null;
  day_index: number;
};

// Build the shape EditBookingDialog expects (WbWorkOrder) from a board tile.
function buildEditRow(job: ScheduleJob, technicianId: string): WbWorkOrder {
  return {
    work_order_id: job.work_order_id ?? "",
    work_order_number: job.work_order_number ?? null,
    title: job.title ?? null,
    system_status: job.system_status ?? null,
    customer_name: job.customer_name ?? null,
    booking_id: job.booking_id,
    booking_status: job.booking_status ?? null,
    start_time: job.start_time ?? null,
    end_time: job.end_time ?? null,
    technician_id: technicianId,
    technician_name: job.technician_name ?? null,
    pending_writeback: null,
  };
}

function JobChip({
  job,
  compact,
  colorClass,
  isConflict,
  onOpen,
}: {
  job: ScheduleJob;
  compact: boolean;
  colorClass: string;
  isConflict?: boolean;
  onOpen: () => void;
}) {
  const isCancelled = (job.system_status ?? "").toLowerCase() === "cancelled";
  const chip = (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full text-left text-[11px] leading-tight rounded border ${compact ? "px-1 py-0.5" : "px-1.5 py-1"} cursor-pointer transition-colors ${isCancelled ? cancelledChipColor() : colorClass} ${isConflict ? "ring-2 ring-amber-400 ring-offset-0" : ""}`}
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
          {fmtTime(job.crmstarttime)}
          {job.crmendtime ? `–${fmtTime(job.crmendtime)}` : ""}
        </div>
      )}
      {!compact && <div className="opacity-90 truncate">{job.customer_name ?? "—"}</div>}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs p-3 space-y-1.5 text-xs">
        <div className="font-bold text-sm">{job.work_order_number ?? "Work Order"}</div>
        {job.title && <div className="text-muted-foreground -mt-1">{job.title}</div>}
        <div className="border-t border-border pt-1.5 space-y-1">
          <div>
            <span className="font-medium text-muted-foreground">Customer:</span>{" "}
            {job.customer_name ?? "—"}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">Technician:</span>{" "}
            {job.technician_name ?? "—"}
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
              <Badge variant="outline" className="text-[10px]">
                {job.system_status}
              </Badge>
            </div>
          )}
          {isConflict && (
            <div className="flex items-center gap-1 pt-1 text-amber-600 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              Double-booked — time conflict
            </div>
          )}
          <div className="pt-1 text-[10px] text-muted-foreground italic">Click tile to edit booking</div>
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
  const [editing, setEditing] = useState<WbWorkOrder | null>(null);

  // Tech view reuses month data from the API.
  const apiView: "week" | "month" = view === "week" ? "week" : "month";
  const { data, isLoading, error } = useGetWbScheduleBoard({ start, view: apiView });

  const dayCount = data?.day_count ?? (view === "week" ? 7 : 30);
  const rangeStart = data?.range_start ?? start;

  const dayHeaders = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const iso = addDaysISO(rangeStart, i);
        return { iso, ...fmtDayHeader(iso, view) };
      }),
    [rangeStart, dayCount, view],
  );

  const allRegions = data?.regions ?? [];
  const regions = useMemo(
    () =>
      selectedRegions === null
        ? allRegions
        : allRegions.filter((r) => selectedRegions.has(r.regionid_id)),
    [allRegions, selectedRegions],
  );

  const totalJobs = regions.reduce(
    (s, r) => s + r.technicians.reduce((ts, t) => ts + t.jobs.length, 0),
    0,
  );

  // Detect double-booked jobs: same tech, same day, overlapping time windows.
  const conflictedBookingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of allRegions) {
      for (const t of r.technicians) {
        const jobs = (t.jobs ?? []) as ScheduleJob[];
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
              const aEnd = timeToMins(ja.crmendtime);
              const bStart = timeToMins(jb.crmstarttime);
              const bEnd = timeToMins(jb.crmendtime);
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
      if (next.size === allRegions.length) return null;
      return next;
    });
  };
  const selectAllRegions = () => setSelectedRegions(null);
  const clearRegions = () => setSelectedRegions(new Set());
  const isRegionSelected = (id: string) => selectedRegions === null || selectedRegions.has(id);

  const goPrev = () => setStart(view === "week" ? addDaysISO(start, -7) : addMonthsISO(start, -1));
  const goNext = () => setStart(view === "week" ? addDaysISO(start, 7) : addMonthsISO(start, 1));
  const goToday = () =>
    setStart(view === "week" ? startOfWeekISO(new Date()) : startOfMonthISO(new Date()));

  const onChangeView = (next: ViewMode) => {
    if (next === view) return;
    const seed = new Date(start + "T00:00:00Z");
    setStart(next === "week" ? startOfWeekISO(seed) : startOfMonthISO(seed));
    setView(next);
  };

  // ---- Per-Tech (printable) view derivations ----
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
    () =>
      selectedTechIds === null ? allTechs : allTechs.filter((t) => selectedTechIds.has(t.id)),
    [allTechs, selectedTechIds],
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
  const isTechSelected = (id: string) => selectedTechIds === null || selectedTechIds.has(id);

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

  // Weekday-only headers (Mon–Fri) for the Calendar view
  const weekdayHeaders = useMemo(
    () =>
      dayHeaders
        .map((dh, i) => ({ ...dh, dayIdx: i }))
        .filter(({ iso }) => {
          const dow = new Date(iso + "T00:00:00Z").getUTCDay();
          return dow >= 1 && dow <= 5;
        })
        .map((dh) => ({
          ...dh,
          isMonday: new Date(dh.iso + "T00:00:00Z").getUTCDay() === 1,
        })),
    [dayHeaders],
  );

  const dayColTemplate =
    view === "week"
      ? `180px repeat(${dayCount}, minmax(0, 1fr))`
      : `180px repeat(${dayCount}, minmax(80px, 1fr))`;
  const minBoardWidth = view === "week" ? 1000 : 180 + dayCount * 80;

  const techCalColTemplate = `160px repeat(${weekdayHeaders.length}, minmax(140px, 1fr))`;
  const minTechCalWidth = 160 + weekdayHeaders.length * 140;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule Board</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Live from the d365crm database, grouped by region and technician. Click a job tile to stage a booking write-back.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goPrev}
            data-testid="btn-prev"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div
            className="text-base font-semibold tabular-nums px-2 min-w-[200px] text-center"
            data-testid="text-range"
          >
            {fmtRangeLabel(rangeStart, dayCount, view)}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={goNext}
            data-testid="btn-next"
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} data-testid="btn-today">
            Today
          </Button>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="inline-flex rounded-md border border-border bg-card overflow-hidden"
            role="tablist"
          >
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
              Calendar
            </button>
          </div>
          {view === "tech" && allTechs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
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
              <span>
                <span className="font-semibold text-foreground">{regions.length}</span>
                {selectedRegions !== null && (
                  <span className="text-muted-foreground">/{allRegions.length}</span>
                )}{" "}
                regions
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-foreground">
                  {regions.reduce((s, r) => s + r.technicians.length, 0)}
                </span>{" "}
                techs
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-foreground">{totalJobs}</span> jobs
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Region filter */}
      {!isLoading && allRegions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="region-filter">
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

      {/* Tech filter (multi-select) — only in Calendar view */}
      {view === "tech" && !isLoading && allTechs.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap print:hidden" data-testid="tech-filter">
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
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
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

      {/* Calendar view — one row per technician, weekday columns (Mon–Fri), grouped by region */}
      {view === "tech" && !isLoading && !error && techsToPrint.length > 0 && (
        <div data-testid="tech-view" className="space-y-6">
          {regions.map((rg) => {
            const techsInRegion = rg.technicians.filter(
              (t) => selectedTechIds === null || selectedTechIds.has(t.technician_id),
            );
            if (techsInRegion.length === 0) return null;
            const regionJobCount = techsInRegion.reduce((s, t) => s + t.jobs.length, 0);
            return (
              <Card
                key={rg.regionid_id}
                className="overflow-hidden border-2 border-foreground/80 shadow-sm print:shadow-none bg-white"
                data-testid={`tech-region-${rg.regionid_id}`}
              >
                {/* Region header */}
                <div className="px-4 py-3 border-b-2 border-foreground/80 flex items-center gap-3 bg-white flex-wrap">
                  <Globe className="h-4 w-4 text-foreground/70" />
                  <span className="text-base font-bold text-foreground">{rg.region}</span>
                  {rg.company && (
                    <span className="text-xs px-2 py-0.5 rounded border border-foreground/30 font-mono font-semibold text-foreground/70">
                      {rg.company}
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {techsInRegion.length} tech{techsInRegion.length !== 1 ? "s" : ""} · {regionJobCount} job
                    {regionJobCount !== 1 ? "s" : ""}
                  </Badge>
                </div>

                <CardContent className="p-0 overflow-x-auto">
                  <div style={{ minWidth: `${minTechCalWidth}px` }}>
                    {/* Day-of-week headers */}
                    <div
                      className="grid bg-white border-b-2 border-foreground/80"
                      style={{ gridTemplateColumns: techCalColTemplate }}
                    >
                      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/60 border-r border-foreground/40">
                        Technician
                      </div>
                      {weekdayHeaders.map((dh) => (
                        <div
                          key={dh.iso}
                          className={`px-1.5 py-2 text-xs font-bold text-center border-r border-foreground/20 last:border-r-0 ${dh.isMonday ? "border-l-2 border-l-foreground/40" : ""}`}
                        >
                          <div className="text-foreground">{dh.dow}</div>
                          <div className="text-foreground/60 font-normal">{dh.date}</div>
                        </div>
                      ))}
                    </div>

                    {/* One row per technician */}
                    {techsInRegion.map((tech) => {
                      const palette = techColor(tech.technician_id);
                      const jobsByWeekday = weekdayHeaders.map(({ dayIdx }) => {
                        const jobs = (tech.jobs as ScheduleJob[]).filter(
                          (j) => j.day_index === dayIdx,
                        );
                        return jobs.sort((a, b) => {
                          const am = timeToMins(a.crmstarttime);
                          const bm = timeToMins(b.crmstarttime);
                          if (am == null && bm == null) return 0;
                          if (am == null) return 1;
                          if (bm == null) return -1;
                          return am - bm;
                        });
                      });
                      return (
                        <div
                          key={tech.technician_id}
                          className="grid border-b border-foreground/20 last:border-b-0 hover:bg-accent/10"
                          style={{ gridTemplateColumns: techCalColTemplate }}
                          data-testid={`row-tech-${tech.technician_id}`}
                        >
                          <div className="px-2 py-2 border-r border-foreground/40 flex items-start gap-1.5">
                            <span
                              className={`mt-1 h-2 w-2 rounded-full shrink-0 ${palette.dot}`}
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-foreground leading-tight truncate">
                                {tech.resource_name ?? "Unassigned"}
                              </div>
                              <div className="text-[10px] text-foreground/50">
                                {tech.jobs.length} job{tech.jobs.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                          </div>
                          {jobsByWeekday.map((jobs, i) => {
                            const dh = weekdayHeaders[i];
                            return (
                              <div
                                key={i}
                                className={`border-r border-foreground/20 last:border-r-0 p-1 space-y-1 min-h-[60px] ${dh.isMonday ? "border-l-2 border-l-foreground/20" : ""}`}
                                data-testid={`tech-cell-${tech.technician_id}-${dh.dayIdx}`}
                              >
                                {jobs.map((j) => {
                                  const isCancelled =
                                    (j.system_status ?? "").toLowerCase() === "cancelled";
                                  const isConflict = conflictedBookingIds.has(j.booking_id);
                                  return (
                                    <button
                                      type="button"
                                      key={j.booking_id}
                                      onClick={() => setEditing(buildEditRow(j, tech.technician_id))}
                                      className={`block w-full text-left text-[11px] leading-tight rounded border-l-4 pl-1.5 py-1 pr-1 cursor-pointer ${palette.chip.replace(/hover:bg-\S+/g, "").trim()} ${isCancelled ? "opacity-50 line-through" : ""} ${isConflict ? "ring-2 ring-amber-400 ring-offset-0" : ""}`}
                                      style={{ borderLeftColor: "currentColor" }}
                                      data-testid={`tech-job-${j.booking_id}`}
                                    >
                                      {isConflict && (
                                        <div className="flex items-center gap-0.5 text-amber-600 font-semibold mb-0.5">
                                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                          <span>Conflict</span>
                                        </div>
                                      )}
                                      <div className="font-bold truncate">{j.customer_name ?? "—"}</div>
                                      {(j.city || j.state) && (
                                        <div className="opacity-70 truncate">
                                          {[j.city, j.state].filter(Boolean).join(", ")}
                                        </div>
                                      )}
                                      {(j.crmstarttime || j.crmendtime) && (
                                        <div className="opacity-70 tabular-nums">
                                          {fmtTime(j.crmstarttime)}
                                          {j.crmendtime ? `–${fmtTime(j.crmendtime)}` : ""}
                                          {fmtDuration(j.crmstarttime, j.crmendtime) && (
                                            <span className="ml-1 opacity-80">
                                              · {fmtDuration(j.crmstarttime, j.crmendtime)}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div className="font-mono font-semibold tabular-nums">
                                        {j.work_order_number ?? "—"}
                                      </div>
                                      <div className="opacity-60 font-semibold">
                                        ({statusCode(j.system_status)})
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>

                <div className="px-4 py-2.5 border-t-2 border-foreground/80 text-center text-xs font-bold uppercase tracking-widest text-foreground bg-white">
                  {fmtRangeLabel(rangeStart, dayCount, "month")}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view === "tech" && !isLoading && !error && techsToPrint.length === 0 && (
        <div className="text-center py-20 text-muted-foreground" data-testid="empty-tech">
          <User className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">No technicians match the current filters.</p>
        </div>
      )}

      {/* Week / Month grid view */}
      {view !== "tech" && !isLoading && !error && regions.length > 0 && (
        <div className="space-y-6">
          {regions.map((rg) => {
            const regionJobCount = rg.technicians.reduce((s, t) => s + t.jobs.length, 0);

            return (
              <Card
                key={rg.regionid_id}
                className="overflow-hidden border border-card-border shadow-sm"
                data-testid={`region-${rg.region}`}
              >
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
                        <div
                          key={dh.iso}
                          className="px-2 py-2 text-xs font-semibold text-center border-r border-border last:border-r-0"
                        >
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
                      for (const j of tech.jobs as ScheduleJob[]) {
                        const idx = Math.max(0, Math.min(dayCount - 1, j.day_index ?? 0));
                        jobsByDay[idx].push(j);
                      }
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
                                  onOpen={() => setEditing(buildEditRow(j, tech.technician_id))}
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

      {view !== "tech" && !isLoading && totalJobs === 0 && regions.length > 0 && (
        <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Briefcase className="h-4 w-4" />
          No jobs scheduled this {view}. Try a different {view}.
        </div>
      )}

      {editing && <EditBookingDialog row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
