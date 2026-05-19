import { useState } from "react";
import { Link } from "wouter";
import { useListTechnicians, useGetTechnicianWorkOrders, useGetTechnicianSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MapPin, Clock, User, AlertTriangle, Briefcase, CalendarClock, CheckCircle2, ClipboardList, Globe } from "lucide-react";

function priorityColor(priority: string | null | undefined) {
  switch ((priority ?? "").toLowerCase()) {
    case "high": return "bg-red-100 text-red-700 border-red-200";
    case "medium": return "bg-amber-100 text-amber-700 border-amber-200";
    case "low": return "bg-green-100 text-green-700 border-green-200";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function statusColor(status: string | null | undefined) {
  switch ((status ?? "").toLowerCase()) {
    case "scheduled": return "bg-blue-100 text-blue-700 border-blue-200";
    case "in progress": return "bg-purple-100 text-purple-700 border-purple-200";
    case "completed": return "bg-green-100 text-green-700 border-green-200";
    case "cancelled": return "bg-gray-100 text-gray-600 border-gray-200";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function bookingStatusColor(status: string | null | undefined) {
  switch ((status ?? "").toLowerCase()) {
    case "committed": return "bg-blue-50 text-blue-600";
    case "traveling": return "bg-amber-50 text-amber-600";
    case "in progress": return "bg-purple-50 text-purple-600";
    case "completed": return "bg-green-50 text-green-600";
    default: return "bg-muted/50 text-muted-foreground";
  }
}

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  } catch {
    return dt;
  }
}

function SummaryCards({ technicianId }: { technicianId: string }) {
  const { data: summary, isLoading } = useGetTechnicianSummary(technicianId, {
    query: { queryKey: ["getTechnicianSummary", technicianId], enabled: !!technicianId }
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const stats = [
    { label: "Total Jobs", value: summary.total, icon: <ClipboardList className="h-5 w-5" />, color: "text-primary" },
    { label: "Today", value: summary.upcoming_today, icon: <CalendarClock className="h-5 w-5" />, color: "text-amber-600" },
    { label: "By Status", value: summary.by_status[0]?.label ?? "—", icon: <CheckCircle2 className="h-5 w-5" />, color: "text-green-600" },
    { label: "Top Priority", value: summary.by_priority[0]?.label ?? "—", icon: <AlertTriangle className="h-5 w-5" />, color: "text-red-500" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {stats.map((s) => (
        <Card key={s.label} className="border border-card-border shadow-sm">
          <CardContent className="p-4 flex flex-col gap-1">
            <div className={`${s.color} flex items-center gap-1.5 text-sm font-medium`}>
              {s.icon}
              {s.label}
            </div>
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function JobCard({ job }: { job: { booking_id: string; work_order_number?: string | null; work_order_id?: string | null; title?: string | null; customer_name?: string | null; service_address?: string | null; priority?: string | null; system_status?: string | null; booking_status?: string | null; start_time?: string | null; end_time?: string | null; duration_minutes?: number | null } }) {
  return (
    <Card
      data-testid={`card-job-${job.booking_id}`}
      className="border border-card-border shadow-sm hover:shadow-md transition-shadow duration-200 rounded-xl overflow-hidden"
    >
      <CardHeader className="pb-2 pt-4 px-5 flex flex-row items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs font-semibold text-muted-foreground tracking-wide uppercase">
              {job.work_order_number ?? "—"}
            </span>
            {job.priority && (
              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${priorityColor(job.priority)}`}>
                {job.priority}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-foreground leading-snug truncate">
            {job.title ?? "Untitled Work Order"}
          </h3>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {job.system_status && (
            <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${statusColor(job.system_status)}`}>
              {job.system_status}
            </span>
          )}
          {job.booking_status && (
            <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${bookingStatusColor(job.booking_status)}`}>
              {job.booking_status}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-4 grid gap-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {job.customer_name && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <User className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="truncate">{job.customer_name}</span>
            </div>
          )}
          {job.service_address && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{job.service_address}</span>
            </div>
          )}
          {job.start_time && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="truncate">Start: {formatDateTime(job.start_time)}</span>
            </div>
          )}
          {job.end_time && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-4 w-4 shrink-0" />
              <span className="truncate">End: {formatDateTime(job.end_time)}</span>
            </div>
          )}
        </div>
        {job.work_order_id && (
          <div className="mt-2 pt-2 border-t border-border">
            <Link
              href={`/work-order/${job.work_order_id}`}
              data-testid={`link-detail-${job.booking_id}`}
              className="text-xs text-primary hover:underline font-medium"
            >
              View full details →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function JobList({ technicianId }: { technicianId: string }) {
  const { data, isLoading, error } = useGetTechnicianWorkOrders(technicianId, {
    query: { queryKey: ["getTechnicianWorkOrders", technicianId], enabled: !!technicianId }
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16 text-destructive">
        <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
        <p className="font-medium">Failed to load work orders.</p>
      </div>
    );
  }

  const jobs = data?.jobs ?? [];

  if (jobs.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground" data-testid="empty-jobs">
        <Briefcase className="mx-auto h-12 w-12 mb-4 opacity-30" />
        <p className="text-lg font-medium">No jobs assigned to this technician.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="job-list">
      {jobs.map((job) => (
        <JobCard key={job.booking_id} job={job} />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [selectedTechId, setSelectedTechId] = useState<string>("");

  const { data: technicians, isLoading: techLoading } = useListTechnicians({
    query: { queryKey: ["listTechnicians"] }
  });

  const selectedTech = technicians?.find((t) => t.technician_id === selectedTechId);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Briefcase className="h-6 w-6 text-sidebar-primary shrink-0" />
          <h1 className="text-xl font-bold tracking-tight flex-1">Technician Job Dashboard</h1>
          <Link
            href="/scheduled-jobs"
            data-testid="link-scheduled-jobs"
            className="flex items-center gap-1.5 text-sm text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors font-medium"
          >
            <Globe className="h-4 w-4" />
            <span className="hidden sm:inline">By Region</span>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Technician Selector */}
        <Card className="border border-card-border shadow-sm mb-6">
          <CardContent className="p-5">
            <label className="block text-sm font-semibold text-foreground mb-2">
              Select Technician
            </label>
            {techLoading ? (
              <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            ) : (
              <Select
                value={selectedTechId}
                onValueChange={setSelectedTechId}
                data-testid="select-technician"
              >
                <SelectTrigger className="max-w-md" data-testid="trigger-technician">
                  <SelectValue placeholder="Choose a technician…" />
                </SelectTrigger>
                <SelectContent>
                  {(technicians ?? []).map((t) => (
                    <SelectItem
                      key={t.technician_id}
                      value={t.technician_id}
                      data-testid={`option-tech-${t.technician_id}`}
                    >
                      {t.resource_name ?? "Unknown"} {t.user_email ? `— ${t.user_email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedTech && (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="text-selected-email">
                Showing jobs for: <span className="font-semibold text-foreground">{selectedTech.user_email}</span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Summary Cards */}
        {selectedTechId && <SummaryCards technicianId={selectedTechId} />}

        {/* Job List */}
        {selectedTechId ? (
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-primary" />
              Assigned Work Orders
            </h2>
            <JobList technicianId={selectedTechId} />
          </div>
        ) : (
          <div className="text-center py-20 text-muted-foreground" data-testid="empty-select">
            <User className="mx-auto h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">Select a technician to see their work orders.</p>
          </div>
        )}
      </main>
    </div>
  );
}
