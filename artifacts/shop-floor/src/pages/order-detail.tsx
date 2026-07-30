import { useRoute, Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getGetProductionSummaryQueryOptions,
  getGetProductionRouteDetailsQueryOptions,
  getGetProductionKpiQueryOptions,
  getGetProductionRouteTransactionsQueryOptions,
} from "@workspace/api-client-react";
import { ArrowLeft, Box, Calendar, AlertCircle, Clock, Factory, Gauge, Printer, ShoppingCart, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtLongDate } from "./board-logic";
import { computeKpiRow, toKpiDate, fmtKpiDate, fmtKpiHours } from "@/lib/kpi";
import { VerdictBadge, ContinuityCell } from "@/components/kpi-cells";
import { StoreroomRequestDialog } from "@/components/StoreroomRequestDialog";
import { CalibrationRequestDialog } from "@/components/CalibrationRequestDialog";

// D365FO production order status codes
const STATUS_LABELS: Record<number, string> = {
  0: "Created", 1: "Estimated", 2: "Scheduled", 3: "Released",
  4: "Started", 5: "Reported", 6: "Ended", 7: "Ordered",
};
const STATUS_COLORS: Record<number, string> = {
  3: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  4: "bg-green-500/15 text-green-700 border-green-500/30",
  5: "bg-gray-500/15 text-gray-700 border-gray-500/30",
  1: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  2: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30",
  6: "bg-purple-500/15 text-purple-700 border-purple-500/30",
};

