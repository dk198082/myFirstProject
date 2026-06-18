import { useState } from "react";
import { useGetWbResourceUtilization } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight } from "lucide-react";

type ViewType = "week" | "month" | "quarter";

// ── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfWeekISO(d: Date): string {
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(utc);
}

function startOfMonthISO(d: Date): string {
  return isoDate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)));
}

function startOfQuarterISO(d: Date): string {
  const qm = Math.floor(d.getMonth() / 3) * 3;
  return isoDate(new Date(Date.UTC(d.getFullYear(), qm, 1)));
}

function currentPeriodStart(view: ViewType): string {
  const now = new Date();
  if (view === "month") return startOfMonthISO(now);
  if (view === "quarter") return startOfQuarterISO(now);
  return startOfWeekISO(now);
}

function stepStart(iso: string, view: ViewType, dir: -1 | 1): string {
  const d = new Date(iso + "T00:00:00Z");
  if (view === "week") {
    d.setUTCDate(d.getUTCDate() + dir * 7);
    return isoDate(d);
  }
  if (view === "month") {
    return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)));
  }
  // quarter
  return isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir * 3, 1)));
}

// ── Label helpers ─────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const QUARTER_NAMES = ["Q1","Q2","Q3","Q4"];

function fmtRangeLabel(iso: string, view: ViewType): string {
  const d = new Date(iso + "T00:00:00Z");
  if (view === "month") {
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  if (view === "quarter") {
    const q = Math.floor(d.getUTCMonth() / 3);
    const startM = MONTH_NAMES[q * 3];
    const endM = MONTH_NAMES[q * 3 + 2];
    return `${QUARTER_NAMES[q]} ${d.getUTCFullYear()} (${startM}–${endM})`;
  }
  // week
  const s = d;
  const e = new Date(d);
  e.setUTCDate(e.getUTCDate() + 6);
  const fmt = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}, ${s.getUTCFullYear()}`;
}

function fmtCapacityLabel(weeklyHours: number, periodWeeks: number, view: ViewType): string {
  const total = Math.round(weeklyHours * periodWeeks);
  if (view === "week") return `${weeklyHours}h/wk capacity`;
  if (view === "month") return `~${total}h/mo capacity (${weeklyHours}h × ${Math.round(periodWeeks)} wks)`;
  return `~${total}h/qtr capacity (${weeklyHours}h × ${Math.round(periodWeeks)} wks)`;
}

function nowLabel(view: ViewType) {
  return view === "week" ? "This Week" : view === "month" ? "This Month" : "This Quarter";
}

// ── Util helpers ──────────────────────────────────────────────────────────────

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function utilColors(pct: number) {
  if (pct > 100) return { bar: "bg-red-500", text: "text-red-700", bg: "bg-red-50" };
  if (pct >= 80) return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" };
  return { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ResourceUtilization() {
  const [view, setView] = useState<ViewType>("week");
  const [start, setStart] = useState<string>(() => currentPeriodStart("week"));

  const { data, isLoading, error } = useGetWbResourceUtilization(
    { start, view },
    { query: { queryKey: ["getWbResourceUtilization", start, view] } },
  );

  // Only show resources that actually have booked work in the period. Capacity
  // itself is a uniform default per resource, so "without any capacity" means
  // resources sitting idle (no jobs / no utilized time). Drop regions that end
  // up empty after filtering.
  const regions = (data?.regions ?? [])
    .map((rg) => ({
      ...rg,
      technicians: (rg.technicians ?? []).filter((t) => (t.job_count ?? 0) > 0),
    }))
    .filter((rg) => rg.technicians.length > 0);
  const weeklyHours = data?.default_weekly_capacity_hours ?? 40;
  const periodWeeks = data?.period_weeks ?? 1;

  const changeView = (v: ViewType) => {
    setView(v);
    setStart(currentPeriodStart(v));
  };
  const goPrev = () => setStart(stepStart(start, view, -1));
  const goNext = () => setStart(stepStart(start, view, 1));
  const goNow = () => setStart(currentPeriodStart(view));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        {/* Left: view switcher + nav */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggles */}
          <div className="flex rounded-md overflow-hidden border border-border">
            {(["week", "month", "quarter"] as ViewType[]).map((v) => (
              <button
                key={v}
                onClick={() => changeView(v)}
                data-testid={`view-${v}`}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                  view === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <span className="text-muted-foreground/40">|</span>

          {/* Period navigator */}
          <Button variant="outline" size="icon" onClick={goPrev} aria-label="Previous" data-testid="btn-prev">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-base font-semibold tabular-nums px-2 min-w-[220px] text-center" data-testid="text-range">
            {fmtRangeLabel(start, view)}
          </div>
          <Button variant="outline" size="icon" onClick={goNext} aria-label="Next" data-testid="btn-next">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goNow} data-testid="btn-now">
            {nowLabel(view)}
          </Button>
        </div>

        {/* Right: legend + capacity */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap justify-end">
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500 inline-block" /> Healthy (&lt;80%)</div>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500 inline-block" /> High (80–100%)</div>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-500 inline-block" /> Over (&gt;100%)</div>
          <span className="text-muted-foreground/60 border-l border-border pl-3">
            {fmtCapacityLabel(weeklyHours, periodWeeks, view)}
          </span>
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
          const totalUtil = techs.reduce((s, t) => s + (t.utilized_minutes ?? 0), 0);
          const totalCap = techs.reduce((s, t) => s + (t.capacity_minutes ?? 0), 0);
          const regionPct = totalCap ? Math.round((totalUtil / totalCap) * 1000) / 10 : 0;
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
                      const capH = Math.round(t.capacity_minutes / 60);
                      return (
                        <div key={t.technician_id} className="px-4 py-3 grid grid-cols-12 gap-3 items-center" data-testid={`row-tech-${t.technician_id}`}>
                          <div className="col-span-3 min-w-0">
                            <div className="text-sm font-medium truncate">{t.resource_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{t.job_count} job{t.job_count !== 1 ? "s" : ""}</div>
                          </div>
                          <div className="col-span-6">
                            <div className={`relative h-5 w-full rounded ${colors.bg}`}>
                              <div className={`absolute top-0 left-0 h-5 rounded ${colors.bar} transition-all`} style={{ width: `${barWidth}%` }} />
                              {pct > 100 && <div className="absolute top-0 right-0 h-5 w-1 bg-red-700 rounded-r" />}
                            </div>
                          </div>
                          <div className={`col-span-2 text-sm font-semibold tabular-nums ${colors.text}`}>
                            {pct.toFixed(1)}%
                          </div>
                          <div className="col-span-1 text-xs text-muted-foreground text-right tabular-nums whitespace-nowrap">
                            {fmtHours(t.utilized_minutes)} / {capH}h
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
    </div>
  );
}
