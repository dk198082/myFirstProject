import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useGetScheduleBoard } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft, CalendarClock, ChevronLeft, ChevronRight,
  Globe, User, Phone, Briefcase, AlertTriangle,
} from "lucide-react";

type ViewMode = "week" | "month";

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
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function statusColor(s: string | null | undefined) {
  switch ((s ?? "").toLowerCase()) {
    case "completed":   return "bg-green-100 text-green-800 border-green-300 hover:bg-green-200";
    case "scheduled":   return "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200";
    case "in progress": return "bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-200";
    case "cancelled":   return "bg-gray-100 text-gray-500 border-gray-300 hover:bg-gray-200";
    case "invoiced":    return "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200";
    default:            return "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200";
  }
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
  day_index: number;
};

function JobChip({ job, compact }: { job: ScheduleJob; compact: boolean }) {
  const chip = (
    <div
      className={`text-[11px] leading-tight rounded border ${compact ? "px-1 py-0.5" : "px-1.5 py-1"} cursor-default transition-colors ${statusColor(job.system_status)}`}
      data-testid={`chip-job-${job.booking_id}`}
    >
      <div className="font-semibold truncate">{job.work_order_number ?? "WO"}</div>
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
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function ScheduleBoard() {
  const [view, setView] = useState<ViewMode>("week");
  const [start, setStart] = useState<string>(() => startOfWeekISO(new Date()));

  const { data, isLoading, error } = useGetScheduleBoard(
    { start, view },
    { query: { queryKey: ["getScheduleBoard", view, start] } }
  );

  const dayCount = data?.day_count ?? (view === "week" ? 7 : 30);
  const rangeStart = data?.range_start ?? start;

  const dayHeaders = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => {
      const iso = addDaysISO(rangeStart, i);
      return { iso, ...fmtDayHeader(iso, view) };
    }),
    [rangeStart, dayCount, view]
  );

  const regions = data?.regions ?? [];

  const totalJobs = regions.reduce(
    (s, r) => s + r.technicians.reduce((ts, t) => ts + t.jobs.length, 0),
    0
  );

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
              </div>
              {!isLoading && data && (
                <div className="text-sm text-muted-foreground flex gap-3">
                  <span><span className="font-semibold text-foreground">{regions.length}</span> regions</span>
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

          {!isLoading && !error && regions.length === 0 && (
            <div className="text-center py-20 text-muted-foreground" data-testid="empty-schedule">
              <CalendarClock className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No regions configured.</p>
            </div>
          )}

          {!isLoading && !error && regions.length > 0 && (
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
                          const jobsByDay: ScheduleJob[][] = Array.from({ length: dayCount }, () => []);
                          for (const j of tech.jobs) {
                            const idx = Math.max(0, Math.min(dayCount - 1, j.day_index ?? 0));
                            jobsByDay[idx].push(j as ScheduleJob);
                          }
                          return (
                            <div
                              key={tech.technician_id}
                              className="grid border-b border-border last:border-b-0 hover:bg-accent/20"
                              style={{ gridTemplateColumns: dayColTemplate }}
                              data-testid={`row-tech-${tech.technician_id}`}
                            >
                              <div className="px-3 py-2 border-r border-border flex items-start gap-1.5">
                                <User className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
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
                                  {jobs.map((j) => <JobChip key={j.booking_id} job={j} compact={view === "month"} />)}
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

          {!isLoading && totalJobs === 0 && regions.length > 0 && (
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
