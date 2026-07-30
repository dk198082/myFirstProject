import { useQuery } from "@tanstack/react-query";
import { getGetProductionKpiQueryOptions, type KpiOrder } from "@workspace/api-client-react";
import { useState, useMemo } from "react";
import {
  BarChart2, CalendarDays, AlertTriangle, RefreshCw, Search, Printer, Gauge,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLocation } from "wouter";
import {
  toKpiDate as toDate,
  fmtKpiDate as fmtDate,
  fmtKpiHours as fmtHours,
  pct,
  computeKpiRow,
  type KpiRow,
} from "@/lib/kpi";
import { VerdictBadge, ContinuityCell } from "@/components/kpi-cells";

export function Kpi() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");

  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    ...getGetProductionKpiQueryOptions({}),
  });

  const orders = useMemo(() => (data ?? []) as KpiOrder[], [data]);

  const rows = useMemo<KpiRow[]>(() => {
    const term = q.trim().toLowerCase();

    const computed = orders.map((o): KpiRow => computeKpiRow(o));

    if (!term) return computed;
    return computed.filter(r =>
      (r.order.prodid ?? "").toLowerCase().includes(term) ||
      (r.order.operation ?? "").toLowerCase().includes(term) ||
      (r.order.productiongroupid ?? "").toLowerCase().includes(term));
  }, [orders, q]);

  // Summary stats across the (filtered) rows
  const summary = useMemo(() => {
    const onTime = rows.filter(r => r.status === "ON TIME").length;
    const rated = rows.filter(r => r.status !== null).length;
    const contVals = rows.map(r => r.continuity).filter((v): v is number => v != null);
    const avgCont = contVals.length ? contVals.reduce((a, b) => a + b, 0) / contVals.length : null;
    const hoursVals = rows.map(r => r.order.hours).filter((v): v is number => v != null);
    const totalHours = hoursVals.length ? hoursVals.reduce((a, b) => a + b, 0) : null;
    return {
      onTimePct: rated ? (onTime / rated) * 100 : null,
      avgCont,
      totalHours,
      total: rows.length,
    };
  }, [rows]);

  // Render cap so the full posting set can't stall the browser.
  const MAX_RENDER_ROWS = 3000;
  const truncated = rows.length > MAX_RENDER_ROWS;
  const displayRows = truncated ? rows.slice(0, MAX_RENDER_ROWS) : rows;

  const navBtn = (label: string, icon: React.ReactNode, onClick: () => void, active = false) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="flex flex-col h-screen w-full bg-background text-sm overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-none border-b border-border bg-card px-4 flex items-center gap-4 print:hidden">
        <div className="flex items-center gap-2 py-3 pr-4 border-r border-border shrink-0">
          <BarChart2 className="w-5 h-5 text-primary" />
          <span className="font-bold uppercase tracking-tight">Shop Floor</span>
        </div>

        <nav className="flex items-stretch h-full -mb-px">
          {navBtn("Schedule Board", <CalendarDays className="w-4 h-4" />, () => setLocation("/"))}
          {navBtn("Booking / Schedule", <AlertTriangle className="w-4 h-4" />, () => setLocation("/booking"))}
          {navBtn("KPI", <Gauge className="w-4 h-4" />, () => {}, true)}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              className="pl-8 w-44 h-8 text-xs font-mono"
              placeholder="Order / operation / group…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              data-testid="input-kpi-search"
            />
          </div>

          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 rounded border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-kpi-print"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>

          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 h-8 px-3 rounded border border-border text-xs text-muted-foreground hover:text-foreground transition-colors"
            title={dataUpdatedAt ? `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : "Refresh"}
            data-testid="button-kpi-refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        {isLoading && (
          <div className="py-20 text-center text-muted-foreground flex flex-col items-center gap-2">
            <RefreshCw className="w-6 h-6 animate-spin opacity-40" />
            <span>Loading KPIs…</span>
          </div>
        )}

        {isError && (
          <div className="py-20 text-center text-red-700 flex flex-col items-center gap-2">
            <AlertTriangle className="w-7 h-7" />
            <span>Failed to load KPI data.</span>
            <button className="text-xs underline" onClick={() => refetch()}>Retry</button>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3 print:block">
              <h1 className="text-lg font-bold tracking-tight">KPI</h1>
              <span className="text-xs text-muted-foreground font-mono">
                {summary.total} order{summary.total !== 1 ? "s" : ""} with postings
              </span>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 print:hidden">
              <SummaryCard label="On time" value={pct(summary.onTimePct)} />
              <SummaryCard label="Avg continuity" value={pct(summary.avgCont)} />
              <SummaryCard label="Total hours" value={fmtHours(summary.totalHours)} />
              <SummaryCard label="Orders" value={String(summary.total)} />
            </div>

            {truncated && (
              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Showing the first {MAX_RENDER_ROWS.toLocaleString()} of {rows.length.toLocaleString()} orders. Use search to narrow the list.
              </div>
            )}

            <section className="rounded-lg border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    {/* Top label row — matches the Excel KPI header */}
                    <tr className="bg-muted/40 text-muted-foreground uppercase tracking-wider text-[10px]">
                      <Th>Production Order</Th>
                      <Th>Production Operation</Th>
                      <Th>Production Group</Th>
                      <Th>Start Post</Th>
                      <Th>End Post</Th>
                      <Th className="text-center">Flow Time</Th>
                      <Th className="text-center">Active Days</Th>
                      <Th className="text-center">Continuity</Th>
                      <Th className="text-right">Hours (total)</Th>
                      <Th>Delivery</Th>
                      <Th className="text-center">Status</Th>
                      <Th className="text-center">Days</Th>
                    </tr>
                    {/* Definition / formula row — matches the Excel sub-header */}
                    <tr className="bg-muted/10 text-muted-foreground/60 text-[10px] italic">
                      <Th className="font-normal"> </Th>
                      <Th className="font-normal"> </Th>
                      <Th className="font-normal"> </Th>
                      <Th className="font-normal">First posting</Th>
                      <Th className="font-normal">Last posting</Th>
                      <Th className="font-normal text-center">= NETWORKDAYS(Start, End)</Th>
                      <Th className="font-normal text-center">Posted days</Th>
                      <Th className="font-normal text-center">Active Days ÷ Flow Time</Th>
                      <Th className="font-normal text-right">Scheduled setup + process</Th>
                      <Th className="font-normal">Route window end</Th>
                      <Th className="font-normal text-center">End Post vs Delivery</Th>
                      <Th className="font-normal text-center">Flow Time − Active Days</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => (
                      <tr
                        key={r.order.prodid}
                        role="button"
                        tabIndex={0}
                        onClick={() => setLocation(`/order/${r.order.prodid}`)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setLocation(`/order/${r.order.prodid}`)}
                        data-testid={`kpi-row-${r.order.prodid}`}
                        className="border-b border-border/40 cursor-pointer transition-colors hover:bg-muted/20"
                      >
                        <Td className="font-mono font-semibold">{r.order.prodid}</Td>
                        <Td className="max-w-[220px]">
                          <span className="truncate block" title={r.order.operation ?? ""}>
                            {r.order.operation ?? "—"}
                          </span>
                        </Td>
                        <Td className="font-mono text-muted-foreground">{r.order.productiongroupid ?? "—"}</Td>
                        <Td className="font-mono">{fmtDate(toDate(r.order.firstposting))}</Td>
                        <Td className="font-mono">{fmtDate(toDate(r.order.lastposting))}</Td>
                        <Td className="text-center font-mono">{r.flowTime ?? "—"}</Td>
                        <Td className="text-center font-mono">{r.activeDays ?? "—"}</Td>
                        <Td className="text-center font-mono">
                          {r.continuity != null ? <ContinuityCell value={r.continuity} /> : "—"}
                        </Td>
                        <Td className="text-right font-mono">{fmtHours(r.order.hours)}</Td>
                        <Td className="font-mono">{fmtDate(toDate(r.order.delivery))}</Td>
                        <Td className="text-center"><VerdictBadge v={r.status} /></Td>
                        <Td className="text-center font-mono">{r.days ?? "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {rows.length === 0 && (
              <div className="py-16 text-center text-muted-foreground">
                {q ? "No orders match your search" : "No orders with postings found"}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-semibold px-3 py-2 border-b border-border whitespace-nowrap ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
