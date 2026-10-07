import { useState } from "react";
import { Link } from "wouter";
import { useGetScheduledJobs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin, Clock, User, Package, ChevronDown, ChevronUp,
  AlertTriangle, Search, Briefcase, Globe
} from "lucide-react";

function priorityColor(p: string | null | undefined) {
  switch ((p ?? "").toLowerCase()) {
    case "high":   return "bg-red-100 text-red-700 border-red-200";
    case "medium": return "bg-amber-100 text-amber-700 border-amber-200";
    case "low":    return "bg-green-100 text-green-700 border-green-200";
    default:       return "bg-muted text-muted-foreground border-border";
  }
}

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return dt;
  }
}

type Job = {
  booking_id: string;
  work_order_id?: string | null;
  work_order_number?: string | null;
  title?: string | null;
  priority?: string | null;
  system_status?: string | null;
  booking_status?: string | null;
  service_address?: string | null;
  customer_name?: string | null;
  city?: string | null;
  state?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
};

type TechGroup = {
  technician_id: string;
  resource_name?: string | null;
  user_email?: string | null;
  jobs: Job[];
};

type RegionGroup = {
  region: string;
  technicians: TechGroup[];
};

function JobRow({ job }: { job: Job }) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 py-3 border-b border-border last:border-0"
      data-testid={`row-job-${job.booking_id}`}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground tracking-wide">
            {job.work_order_number ?? "—"}
          </span>
          {job.priority && (
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${priorityColor(job.priority)}`}>
              {job.priority}
            </span>
          )}
          {job.booking_status && (
            <Badge variant="outline" className="text-xs">{job.booking_status}</Badge>
          )}
        </div>
        <p className="text-sm font-medium text-foreground leading-snug">
          {job.title ?? "Untitled"}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {job.customer_name && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />{job.customer_name}
            </span>
          )}
          {job.service_address && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />{job.service_address}
            </span>
          )}
          {job.start_time && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />Start: {formatDateTime(job.start_time)}
            </span>
          )}
          {job.end_time && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />End: {formatDateTime(job.end_time)}
            </span>
          )}
          {job.duration_minutes != null && (
            <span className="flex items-center gap-1">
              <Package className="h-3 w-3" />{job.duration_minutes} min
            </span>
          )}
        </div>
      </div>
      {job.work_order_id && (
        <div className="flex items-start justify-end">
          <Link
            href={`/work-order/${job.work_order_id}`}
            data-testid={`link-detail-${job.booking_id}`}
            className="text-xs text-primary hover:underline font-medium whitespace-nowrap"
          >
            View →
          </Link>
        </div>
      )}
    </div>
  );
}

function TechnicianBlock({ tech, defaultOpen }: { tech: TechGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid={`block-tech-${tech.technician_id}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted transition-colors text-left"
        onClick={() => setOpen((o) => !o)}
        data-testid={`toggle-tech-${tech.technician_id}`}
      >
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm text-foreground">
            {tech.resource_name ?? "Unknown Technician"}
          </span>
          {tech.user_email && (
            <span className="text-xs text-muted-foreground hidden sm:inline">— {tech.user_email}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">{tech.jobs.length} job{tech.jobs.length !== 1 ? "s" : ""}</Badge>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>
      {open && (
        <div className="px-4 bg-card">
          {tech.jobs.map((job) => <JobRow key={job.booking_id} job={job} />)}
        </div>
      )}
    </div>
  );
}

function RegionSection({ group, defaultOpen, query }: { group: RegionGroup; defaultOpen: boolean; query: string }) {
  const [open, setOpen] = useState(defaultOpen);

  const totalJobs = group.technicians.reduce((sum, t) => sum + t.jobs.length, 0);

  return (
    <div data-testid={`section-region-${group.region}`}>
      <button
        className="w-full flex items-center justify-between py-3 px-1 text-left group"
        onClick={() => setOpen((o) => !o)}
        data-testid={`toggle-region-${group.region}`}
      >
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">{group.region}</h2>
          <Badge className="text-xs bg-primary/10 text-primary border-primary/20 hover:bg-primary/10">
            {group.technicians.length} tech{group.technicians.length !== 1 ? "s" : ""} · {totalJobs} job{totalJobs !== 1 ? "s" : ""}
          </Badge>
        </div>
        {open
          ? <ChevronUp className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
          : <ChevronDown className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />}
      </button>

      {open && (
        <div className="space-y-2 mb-6 pl-1">
          {group.technicians
            .filter((t) => {
              if (!query) return true;
              const q = query.toLowerCase();
              return (
                (t.resource_name ?? "").toLowerCase().includes(q) ||
                (t.user_email ?? "").toLowerCase().includes(q) ||
                t.jobs.some(
                  (j) =>
                    (j.title ?? "").toLowerCase().includes(q) ||
                    (j.work_order_number ?? "").toLowerCase().includes(q) ||
                    (j.customer_name ?? "").toLowerCase().includes(q)
                )
              );
            })
            .map((tech, i) => (
              <TechnicianBlock key={tech.technician_id} tech={tech} defaultOpen={i === 0} />
            ))}
        </div>
      )}
    </div>
  );
}

export default function ScheduledJobs() {
  const [search, setSearch] = useState("");

  const { data: regions, isLoading, error } = useGetScheduledJobs({
    query: { queryKey: ["getScheduledJobs"] },
  });

  const filtered = (regions ?? []).filter((rg) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      rg.region.toLowerCase().includes(q) ||
      rg.technicians.some(
        (t) =>
          (t.resource_name ?? "").toLowerCase().includes(q) ||
          (t.user_email ?? "").toLowerCase().includes(q) ||
          t.jobs.some(
            (j) =>
              (j.title ?? "").toLowerCase().includes(q) ||
              (j.work_order_number ?? "").toLowerCase().includes(q) ||
              (j.customer_name ?? "").toLowerCase().includes(q)
          )
      )
    );
  });

  const totalJobs = (regions ?? []).reduce(
    (sum, rg) => sum + rg.technicians.reduce((s, t) => s + t.jobs.length, 0),
    0
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Globe className="h-6 w-6 text-sidebar-primary shrink-0" />
          <h1 className="text-xl font-bold tracking-tight flex-1">Scheduled Jobs by Region &amp; Technician</h1>
          <Link
            href="/"
            data-testid="link-dashboard"
            className="text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors font-medium flex items-center gap-1"
          >
            <Briefcase className="h-4 w-4" />
            <span className="hidden sm:inline">My Dashboard</span>
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Stats bar + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          {!isLoading && regions && (
            <div className="flex gap-3 text-sm text-muted-foreground">
              <span><span className="font-semibold text-foreground">{regions.length}</span> regions</span>
              <span>·</span>
              <span>
                <span className="font-semibold text-foreground">
                  {regions.reduce((s, r) => s + r.technicians.length, 0)}
                </span> technicians
              </span>
              <span>·</span>
              <span><span className="font-semibold text-foreground">{totalJobs}</span> scheduled jobs</span>
            </div>
          )}
          <div className="sm:ml-auto relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="input-search"
              placeholder="Search region, technician, or job…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-20 text-destructive" data-testid="error-scheduled">
            <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
            <p className="font-medium">Failed to load scheduled jobs.</p>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="text-center py-20 text-muted-foreground" data-testid="empty-scheduled">
            <Package className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">
              {search ? "No results match your search." : "No scheduled jobs found."}
            </p>
          </div>
        )}

        {/* Region sections */}
        {!isLoading && !error && filtered.length > 0 && (
          <div className="divide-y divide-border">
            {filtered.map((rg, i) => (
              <RegionSection key={rg.region} group={rg} defaultOpen={i === 0} query={search} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
