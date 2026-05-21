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

function startOfWeekISO(d: Date): string {
  // Monday as week start
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1 - day);
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDayHeader(iso: string): { dow: string; date: string } {
  const d = new Date(iso + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
}

function fmtWeekRange(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00Z");
  const end = new Date(weekStart + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(end)}, ${start.getUTCFullYear()}`;
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  // "HH:MM:SS" → "HH:MM"
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

function JobChip({ job }: { job: ScheduleJob }) {
  const chip = (
    <div
      className={`text-[11px] leading-tight rounded border px-1.5 py-1 cursor-default transition-colors ${statusColor(job.system_status)}`}
      data-testid={`chip-job-${job.booking_id}`}
    >
      <div className="font-semibold truncate">{job.work_order_number ?? "WO"}</div>
      {(job.crmstarttime || job.crmendtime) && (
        <div className="opacity-80 truncate">
          {fmtTime(job.crmstarttime)}{job.crmendtime ? `–${fmtTime(job.crmendtime)}` : ""}
        </div>
      )}
      <div className="opacity-90 truncate">{job.customer_name ?? "—"}</div>
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

const DAYS = [0, 1, 2, 3, 4, 5, 6];

export default function ScheduleBoard() {
  const [weekStart, setWeekStart] = useState<string>(() => startOfWeekISO(new Date()));

  const dayHeaders = useMemo(
    () => DAYS.map((i) => ({ iso: addDaysISO(weekStart, i), ...fmtDayHeader(addDaysISO(weekStart, i)) })),
    [weekStart]
  );

  const { data, isLoading, error } = useGetScheduleBoard(
    { weekStart },
    { query: { queryKey: ["getScheduleBoard", weekStart] } }
  );

  const regions = data?.regions ?? [];

  const totalJobs = regions.reduce(
    (s, r) => s + r.technicians.reduce((ts, t) => ts + t.jobs.length, 0),
    0
  );

  return (
    <TooltipProvider delayDuration={120}>
      <div className="min-h-screen bg-background">
        {/* Header */}
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
          {/* Week controls */}
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="icon"
                onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
                data-testid="btn-prev-week" aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="text-base font-semibold tabular-nums px-2 min-w-[180px] text-center" data-testid="text-week-range">
                {fmtWeekRange(weekStart)}
              </div>
              <Button
                variant="outline" size="icon"
                onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
                data-testid="btn-next-week" aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => setWeekStart(startOfWeekISO(new Date()))}
                data-testid="btn-today"
              >
                Today
              </Button>
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

          {/* Loading */}
          {isLoading && (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-center py-20 text-destructive" data-testid="error-schedule-board">
              <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
              <p className="font-medium">Failed to load schedule board.</p>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !error && regions.length === 0 && (
            <div className="text-center py-20 text-muted-foreground" data-testid="empty-schedule">
              <CalendarClock className="mx-auto h-12 w-12 mb-4 opacity-30" />
              <p className="text-lg font-medium">No regions configured.</p>
            </div>
          )}

          {/* Regions */}
          {!isLoading && !error && regions.length > 0 && (
            <div className="space-y-6">
              {regions.map((rg) => {
                const regionJobCount = rg.technicians.reduce((s, t) => s + t.jobs.length, 0);

                return (
                  <Card key={rg.regionid_id} className="overflow-hidden border border-card-border shadow-sm" data-testid={`region-${rg.region}`}>
                    {/* Region header */}
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

                    {/* Week grid */}
                    <CardContent className="p-0 overflow-x-auto">
                      <div className="min-w-[1000px]">
                        {/* Day headers */}
                        <div className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] bg-muted border-b border-border">
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

                        {/* Technician rows */}
                        {rg.technicians.length === 0 && (
                          <div className="px-4 py-6 text-sm text-muted-foreground italic">
                            No technicians in this region.
                          </div>
                        )}
                        {rg.technicians.map((tech) => {
                          const jobsByDay: ScheduleJob[][] = DAYS.map(() => []);
                          for (const j of tech.jobs) {
                            const idx = Math.max(0, Math.min(6, j.day_index ?? 0));
                            jobsByDay[idx].push(j as ScheduleJob);
                          }
                          return (
                            <div
                              key={tech.technician_id}
                              className="grid grid-cols-[180px_repeat(7,minmax(0,1fr))] border-b border-border last:border-b-0 hover:bg-accent/20"
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
                                  {jobs.map((j) => <JobChip key={j.booking_id} job={j} />)}
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
              No jobs scheduled this week. Try a different week.
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
