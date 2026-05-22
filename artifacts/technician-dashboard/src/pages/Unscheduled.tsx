import { Link } from "wouter";
import { useGetUnscheduledJobs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Briefcase, Phone } from "lucide-react";

function fmtDuration(mins: number | null | undefined): string {
  if (mins == null || mins <= 0) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function fmtFamiliarity(t: { city_jobs: number; region_jobs: number; same_region: boolean; region?: string | null }): string {
  const parts: string[] = [];
  if (t.same_region && t.region) parts.push(t.region);
  if (t.city_jobs > 0) parts.push(`${t.city_jobs} prior in city`);
  else if (t.region_jobs > 0) parts.push(`${t.region_jobs} prior in region`);
  return parts.join(" · ");
}

export default function Unscheduled() {
  const { data, isLoading, error } = useGetUnscheduledJobs({
    query: { queryKey: ["getUnscheduledJobs"] },
  });
  const jobs = data?.jobs ?? [];

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
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive">Failed to load unscheduled jobs.</div>
        )}
        {!isLoading && !error && (
          <Card className="border border-card-border shadow-sm">
            <CardContent className="p-0">
              {jobs.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground italic">
                  No unscheduled jobs.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Due Date</TableHead>
                        <TableHead>WO #</TableHead>
                        <TableHead>Service Location</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>State</TableHead>
                        <TableHead>Region</TableHead>
                        <TableHead>PO #</TableHead>
                        <TableHead>Contact</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Best Fit Tech #1 <span className="font-normal text-muted-foreground">(familiarity)</span></TableHead>
                        <TableHead>Best Fit Tech #2 <span className="font-normal text-muted-foreground">(familiarity)</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jobs.map((j, idx) => {
                        const t1 = j.best_fit_techs?.[0];
                        const t2 = j.best_fit_techs?.[1];
                        return (
                          <TableRow key={j.work_order_id ?? `${j.work_order_number}-${idx}`} data-testid={`row-unscheduled-${j.work_order_id ?? idx}`}>
                            <TableCell className="tabular-nums whitespace-nowrap">
                              {fmtDate(j.due_date)}
                            </TableCell>
                            <TableCell className="font-mono font-semibold whitespace-nowrap">
                              {j.work_order_id ? (
                                <Link href={`/work-order/${j.work_order_id}`} className="text-primary hover:underline">
                                  {j.work_order_number ?? "—"}
                                </Link>
                              ) : (
                                j.work_order_number ?? "—"
                              )}
                            </TableCell>
                            <TableCell>{j.servicelocation ?? "—"}</TableCell>
                            <TableCell>{j.customer_name ?? "—"}</TableCell>
                            <TableCell>{j.city ?? "—"}</TableCell>
                            <TableCell>{j.state ?? "—"}</TableCell>
                            <TableCell>{j.region ?? "—"}</TableCell>
                            <TableCell className="font-mono">{j.po_number ?? "—"}</TableCell>
                            <TableCell>
                              <div className="text-sm">{j.contact_name ?? "—"}</div>
                              {j.contact_phone && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Phone className="h-3 w-3" />
                                  {j.contact_phone}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="tabular-nums whitespace-nowrap">
                              {fmtDuration(j.duration_minutes)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {t1 ? (
                                <div>
                                  <div className="text-sm font-medium">{t1.resource_name ?? "—"}</div>
                                  <div className="text-xs text-muted-foreground">{fmtFamiliarity(t1) || "—"}</div>
                                </div>
                              ) : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {t2 ? (
                                <div>
                                  <div className="text-sm font-medium">{t2.resource_name ?? "—"}</div>
                                  <div className="text-xs text-muted-foreground">{fmtFamiliarity(t2) || "—"}</div>
                                </div>
                              ) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
