import { useState } from "react";
import { Link } from "wouter";
import { useGetWbJobsByRegion } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin, Clock, User, ChevronDown, ChevronUp,
  AlertTriangle, Search, Globe, Building2, Mail
} from "lucide-react";

function statusColor(s: string | null | undefined) {
  switch ((s ?? "").toLowerCase()) {
    case "scheduled":   return "bg-blue-100 text-blue-700 border-blue-200";
    case "in progress": return "bg-purple-100 text-purple-700 border-purple-200";
    case "completed":   return "bg-green-100 text-green-700 border-green-200";
    case "cancelled":   return "bg-gray-100 text-gray-500 border-gray-200";
    default:            return "bg-muted text-muted-foreground border-border";
  }
}

function bookingStatusDot(s: string | null | undefined) {
  switch ((s ?? "").toLowerCase()) {
    case "completed":   return "bg-green-500";
    case "in progress": return "bg-purple-500";
    case "traveling":   return "bg-amber-400";
    case "scheduled":   return "bg-blue-500";
    default:            return "bg-gray-400";
  }
}

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return null;
  try {
    return new Date(dt).toLocaleString("en-US", {
      month: "short", day: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return dt; }
}

type RegionJob = {
  booking_id: string;
  work_order_id?: string | null;
  work_order_number?: string | null;
  title?: string | null;
  priority?: string | null;
  system_status?: string | null;
  sub_status?: string | null;
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
  jobs: RegionJob[];
};

type RegionGroup = {
  regionid_id: string;
  region: string;
  owner_name?: string | null;
  owner_email?: string | null;
  company?: string | null;
  technicians: TechGroup[];
};

function JobRow({ job }: { job: RegionJob }) {
  return (
    <div
      className="py-3 border-b border-border last:border-0 space-y-1.5"
      data-testid={`row-job-${job.booking_id}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {job.work_order_id ? (
          <Link
            href={`/work-order/${job.work_order_id}`}
            className="text-xs font-bold text-primary tracking-wide hover:underline"
            data-testid={`link-wo-${job.work_order_id}`}
          >
            {job.work_order_number ?? "—"}
          </Link>
        ) : (
          <span className="text-xs font-bold text-muted-foreground tracking-wide">
            {job.work_order_number ?? "—"}
          </span>
        )}
        {job.system_status && (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor(job.system_status)}`}>
            {job.system_status}
          </span>
        )}
        {job.booking_status && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className={`inline-block h-2 w-2 rounded-full ${bookingStatusDot(job.booking_status)}`} />
            {job.booking_status}
          </span>
        )}
        {job.priority && (
          <Badge variant="outline" className="text-xs">{job.priority}</Badge>
        )}
      </div>
      <p className="text-sm font-semibold text-foreground leading-snug">
        {job.title ?? "Untitled Work Order"}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {job.customer_name && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3 shrink-0" />{job.customer_name}
          </span>
        )}
        {job.service_address && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />{job.service_address}
          </span>
        )}
        {job.start_time && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 shrink-0" />
            {formatDateTime(job.start_time)}
            {job.end_time ? ` → ${formatDateTime(job.end_time)}` : ""}
          </span>
        )}
        {job.duration_minutes != null && (
          <span className="text-muted-foreground/70">{job.duration_minutes} min</span>
        )}
      </div>
    </div>
  );
}

