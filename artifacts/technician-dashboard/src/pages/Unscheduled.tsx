import { Link } from "wouter";
import { useGetUnscheduledJobs, UnscheduledJob } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Briefcase, Phone, Clock, MapPin, User } from "lucide-react";

type Job = UnscheduledJob;

function fmtDuration(mins: number | null | undefined): string {
  if (mins == null || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "No due date";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtFamiliarity(t: { city_jobs: number; region_jobs: number; same_region: boolean; region?: string | null }): string {
  const parts: string[] = [];
  if (t.same_region && t.region) parts.push(t.region);
  if (t.city_jobs > 0) parts.push(`${t.city_jobs} prior in city`);
  else if (t.region_jobs > 0) parts.push(`${t.region_jobs} prior in region`);
  return parts.join(" · ") || (t.region ?? "");
}

const BUCKETS: { label: string; sublabel: string; days: number | null; color: string; badgeClass: string; headerClass: string }[] = [
  {
    label: "Due Within 2 Weeks",
    sublabel: "Highest priority",
    days: 14,
    color: "border-red-400",
    badgeClass: "bg-red-100 text-red-800 border border-red-200",
    headerClass: "bg-red-50 border-b border-red-200 text-red-900",
  },
  {
    label: "Due in 3–4 Weeks",
    sublabel: "Plan ahead",
    days: 28,
    color: "border-amber-400",
    badgeClass: "bg-amber-100 text-amber-800 border border-amber-200",
    headerClass: "bg-amber-50 border-b border-amber-200 text-amber-900",
  },
  {
    label: "Due in 4+ Weeks",
    sublabel: "Future / unset",
    days: null,
    color: "border-slate-300",
    badgeClass: "bg-slate-100 text-slate-700 border border-slate-200",
    headerClass: "bg-slate-50 border-b border-slate-200 text-slate-800",
  },
];

function getBucketIndex(dueDateISO: string | null | undefined): number {
  if (!dueDateISO) return 2;
  const d = new Date(dueDateISO + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 2;
  const diffMs = d.getTime() - Date.now();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays <= 14) return 0;
  if (diffDays <= 28) return 1;
  return 2;
}

function sortByDue(a: Job, b: Job): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
}

function dueBadgeStyle(dueDateISO: string | null | undefined): string {
  const idx = getBucketIndex(dueDateISO);
  if (idx === 0) return "text-red-700 font-semibold";
  if (idx === 1) return "text-amber-700 font-semibold";
  return "text-slate-600";
}

function JobCard({ job }: { job: Job }) {
  const t1 = job.best_fit_techs?.[0];
  const t2 = job.best_fit_techs?.[1];
  const duration = fmtDuration(job.duration_minutes);
  const loc = [job.city, job.state].filter(Boolean).join(", ");

  return (
    <div className="bg-white rounded-lg border border-card-border shadow-sm hover:shadow-md transition-shadow p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          {job.work_order_id ? (
            <Link href={`/work-order/${job.work_order_id}`} className="text-primary hover:underline font-mono font-bold text-sm">
              WO# {job.work_order_number ?? "—"}
            </Link>
          ) : (
            <span className="font-mono font-bold text-sm">WO# {job.work_order_number ?? "—"}</span>
          )}
        </div>
        <span className={`text-xs whitespace-nowrap ${dueBadgeStyle(job.due_date)}`}>
          {fmtDate(job.due_date)}
        </span>
      </div>

      {/* Customer + service location */}
      <div>
        <div className="text-sm font-semibold text-foreground leading-tight">{job.customer_name ?? "—"}</div>
        {job.servicelocation && (
          <div className="text-xs text-muted-foreground">{job.servicelocation}</div>
        )}
      </div>

      {/* Location row */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span>{loc || "—"}</span>
        {job.region && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 ml-1">{job.region}</Badge>
        )}
      </div>

      {/* PO + Duration */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {job.po_number && (
          <span className="font-mono">PO: {job.po_number}</span>
        )}
        {duration && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}
      </div>

      {/* Contact */}
      {(job.contact_name || job.contact_phone) && (
        <div className="text-xs text-muted-foreground flex items-start gap-1.5">
          <User className="h-3 w-3 shrink-0 mt-0.5" />
          <div>
            {job.contact_name && <div>{job.contact_name}</div>}
            {job.contact_phone && (
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {job.contact_phone}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Best fit techs */}
      {(t1 || t2) && (
        <div className="pt-2 border-t border-border space-y-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Best Fit</div>
          {[t1, t2].filter(Boolean).map((t, i) => (
            <div key={i} className="text-xs flex items-center justify-between gap-1">
              <span className="font-medium truncate">{t!.resource_name ?? "—"}</span>
              <span className="text-muted-foreground shrink-0">{fmtFamiliarity(t!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Unscheduled() {
  const { data, isLoading, error } = useGetUnscheduledJobs({
    query: { queryKey: ["getUnscheduledJobs"] },
  });
  const jobs = data?.jobs ?? [];

  const buckets: Job[][] = [[], [], []];
  for (const job of jobs) {
    buckets[getBucketIndex(job.due_date)].push(job);
  }
  buckets.forEach((b) => b.sort(sortByDue));

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/schedule-board" data-testid="link-back" className="flex items-center gap-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm font-medium hidden sm:inline">Schedule Board</span>
          </Link>
          <span className="text-sidebar-foreground/40 mx-1">|</span>
          <Briefcase className="h-6 w-6 text-sidebar-primary shrink-0" />
          <h1 className="text-xl font-bold tracking-tight flex-1">Unscheduled Jobs</h1>
          {!isLoading && (
            <Badge variant="secondary" className="text-xs">{jobs.length} jobs</Badge>
          )}
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {BUCKETS.map((_, i) => (
              <div key={i} className="space-y-3">
                <Skeleton className="h-8" />
                {Array.from({ length: 3 }).map((__, j) => <Skeleton key={j} className="h-40" />)}
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive">Failed to load unscheduled jobs.</div>
        )}
        {!isLoading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
            {BUCKETS.map((bucket, bi) => (
              <div key={bi} className={`rounded-xl border-2 ${bucket.color} overflow-hidden`}>
                {/* Column header */}
                <div className={`px-4 py-3 ${bucket.headerClass} flex items-center justify-between`}>
                  <div>
                    <div className="font-semibold text-sm">{bucket.label}</div>
                    <div className="text-xs opacity-70">{bucket.sublabel}</div>
                  </div>
                  <Badge className={`${bucket.badgeClass} tabular-nums`}>
                    {buckets[bi].length}
                  </Badge>
                </div>

                {/* Cards */}
                <div className="p-3 space-y-3 bg-slate-50/60 min-h-[120px]">
                  {buckets[bi].length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground italic py-6">
                      No jobs in this window
                    </div>
                  ) : (
                    buckets[bi].map((job, idx) => (
                      <JobCard key={job.work_order_id ?? `${job.work_order_number}-${idx}`} job={job} />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
