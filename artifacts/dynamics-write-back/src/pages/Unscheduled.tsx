import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useGetWbUnscheduledJobs, type UnscheduledJob } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Clock, MapPin, User } from "lucide-react";

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

const BUCKETS: {
  label: string;
  sublabel: string;
  color: string;
  badgeClass: string;
  headerClass: string;
  dateClass: string;
}[] = [
  {
    label: "Due Within 2 Weeks",
    sublabel: "Highest priority",
    color: "border-red-400",
    badgeClass: "bg-red-100 text-red-800 border border-red-200",
    headerClass: "bg-red-50 border-b border-red-200 text-red-900",
    dateClass: "text-red-700 font-semibold",
  },
  {
    label: "Due in 3–4 Weeks",
    sublabel: "Plan ahead",
    color: "border-amber-400",
    badgeClass: "bg-amber-100 text-amber-800 border border-amber-200",
    headerClass: "bg-amber-50 border-b border-amber-200 text-amber-900",
    dateClass: "text-amber-700 font-semibold",
  },
  {
    label: "Due in 4+ Weeks",
    sublabel: "Future / unset",
    color: "border-slate-300",
    badgeClass: "bg-slate-100 text-slate-700 border border-slate-200",
    headerClass: "bg-slate-50 border-b border-slate-200 text-slate-800",
    dateClass: "text-slate-600",
  },
];

function getBucketIndex(dueDateISO: string | null | undefined): number {
  if (!dueDateISO) return 2;
  const d = new Date(dueDateISO + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 2;
  const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
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

function JobCard({ job, bucketIdx }: { job: Job; bucketIdx: number }) {
  const t1 = job.best_fit_techs?.[0];
  const t2 = job.best_fit_techs?.[1];
  const duration = fmtDuration(job.duration_minutes);
  const loc = [job.city, job.state].filter(Boolean).join(", ");
  const dateClass = BUCKETS[bucketIdx].dateClass;

  return (
    <div className="bg-white rounded-lg border border-card-border shadow-sm hover:shadow-md transition-shadow p-4 flex flex-col gap-3 min-w-[260px] max-w-[300px] w-[280px] shrink-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {job.work_order_id ? (
            <Link
              href={`/work-order/${job.work_order_id}`}
              className="font-mono font-bold text-sm text-primary hover:underline"
              data-testid={`link-wo-${job.work_order_id}`}
            >
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
          {fmtDate(job.due_date)}
        </span>
      </div>

      {/* Customer */}
      <div>
        <div className="text-sm font-semibold text-foreground leading-tight">{job.customer_name ?? "—"}</div>
        {job.servicelocation && (
          <div className="text-xs text-muted-foreground truncate">{job.servicelocation}</div>
        )}
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{loc || "—"}</span>
        {job.region && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 ml-auto shrink-0">{job.region}</Badge>
        )}
      </div>

      {/* PO + Duration */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {job.po_number && <span className="font-mono truncate">PO: {job.po_number}</span>}
        {duration && (
          <span className="flex items-center gap-1 shrink-0">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}
      </div>

      {/* Contact */}
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

      {/* Best fit techs */}
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

export default function Unscheduled() {
  const { data, isLoading, error } = useGetWbUnscheduledJobs({
    query: { queryKey: ["getWbUnscheduledJobs"] },
  });
  const [selectedRegions, setSelectedRegions] = useState<Set<string> | null>(null);

  const allJobs = data?.jobs ?? [];

  // Derive unique regions from data
  const regions = useMemo(() => {
    const set = new Set<string>();
    for (const j of allJobs) {
      if (j.region) set.add(j.region);
    }
    return Array.from(set).sort();
  }, [allJobs]);

  const toggleRegion = (r: string) => {
    setSelectedRegions((prev) => {
      const current = prev ?? new Set(regions);
      const next = new Set(current);
      if (next.has(r)) next.delete(r); else next.add(r);
      if (next.size === regions.length) return null;
      return next;
    });
  };
  const selectAll = () => setSelectedRegions(null);
  const selectNone = () => setSelectedRegions(new Set());
  const isSelected = (r: string) => selectedRegions === null || selectedRegions.has(r);

  const jobs = useMemo(
    () =>
      selectedRegions === null
        ? allJobs
        : allJobs.filter((j) => j.region != null && selectedRegions.has(j.region)),
    [allJobs, selectedRegions],
  );

  const buckets: Job[][] = [[], [], []];
  for (const job of jobs) {
    buckets[getBucketIndex(job.due_date)].push(job);
  }
  buckets.forEach((b) => b.sort(sortByDue));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Unscheduled Jobs</h1>
        {!isLoading && <Badge variant="secondary" className="text-xs">{jobs.length} jobs</Badge>}
      </div>

      {/* Region filter */}
      {regions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground shrink-0">Region</span>
          <Button
            variant={selectedRegions === null ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3"
            onClick={selectAll}
            data-testid="filter-all"
          >
            All
          </Button>
          <Button
            variant={selectedRegions !== null && selectedRegions.size === 0 ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3"
            onClick={selectNone}
            data-testid="filter-none"
          >
            None
          </Button>
          <span className="text-muted-foreground/40 text-sm">|</span>
          {regions.map((r) => (
            <Button
              key={r}
              variant={isSelected(r) ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => toggleRegion(r)}
              data-testid={`filter-region-${r}`}
            >
              {r}
            </Button>
          ))}
        </div>
      )}

      {/* Skeleton */}
      {isLoading && (
        <div className="space-y-5">
          {BUCKETS.map((_, i) => (
            <div key={i} className="rounded-xl border-2 border-slate-200 overflow-hidden">
              <Skeleton className="h-14" />
              <div className="p-3 flex gap-3">
                {Array.from({ length: 3 }).map((__, j) => <Skeleton key={j} className="h-48 w-72 shrink-0" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm text-destructive">Failed to load unscheduled jobs.</div>
      )}

      {/* Bucket rows */}
      {!isLoading && !error && (
        <div className="space-y-5">
          {BUCKETS.map((bucket, bi) => (
            <div key={bi} className={`rounded-xl border-2 ${bucket.color} overflow-hidden`}>
              {/* Row header */}
              <div className={`px-4 py-3 ${bucket.headerClass} flex items-center justify-between`}>
                <div>
                  <span className="font-semibold text-sm">{bucket.label}</span>
                  <span className="text-xs opacity-70 ml-2">{bucket.sublabel}</span>
                </div>
                <Badge className={`${bucket.badgeClass} tabular-nums`}>
                  {buckets[bi].length}
                </Badge>
              </div>

              {/* Horizontal card strip */}
              <div className="bg-slate-50/60 px-3 py-3 overflow-x-auto">
                {buckets[bi].length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground italic py-6 min-h-[60px] flex items-center justify-center">
                    No jobs in this window{selectedRegions !== null && selectedRegions.size > 0 ? ` for selected regions` : ""}
                  </div>
                ) : (
                  <div className="flex gap-3 pb-1">
                    {buckets[bi].map((job, idx) => (
                      <JobCard
                        key={job.work_order_id ?? `${job.work_order_number}-${idx}`}
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
}
