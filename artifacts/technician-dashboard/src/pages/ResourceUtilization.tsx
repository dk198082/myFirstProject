import { useState } from "react";
import { Link } from "wouter";
import { useGetResourceUtilization } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronLeft, ChevronRight, User } from "lucide-react";

function startOfWeekISO(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtWeekLabel(startISO: string): string {
  const s = new Date(startISO + "T00:00:00Z");
  const e = new Date(s);
  e.setUTCDate(e.getUTCDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}, ${s.getUTCFullYear()}`;
}

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function utilColors(pct: number): { bar: string; text: string; bg: string; label: string } {
  if (pct > 100) {
    return { bar: "bg-red-500", text: "text-red-700", bg: "bg-red-50", label: "Over capacity" };
  }
  if (pct >= 80) {
    return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50", label: "High" };
  }
  return { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", label: "Healthy" };
}

export default function ResourceUtilization() {
  const [start, setStart] = useState<string>(() => startOfWeekISO(new Date()));
  const { data, isLoading, error } = useGetResourceUtilization(
    { start },
    { query: { queryKey: ["getResourceUtilization", start] } },
  );

  const regions = data?.regions ?? [];
  const capacityHours = data?.default_weekly_capacity_hours ?? 40;

  const goPrev = () => setStart(addDaysISO(start, -7));
  const goNext = () => setStart(addDaysISO(start, 7));
  const goToday = () => setStart(startOfWeekISO(new Date()));

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-sidebar text-sidebar-foreground shadow-md sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <Link href="/schedule-board" data-testid="link-back" className="flex items-center gap-1.5 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm font-medium hidden sm:inline">Schedule Board</span>
          </Link>
          <span className="text-sidebar-foreground/40 mx-1">|</span>
          <User className="h-6 w-6 text-sidebar-primary shrink-0" />
          <h1 className="text-xl font-bold tracking-tight flex-1">Resource Utilization</h1>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={goPrev} aria-label="Previous week" data-testid="btn-prev">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-base font-semibold tabular-nums px-2 min-w-[200px] text-center" data-testid="text-range">
              {fmtWeekLabel(start)}
            </div>
            <Button variant="outline" size="icon" onClick={goNext} aria-label="Next week" data-testid="btn-next">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday} data-testid="btn-today">
              This Week
            </Button>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Healthy (&lt;80%)</div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> High (80–100%)</div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Over (&gt;100%)</div>
            <span className="text-muted-foreground/70">Capacity: {capacityHours}h/wk</span>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive">Failed to load utilization.</div>
        )}
        {!isLoading && !error && regions.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-10">No regions.</div>
        )}

        <div className="space-y-6">
          {regions.map((rg) => {
            const techs = rg.technicians ?? [];
            const totalUtilMin = techs.reduce((s, t) => s + (t.utilized_minutes ?? 0), 0);
            const totalCapMin = techs.reduce((s, t) => s + (t.capacity_minutes ?? 0), 0);
            const regionPct = totalCapMin ? Math.round((totalUtilMin / totalCapMin) * 1000) / 10 : 0;
            const regionColors = utilColors(regionPct);
            return (
              <Card key={rg.regionid_id} className="border border-card-border shadow-sm" data-testid={`region-${rg.regionid_id}`}>
                <CardContent className="p-0">
                  <div className="px-4 py-3 border-b border-border flex items-center gap-3">
                    <h2 className="text-base font-semibold flex-1">{rg.region}</h2>
                    <Badge variant="outline" className="text-xs">{techs.length} tech{techs.length !== 1 ? "s" : ""}</Badge>
                    <div className={`text-sm font-semibold tabular-nums ${regionColors.text}`}>
                      {regionPct}% avg
                    </div>
                  </div>
                  {techs.length === 0 ? (
                    <div className="px-4 py-6 text-center text-sm text-muted-foreground italic">
                      No technicians in this region.
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {techs.map((t) => {
                        const pct = t.utilization_pct ?? 0;
                        const colors = utilColors(pct);
                        const barWidth = Math.min(100, pct);
                        return (
                          <div
                            key={t.technician_id}
                            className="px-4 py-3 grid grid-cols-12 gap-3 items-center"
                            data-testid={`row-tech-${t.technician_id}`}
                          >
                            <div className="col-span-3 min-w-0">
                              <div className="text-sm font-medium truncate">{t.resource_name ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{t.job_count} job{t.job_count !== 1 ? "s" : ""}</div>
                            </div>
                            <div className="col-span-6">
                              <div className={`relative h-5 w-full rounded ${colors.bg}`}>
                                <div
                                  className={`absolute top-0 left-0 h-5 rounded ${colors.bar} transition-all`}
                                  style={{ width: `${barWidth}%` }}
                                />
                                {pct > 100 && (
                                  <div className="absolute top-0 right-0 h-5 w-1 bg-red-700 rounded-r" />
                                )}
                              </div>
                            </div>
                            <div className={`col-span-2 text-sm font-semibold tabular-nums ${colors.text}`}>
                              {pct.toFixed(1)}%
                            </div>
                            <div className="col-span-1 text-xs text-muted-foreground text-right tabular-nums">
                              {fmtHours(t.utilized_minutes)} / {capacityHours}h
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