// Exact hours formatter for the routing table: null/undefined/non-numeric
// values count as 0 and render "0h 00m" (never "—" or NaN).
function fmtHoursExact(val: number | string | null | undefined): string {
  const n = Number(val ?? 0);
  const totalMinutes = Math.round((Number.isFinite(n) ? n : 0) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function statusLabel(s: number | null | undefined) {
  if (s == null) return "—";
  return STATUS_LABELS[s] ?? String(s);
}
function statusColor(s: number | null | undefined) {
  if (s == null) return "bg-muted text-muted-foreground border-border";
  return STATUS_COLORS[s] ?? "bg-orange-500/15 text-orange-700 border-orange-500/30";
}

export function OrderDetail() {
  const [, params] = useRoute("/order/:prodid");
  const prodid = params?.prodid;
  const [location] = useLocation();
  const backSearch = location.includes("?") ? location.slice(location.indexOf("?")) : "";

  // Use summary endpoint — includes enriched sales order context
  const { data: summaryRows, isLoading: loadingOrder } = useQuery({
    ...getGetProductionSummaryQueryOptions({ prodid }),
    enabled: !!prodid,
  });

  const { data: routes, isLoading: loadingRoutes, isError: routeError } = useQuery({
    ...getGetProductionRouteDetailsQueryOptions({ prodid }),
    enabled: !!prodid,
  });

  const { data: routeTx, isLoading: loadingTx } = useQuery({
    ...getGetProductionRouteTransactionsQueryOptions({ prodid: prodid! }),
    enabled: !!prodid,
  });

  // Per-order KPI row (same data + math as the KPI page) for the summary banner.
  const { data: kpiRows } = useQuery({
    ...getGetProductionKpiQueryOptions({ prodid }),
    enabled: !!prodid,
  });

  const order = summaryRows?.[0];
  const kpi = kpiRows && kpiRows.length > 0 ? computeKpiRow(kpiRows[0]) : null;

  const sortedRoutes = routes
    ? [...routes].sort(
        (a, b) =>
          (Number(a.operationnumber) || 0) - (Number(b.operationnumber) || 0),
      )
    : routes;

  if (!prodid) return null;

  const fmt = fmtLongDate;

  return (
    <div className="flex flex-col min-h-screen bg-background text-sm">
      {/* Header */}
      <header className="flex-none border-b border-border bg-card px-6 py-4 flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="print:hidden">
          <Link href={`/${backSearch}`} data-testid="link-back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="font-mono text-xl font-bold tracking-tight">{prodid}</h1>
            <p className="text-muted-foreground truncate">{order?.itemname || (loadingOrder ? "Loading…" : "—")}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>Pool: {order?.productionpool ?? "Unassigned"}</span>
            <span>Production Group: {order?.productiongroupid ?? "Unassigned"}</span>
            <span>Resource: {order?.resourcecode ?? "Unassigned"}</span>
          </div>
        </div>
        <StoreroomRequestDialog prodid={prodid} productiongroupid={order?.productiongroupid} />
        <CalibrationRequestDialog
          prodid={prodid}
          productiongroupid={order?.productiongroupid}
          itemname={order?.itemname}
          demandsalesordernumber={order?.demandsalesordernumber}
        />
        <Button
          variant="outline"
          size="sm"
          className="print:hidden flex items-center gap-2 shrink-0"
          onClick={() => window.print()}
          data-testid="btn-print"
        >
          <Printer className="w-4 h-4" />
          <span className="hidden sm:inline">Print / Export PDF</span>
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
        {loadingOrder ? (
          <div className="h-48 bg-muted animate-pulse rounded-lg" />
        ) : !order ? (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
            <AlertCircle className="w-5 h-5" />
            <p>Order {prodid} not found</p>
          </div>
        ) : (
          <>
            {/* Production KPI summary — same metrics as the KPI page, scoped to
                this order. Hidden when the order is outside KPI scope (not a
                started Machine order with non-warehouse postings). */}
            {kpi && (
              <section className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/20 font-semibold flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <Gauge className="w-3.5 h-3.5" /> Production Summary
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground uppercase tracking-wider text-[10px]">
                        <KTh>Production Order</KTh>
                        <KTh>Production Operation</KTh>
                        <KTh>Production Group</KTh>
                        <KTh>Start Post</KTh>
                        <KTh>Last Post</KTh>
                        <KTh className="text-center">Flow Time</KTh>
                        <KTh className="text-center">Active Days</KTh>
                        <KTh className="text-center">Continuity</KTh>
                        <KTh className="text-right">Hours (total)</KTh>
                        <KTh className="text-right">Posted Hours</KTh>
                        <KTh>Delivery</KTh>
                        <KTh className="text-center">Status</KTh>
                        <KTh className="text-center">Days</KTh>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <KTd className="font-mono font-semibold">{kpi.order.prodid}</KTd>
                        <KTd className="max-w-[220px]">
                          <span className="truncate block" title={kpi.order.operation ?? ""}>
                            {kpi.order.operation ?? "—"}
                          </span>
                        </KTd>
                        <KTd className="font-mono text-muted-foreground">{kpi.order.productiongroupid ?? "—"}</KTd>
                        <KTd className="font-mono">{fmtKpiDate(toKpiDate(kpi.order.firstposting))}</KTd>
                        <KTd className="font-mono">{fmtKpiDate(toKpiDate(kpi.order.lastposting))}</KTd>
                        <KTd className="text-center font-mono">{kpi.flowTime ?? "—"}</KTd>
                        <KTd className="text-center font-mono">{kpi.activeDays ?? "—"}</KTd>
                        <KTd className="text-center font-mono">
                          {kpi.continuity != null ? <ContinuityCell value={kpi.continuity} /> : "—"}
                        </KTd>
                        <KTd className="text-right font-mono">{fmtKpiHours(kpi.order.hours)}</KTd>
                        <KTd className="text-right font-mono">
                          <span title='Total hours posted on "Assemble / Build" operations'>
                            {fmtKpiHours(kpi.order.assemblehours)}
                          </span>
                        </KTd>
                        <KTd className="font-mono">{fmtKpiDate(toKpiDate(kpi.order.delivery))}</KTd>
                        <KTd className="text-center"><VerdictBadge v={kpi.status} /></KTd>
                        <KTd className="text-center font-mono">{kpi.days ?? "—"}</KTd>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Production info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-card border border-border p-4 rounded-lg flex flex-col gap-1">
                <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider"><Box className="w-3.5 h-3.5" /> Item</span>
                <span className="font-mono font-medium">{order.itemid || "N/A"}</span>
              </div>
              {order.productconfiguration && (
                <div className="bg-card border border-border p-4 rounded-lg flex flex-col gap-1">
                  <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider"><Box className="w-3.5 h-3.5" /> Configuration</span>
                  <span className="font-mono font-medium">{order.productconfiguration}</span>
                </div>
              )}
              <div className="bg-card border border-border p-4 rounded-lg flex flex-col gap-1">
                <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider"><Factory className="w-3.5 h-3.5" /> Qty Ordered</span>
                <span className="font-mono font-medium">{order.prodqty != null ? Number(order.prodqty).toLocaleString() : "—"}</span>
              </div>
              <div className="bg-card border border-border p-4 rounded-lg flex flex-col gap-1">
                <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider"><Factory className="w-3.5 h-3.5" /> Qty Remaining</span>
                <span className="font-mono font-medium">
                  {order.remaininventphysical != null
                    ? Number(order.remaininventphysical).toLocaleString()
                    : "—"}
                </span>
              </div>
              <div className="bg-card border border-border p-4 rounded-lg flex flex-col gap-1">
                <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider"><Calendar className="w-3.5 h-3.5" /> Start</span>
                <span className="font-mono font-medium">{fmt(order.schedulefromdate)}</span>
              </div>
              <div className="bg-card border border-border p-4 rounded-lg flex flex-col gap-1">
                <span className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider"><Calendar className="w-3.5 h-3.5" /> End</span>
                <span className="font-mono font-medium">{fmt(order.scheduledenddate)}</span>
              </div>
            </div>

            {/* Sales order context */}
            {(order.demandsalesordernumber || order.customername) && (
              <div className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
                <h2 className="font-semibold flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <ShoppingCart className="w-3.5 h-3.5" /> Linked Sales Order
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">Sales Order #</span>
                    <span className="font-mono font-medium">{order.demandsalesordernumber || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 md:-ml-2">
                    <span className="text-muted-foreground text-xs">Customer Name</span>
                    <span className="font-medium">{order.customername || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">Order Date</span>
                    <span className="font-mono font-medium">{fmt(order.salesorderdate)}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-muted-foreground text-xs">Confirmed Ship Date</span>
                    <span className="font-mono font-medium">{fmt(order.confirmedshipdate)}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Routing Operations */}
        <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/20 font-semibold flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Clock className="w-3.5 h-3.5" /> Routing Operations
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-muted-foreground">
                  <th className="px-4 py-3 font-medium text-xs">Op #</th>
                  <th className="px-4 py-3 font-medium text-xs">Name</th>
                  <th className="px-4 py-3 font-medium text-xs">Work Center</th>
                  <th className="px-4 py-3 font-medium text-xs">Scheduled Start</th>
                  <th className="px-4 py-3 font-medium text-xs">Scheduled End</th>
                  <th className="px-4 py-3 font-medium text-xs">Setup (h)</th>
                  <th className="px-4 py-3 font-medium text-xs">Process (h)</th>
                  <th className="px-4 py-3 font-medium text-xs">Status</th>
                </tr>
              </thead>
              <tbody>
                {loadingRoutes ? (
                  <tr><td colSpan={8} className="p-4 text-center text-muted-foreground animate-pulse">Loading operations…</td></tr>
                ) : routeError ? (
                  <tr><td colSpan={8} className="p-4 text-center text-red-700">Failed to load route details</td></tr>
                ) : !sortedRoutes || sortedRoutes.length === 0 ? (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No routing details available.</td></tr>
                ) : (
                  sortedRoutes.map((route, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-mono text-muted-foreground">{route.operationnumber}</td>
                      <td className="px-4 py-3 font-medium">{route.operationname}</td>
                      <td className="px-4 py-3 font-mono">{route.workcenterid}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(route.schedulefromdate)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(route.scheduledenddate)}</td>
                      <td className="px-4 py-3 font-mono">{fmtHoursExact(route.setuptime)}</td>
                      <td className="px-4 py-3 font-mono">{fmtHoursExact(route.processtime)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs border ${statusColor(route.status)}`}>
                          {statusLabel(route.status)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {routes && routes.length > 0 && (() => {
                const num = (v: unknown) => {
                  const n = Number(v ?? 0);
                  return Number.isFinite(n) ? n : 0;
                };
                const totalSetup = routes.reduce((sum, r) => sum + num(r.setuptime), 0);
                const totalProcess = routes.reduce((sum, r) => sum + num(r.processtime), 0);
                return (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                      <td colSpan={5} className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">
                        Total Scheduled Time
                      </td>
                      <td className="px-4 py-3 font-mono">{fmtHoursExact(totalSetup)}</td>
                      <td className="px-4 py-3 font-mono">{fmtHoursExact(totalProcess)}</td>
                      <td />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>

        {/* Hours Posted */}
        <div className="bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/20 font-semibold flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Clock className="w-3.5 h-3.5" /> Hours Posted
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/10 text-muted-foreground">
                  <th className="px-4 py-3 font-medium text-xs">Op #</th>
                  <th className="px-4 py-3 font-medium text-xs">Operation</th>
                  <th className="px-4 py-3 font-medium text-xs">Person</th>
                  <th className="px-4 py-3 font-medium text-xs">Date</th>
                  <th className="px-4 py-3 font-medium text-xs text-right">Hours Posted</th>
                  <th className="px-4 py-3 font-medium text-xs">Production Group</th>
                </tr>
              </thead>
              <tbody>
                {loadingTx ? (
                  <tr><td colSpan={6} className="p-4 text-center text-muted-foreground animate-pulse">Loading hours…</td></tr>
                ) : !routeTx || routeTx.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No hours posted for this order.</td></tr>
                ) : (
                  routeTx.map((tx, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 font-mono text-muted-foreground">{tx.operationnumber ?? "—"}</td>
                      <td className="px-4 py-3 text-sm">{tx.operationname ?? "—"}</td>
                      <td className="px-4 py-3 font-medium">{tx.workername ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmt(tx.postingdate)}</td>
                      <td className="px-4 py-3 font-mono text-right">{tx.postedhours != null ? fmtHoursExact(tx.postedhours) : "—"}</td>
                      <td className="px-4 py-3 text-sm">{tx.groupname ?? tx.productiongroupid ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {routeTx && routeTx.length > 0 && (() => {
                const totalHours = routeTx.reduce((sum, tx) => sum + (tx.postedhours ?? 0), 0);
                return (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/20 font-semibold">
                      <td colSpan={4} className="px-4 py-3 text-xs uppercase tracking-wider text-muted-foreground">Total Posted</td>
                      <td className="px-4 py-3 font-mono text-right">{fmtHoursExact(totalHours)}</td>
                      <td />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function KTh({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`text-left font-semibold px-3 py-2 border-b border-border whitespace-nowrap ${className}`}>{children}</th>;
}

function KTd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
