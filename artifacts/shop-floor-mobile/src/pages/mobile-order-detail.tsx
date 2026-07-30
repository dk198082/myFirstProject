import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  getGetProductionSummaryQueryOptions,
  getGetProductionRouteDetailsQueryOptions,
  getGetProductionPickingQueryOptions,
} from "@workspace/api-client-react";
import {
  ArrowLeft, Box, Calendar, AlertCircle, Clock, Factory,
  ShoppingCart, Users, ChevronDown, ChevronUp, PackageCheck,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";

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

function statusLabel(s: number | null | undefined) {
  if (s == null) return "—";
  return STATUS_LABELS[s] ?? String(s);
}
function statusColor(s: number | null | undefined) {
  if (s == null) return "bg-muted text-muted-foreground border-border";
  return STATUS_COLORS[s] ?? "bg-orange-500/15 text-orange-700 border-orange-500/30";
}

function InfoTile({ icon, label, value, progress, subValue }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  progress?: number;
  subValue?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1.5">
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs uppercase tracking-wider font-medium">
        {icon} {label}
      </span>
      <span className="font-mono font-semibold text-base">{value}</span>
      {progress != null && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-0.5">
          <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {subValue && <span className="text-xs text-muted-foreground">{subValue}</span>}
    </div>
  );
}

export function MobileOrderDetail() {
  const [, params] = useRoute("/order/:prodid");
  const [, setLocation] = useLocation();
  const [routesExpanded, setRoutesExpanded] = useState(false);
  const prodid = params?.prodid;

  const { data: summaryRows, isLoading: loadingOrder } = useQuery({
    ...getGetProductionSummaryQueryOptions({ prodid }),
    enabled: !!prodid,
  });

  const { data: routes, isLoading: loadingRoutes, isError: routeError } = useQuery({
    ...getGetProductionRouteDetailsQueryOptions({ prodid }),
    enabled: !!prodid,
  });

  // Same cached endpoint as the boards. It only returns orders WITH remaining
  // lines, so a loaded response without this order means fully picked.
  const { data: pickingData, isError: pickError } = useQuery(getGetProductionPickingQueryOptions());
  const pickLoaded = pickingData !== undefined;
  const pickItems = pickingData?.find(p => p.prodid === prodid)?.items;

  const order = summaryRows?.[0];

  if (!prodid) return null;

  const fmt = (d: string | null | undefined) => {
    if (!d) return "N/A";
    // Truncate to the date part and parse as a LOCAL date. D365 exports dates as
    // UTC-midnight timestamps; new Date() would shift them a day back in
    // timezones behind UTC.
    try { return format(parseISO(d.substring(0, 10)), "MMM d, yyyy"); } catch { return d; }
  };

  const qtyOrdered = order?.prodqty != null ? Number(order.prodqty) : null;
  const remaining = order?.remaininventphysical != null ? Number(order.remaininventphysical) : null;
  const qtyProgress = qtyOrdered && qtyOrdered > 0 && remaining != null
    ? Math.max(0, Math.min(100, ((qtyOrdered - remaining) / qtyOrdered) * 100))
    : undefined;

  const visibleRoutes = routesExpanded ? (routes ?? []) : (routes ?? []).slice(0, 3);

  return (
    <div className="flex flex-col min-h-dvh bg-background">
      {/* Header */}
      <header className="flex-none bg-card border-b border-border px-4 pt-safe-top">
        <div className="flex items-center gap-3 py-3">
          <button
            onClick={() => setLocation("/")}
            className="p-1.5 -ml-1.5 rounded-lg text-muted-foreground active:bg-muted"
            aria-label="Back"
            data-testid="mobile-back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-mono font-bold text-base tracking-tight">{prodid}</h1>
              {order?.productionstatus != null && (
                <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wider ${statusColor(order.productionstatus)}`}>
                  {statusLabel(order.productionstatus)}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {order?.itemname || (loadingOrder ? "Loading…" : "—")}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 pb-8">
        {loadingOrder ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
            ))}
          </div>
        ) : !order ? (
          <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-xl border border-destructive/20">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">Order {prodid} not found</p>
          </div>
        ) : (
          <>
            {/* Key info tiles */}
            <div className="grid grid-cols-2 gap-3">
              <InfoTile
                icon={<Box className="w-3.5 h-3.5" />}
                label="Item"
                value={order.itemid || "N/A"}
              />
              <InfoTile
                icon={<Factory className="w-3.5 h-3.5" />}
                label="Qty Ordered"
                value={qtyOrdered != null ? qtyOrdered.toLocaleString() : "—"}
                progress={qtyProgress}
                subValue={remaining != null ? `${remaining.toLocaleString()} remaining` : undefined}
              />
              <InfoTile
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="Start"
                value={fmt(order.schedulefromdate)}
              />
              <InfoTile
                icon={<Calendar className="w-3.5 h-3.5" />}
                label="End"
                value={fmt(order.scheduledenddate)}
              />
            </div>

            {/* Production group */}
            {order.productiongroupid && (
              <div className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Resource Group</span>
                <span className="font-mono text-sm">{order.productiongroupid}</span>
              </div>
            )}

            {/* Sales order context */}
            {(order.demandsalesordernumber || order.customername) && (
              <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
                <h2 className="font-semibold flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
                  <ShoppingCart className="w-3.5 h-3.5" /> Linked Sales Order
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Sales Order #</span>
                    <span className="font-mono text-sm font-medium">{order.demandsalesordernumber || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Customer Name</span>
                    <span className="text-sm font-medium">{order.customername || "—"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Order Date</span>
                    <span className="font-mono text-sm font-medium">{fmt(order.salesorderdate)}</span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-muted-foreground">Confirmed Ship Date</span>
                    <span className="font-mono text-sm font-medium">{fmt(order.confirmedshipdate)}</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Pick status: components still remaining to pick */}
        <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid="pick-status-card">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <PackageCheck className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pick Status</span>
            {pickLoaded && (
              <span
                className={`ml-auto w-2.5 h-2.5 rounded-full shrink-0 ${pickItems?.length ? "bg-red-500" : "bg-emerald-500"}`}
                data-testid={`dot-pick-${prodid}`}
                aria-label={pickItems?.length ? "Items remaining to pick" : "All items picked"}
              />
            )}
          </div>
          {!pickLoaded ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {pickError ? "Pick status unavailable" : <span className="animate-pulse">Loading pick status…</span>}
            </div>
          ) : pickItems?.length ? (
            <>
              <div className="px-4 pt-3 text-xs font-semibold text-red-700" data-testid="text-pick-remaining">
                {pickItems.length} item{pickItems.length !== 1 ? "s" : ""} remaining to pick
              </div>
              <ul className="divide-y divide-border/50">
                {pickItems.map(it => (
                  <li key={it.itemnumber} className="px-4 py-3 flex items-start justify-between gap-3" data-testid={`pick-item-${it.itemnumber}`}>
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-medium">{it.itemnumber}</div>
                      {it.description && (
                        <div className="text-xs text-muted-foreground truncate">{it.description}</div>
                      )}
                    </div>
                    <span className="font-mono text-sm tabular-nums shrink-0">
                      {Number(it.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      {it.unit ? ` ${it.unit}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="p-4 flex items-center gap-2 text-sm font-medium text-emerald-700" data-testid="text-pick-complete">
              <PackageCheck className="w-4 h-4 shrink-0" />
              All items picked
            </div>
          )}
        </div>

        {/* Routing operations */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Routing Operations</span>
            {routes && routes.length > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">{routes.length} ops</span>
            )}
          </div>

          {loadingRoutes ? (
            <div className="p-4 text-center text-sm text-muted-foreground animate-pulse">Loading operations…</div>
          ) : routeError ? (
            <div className="p-4 text-center text-sm text-red-700">Failed to load route details</div>
          ) : !routes || routes.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No routing details available</div>
          ) : (
            <>
              <div className="divide-y divide-border/50">
                {visibleRoutes.map((route, idx) => (
                  <div key={idx} className="px-4 py-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-muted-foreground shrink-0">#{route.operationnumber}</span>
                        <span className="font-medium text-sm truncate">{route.operationname || "—"}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[11px] border shrink-0 ${statusColor(route.status)}`}>
                        {statusLabel(route.status)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      {route.workcenterid && (
                        <span className="font-mono">{route.workcenterid}</span>
                      )}
                      {route.schedulefromdate && (
                        <span>{fmt(route.schedulefromdate)}{route.scheduledenddate ? ` – ${fmt(route.scheduledenddate)}` : ""}</span>
                      )}
                      {(route.setuptime != null || route.processtime != null) && (
                        <span>
                          Setup: {route.setuptime ?? 0}h · Process: {route.processtime ?? 0}h
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {routes.length > 3 && (
                <button
                  className="w-full flex items-center justify-center gap-1.5 py-3 text-sm text-muted-foreground border-t border-border hover:text-foreground transition-colors"
                  onClick={() => setRoutesExpanded(v => !v)}
                >
                  {routesExpanded
                    ? <><ChevronUp className="w-4 h-4" /> Show less</>
                    : <><ChevronDown className="w-4 h-4" /> Show all {routes.length} operations</>
                  }
                </button>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