function TechnicianCard({ tech }: { tech: TechGroup }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid={`card-tech-${tech.technician_id}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-accent/40 hover:bg-accent/70 transition-colors text-left"
        data-testid={`toggle-tech-${tech.technician_id}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <User className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">
            {tech.resource_name ?? "Unassigned"}
          </span>
          {tech.user_email && (
            <span className="text-xs text-muted-foreground truncate hidden md:block">
              — {tech.user_email}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary" className="text-xs">
            {tech.jobs.length} job{tech.jobs.length !== 1 ? "s" : ""}
          </Badge>
          {open
            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>
      {open && tech.jobs.length > 0 && (
        <div className="px-4 bg-card">
          {tech.jobs.map(j => <JobRow key={j.booking_id} job={j} />)}
        </div>
      )}
      {open && tech.jobs.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground italic">No jobs assigned.</p>
      )}
    </div>
  );
}

function RegionCard({ rg, defaultOpen, query }: { rg: RegionGroup; defaultOpen: boolean; query: string }) {
  const [open, setOpen] = useState(defaultOpen);

  const totalJobs = rg.technicians.reduce((s, t) => s + t.jobs.length, 0);

  const filteredTechs = rg.technicians.filter(t => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (t.resource_name ?? "").toLowerCase().includes(q) ||
      (t.user_email ?? "").toLowerCase().includes(q) ||
      t.jobs.some(j =>
        (j.title ?? "").toLowerCase().includes(q) ||
        (j.work_order_number ?? "").toLowerCase().includes(q) ||
        (j.customer_name ?? "").toLowerCase().includes(q) ||
        (j.service_address ?? "").toLowerCase().includes(q)
      )
    );
  });

  if (query && filteredTechs.length === 0) return null;

  return (
    <Card className="border border-card-border shadow-sm overflow-hidden" data-testid={`card-region-${rg.region}`}>
      {/* Region Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between px-5 py-4 bg-sidebar text-sidebar-foreground hover:bg-sidebar/90 transition-colors text-left"
        data-testid={`toggle-region-${rg.region}`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-sidebar-primary shrink-0" />
              <span className="text-lg font-bold">{rg.region}</span>
            </div>
            {rg.company && (
              <span className="text-xs px-2 py-0.5 rounded bg-sidebar-accent text-sidebar-accent-foreground font-mono font-semibold">
                {rg.company}
              </span>
            )}
            <div className="flex gap-2">
              <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                {rg.technicians.length} tech{rg.technicians.length !== 1 ? "s" : ""}
              </Badge>
              <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                {totalJobs} job{totalJobs !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>
          {(rg.owner_name || rg.owner_email) && (
            <div className="flex items-center gap-3 mt-1.5 text-xs text-sidebar-foreground/60 flex-wrap">
              {rg.owner_name && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-3 w-3" />{rg.owner_name}
                </span>
              )}
              {rg.owner_email && (
                <span className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />{rg.owner_email}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="mt-1 shrink-0">
          {open
            ? <ChevronUp className="h-5 w-5 text-sidebar-foreground/50" />
            : <ChevronDown className="h-5 w-5 text-sidebar-foreground/50" />}
        </div>
      </button>

      {open && (
        <CardContent className="p-4 space-y-3">
          {filteredTechs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No technicians in this region.</p>
          ) : (
            filteredTechs.map(tech => <TechnicianCard key={tech.technician_id} tech={tech} />)
          )}
        </CardContent>
      )}
    </Card>
  );
}

const STATUS_OPTIONS = ["All", "Scheduled", "In Progress", "Completed", "Cancelled"];

export default function JobsByRegion() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const apiStatus = statusFilter !== "All" ? statusFilter : undefined;

  const { data: regions, isLoading, error } = useGetWbJobsByRegion(
    apiStatus ? { status: apiStatus } : {},
    { query: { queryKey: ["getWbJobsByRegion", apiStatus ?? "all"] } }
  );

  const filtered = (regions ?? []).filter(rg => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      rg.region.toLowerCase().includes(q) ||
      (rg.owner_name ?? "").toLowerCase().includes(q) ||
      (rg.company ?? "").toLowerCase().includes(q) ||
      rg.technicians.some(t =>
        (t.resource_name ?? "").toLowerCase().includes(q) ||
        t.jobs.some(j =>
          (j.title ?? "").toLowerCase().includes(q) ||
          (j.work_order_number ?? "").toLowerCase().includes(q) ||
          (j.customer_name ?? "").toLowerCase().includes(q)
        )
      )
    );
  });

  const totalJobs = (regions ?? []).reduce((s, rg) =>
    s + rg.technicians.reduce((ts, t) => ts + t.jobs.length, 0), 0);

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        {!isLoading && regions && (
          <div className="flex gap-3 text-sm text-muted-foreground shrink-0">
            <span><span className="font-semibold text-foreground">{regions.length}</span> regions</span>
            <span>·</span>
            <span><span className="font-semibold text-foreground">
              {regions.reduce((s, r) => s + r.technicians.length, 0)}
            </span> technicians</span>
            <span>·</span>
            <span><span className="font-semibold text-foreground">{totalJobs}</span> jobs</span>
          </div>
        )}
        <div className="flex gap-2 sm:ml-auto w-full sm:w-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter} data-testid="select-status">
            <SelectTrigger className="w-40" data-testid="trigger-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s} data-testid={`option-status-${s}`}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              data-testid="input-search"
              placeholder="Search region, tech, job…"
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-20 text-destructive" data-testid="error-jobs-region">
          <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
          <p className="font-medium">Failed to load jobs by region.</p>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="text-center py-20 text-muted-foreground" data-testid="empty-jobs-region">
          <Globe className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">
            {search || statusFilter !== "All" ? "No results match your filters." : "No regions found."}
          </p>
        </div>
      )}

      {/* Region cards */}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="space-y-5">
          {filtered.map((rg, i) => (
            <RegionCard key={rg.regionid_id} rg={rg} defaultOpen={i === 0} query={search} />
          ))}
        </div>
      )}
    </div>
  );
}
