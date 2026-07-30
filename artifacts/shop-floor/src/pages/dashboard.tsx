import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetProductionBoardQueryOptions,
  getGetProductionSyncStatusQueryOptions,
  getGetProductionGroupsQueryOptions,
  getGetProductionPickingQueryOptions,
  getGetProductionUtilizationQueryOptions,
  getGetUnallocatedOrderDetailsQueryOptions,
  useUpdateProductionGroup,
  type BoardOrder,
  type UtilizationEntry,
} from "@workspace/api-client-react";
import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { toast } from "sonner";
import { fmtHours } from "@/lib/fmt";
import {
  startOfWeek, eachDayOfInterval, format, addWeeks, subWeeks, addDays,
  isSameDay, startOfDay, parseISO, differenceInCalendarDays,
} from "date-fns";
import {
  ChevronLeft, ChevronRight, BarChart2, CalendarDays, AlertTriangle, Clock,
  Filter, X, Search, RefreshCw, Bookmark, BookmarkPlus, Trash2, ChevronDown,
  Info, ArrowUpDown, User, Gauge, ArrowUp, ArrowDown, Table as TableIcon,
  Pencil,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useSearch, useLocation } from "wouter";
// Group constants and pure grouping/sorting logic live in board-logic.ts so
// they can be unit-tested. See that module for the full documentation.
import {
  FILTER_GROUPS, FAMILY_FILTERS, UNASSIGNED_KEY, buildBoardData,
  sortDayOrders as sortDayOrdersPure, getOrdersForDay as getOrdersForDayPure,
  toDateStr, type CardSortOrder,
} from "./board-logic";

// ── Status helpers ────────────────────────────────────────────────────────────
// D365FO status codes: 0=Created,1=Estimated,2=Scheduled,3=Released,
//                      4=Started,5=ReportedAsFinished,6=Ended,7=Ordered
const STATUS_LABELS: Record<number, string> = {
  0: "Created", 1: "Estimated", 2: "Scheduled", 3: "Released",
  4: "Started",  5: "Reported",  6: "Ended",     7: "Ordered",
};

const ALL_STATUSES = [
  { value: 4, label: "Started" },
  { value: 3, label: "Released" },
  { value: 2, label: "Scheduled" },
  { value: 1, label: "Estimated" },
  { value: 5, label: "Reported" },
  { value: 7, label: "Ordered" },
  { value: 6, label: "Ended" },
];

// Status dot color for the filter panel chips
const STATUS_DOT: Record<number, string> = {
  3: "bg-blue-500", 4: "bg-green-500", 5: "bg-gray-500",
  1: "bg-amber-500", 2: "bg-indigo-500", 6: "bg-purple-500",
  0: "bg-orange-500", 7: "bg-orange-500",
};

// ── Resource color palette ────────────────────────────────────────────────────
const RESOURCE_PALETTE = [
  { card: "bg-slate-100 border-slate-300",           dot: "bg-slate-400",        label: "text-slate-600"        },
] as const;

type Tab = "board" | "unscheduled" | "utilization";

// ── URL filter helpers ────────────────────────────────────────────────────────
function parseSearchParams(search: string) {
  const params = new URLSearchParams(search);
  const q = params.get("q") ?? "";
  const statusRaw = params.get("status") ?? "";
  const groupRaw  = params.get("group")  ?? "";
  const statuses: number[] = statusRaw
    ? statusRaw.split(",").map(Number).filter((n) => !isNaN(n))
    : [];
  const groups: string[] = groupRaw
    ? groupRaw.split(",").map(decodeURIComponent).filter(Boolean)
    : [];
  return { q, statuses, groups };
}

function buildSearchString(q: string, statuses: number[], groups: string[]) {
  const params = new URLSearchParams();
  if (q)               params.set("q",      q);
  if (statuses.length) params.set("status", statuses.join(","));
  if (groups.length)   params.set("group",  groups.map(encodeURIComponent).join(","));
  const str = params.toString();
  return str ? `?${str}` : "";
}

// ── Date utils ────────────────────────────────────────────────────────────────
function fmtShort(d: string | null | undefined) {
  if (!d) return "";
  try { return format(parseISO(toDateStr(d)), "MMM d"); } catch { return d; }
}

// Progress bar: share of scheduled duration (hours) consumed by posted/registered
// hours. Renders nothing when there is no scheduled time to measure against.
export function HoursProgress({
  consumed,
  total,
  endDate,
  expected,
}: {
  consumed: number | null | undefined;
  total: number | null | undefined;
  endDate?: string | null;
  // Expected posted hours by now (pace); renders a tick marker on the bar.
  expected?: number | null;
}) {
  if (!total || total <= 0) return null;
  const done = consumed ?? 0;
  const ratio = done / total;
  const pct = Math.round(ratio * 100);
  const clamped = Math.min(100, Math.max(0, ratio * 100));
  const behind = expected != null && expected > 0 && (done - expected) < -0.05;
  const barColor = behind
    ? "bg-red-500"
    : "bg-emerald-500";
  // Expected-pace tick position (% of bar). Only shown when meaningful.
  const expectedPct = expected != null && expected >= 0
    ? Math.min(100, Math.max(0, (expected / total) * 100))
    : null;
  return (
    <div className="mt-0.5">
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden ring-1 ring-inset ring-border">
        <div
          className={`h-full rounded-full ${barColor} transition-all`}
          style={{ width: `${clamped}%` }}
        />
        {expectedPct != null && (
          <div
            data-testid="tick-expected-pace"
            title="Target Hours progress by now"
            className="absolute top-0 h-full w-1 bg-foreground rounded-sm z-10 shadow border border-background"
            style={{ left: `calc(${expectedPct}% - 2px)` }}
          />
        )}
      </div>
      {(() => {
        const exp = expected ?? null;
        const expPct = exp != null && total > 0
          ? Math.min(100, Math.max(0, Math.round((exp / total) * 100)))
          : null;
        const delta = exp != null ? done - exp : null;
        const behind = delta != null && delta < -0.05;
        const over = ratio > 1 && delta != null && delta > 0.05;
        const ahead = delta != null && delta > 0.05 && !over;
        return (
          <div className="text-[10px] text-foreground mt-0.5 tabular-nums flex items-center gap-1 flex-wrap">
            <span className="text-muted-foreground">Posted Hours</span>
            <span className="font-bold">{pct}%</span>
            {expPct != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">Target Hours</span>
                <span className="font-bold">{expPct}%</span>
              </>
            )}
            {delta != null && (
              <>
                <span className="text-muted-foreground">·</span>
                {behind && (
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {fmtHours(Math.abs(delta))} Behind Target Hours
                  </span>
                )}
                {over && (
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {fmtHours(delta)} Over Target Hours
                  </span>
                )}
                {ahead && (
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {fmtHours(delta)} Ahead Target Hours
                  </span>
                )}
                {!behind && !over && !ahead && (
                  <span className="font-semibold text-muted-foreground">On Schedule Target Hours</span>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── Board card pick tooltip + status dot ─────────────────────────────────────
// Rich hover tooltip on each Schedule Board card: full card details, the BOM
// components still remaining to pick, and the production group name at the
// bottom. /production-picking only returns orders WITH remaining lines, so an
// order missing from the map is fully picked — but only once the picking query
// has actually loaded (pickLoaded).
type PickItemT = { itemnumber: string; description?: string | null; remaining: number; unit?: string | null };

export function PickStatusDot({ loaded, hasRemaining, prodid }: { loaded: boolean; hasRemaining: boolean; prodid: string }) {
  if (!loaded) return null;
  return (
    <span
      data-testid={`dot-pick-${prodid}`}
      aria-label={hasRemaining ? "Items remaining to pick" : "All items picked"}
      className={`w-2 h-2 rounded-full shrink-0 ${hasRemaining ? "bg-red-500" : "bg-emerald-500"}`}
    />
  );
}

export function OrderCardTooltip({
  order,
  pickItems,
  pickLoaded,
  pickError,
  groupName,
  children,
}: {
  order: BoardOrder;
  pickItems: PickItemT[] | undefined;
  pickLoaded: boolean;
  pickError?: boolean;
  groupName: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        className="max-w-md bg-slate-100 text-popover-foreground border border-slate-300 shadow-lg p-3 text-left"
      >
        <div className="space-y-1.5">
          <div className="text-sm">
            <span className="font-mono font-bold">{order.prodid}</span>
            {order.itemname && <span className="text-muted-foreground"> · {order.itemname}</span>}
          </div>
          {(order.productconfiguration || order.prodqty != null) && (
            <div className="text-xs text-muted-foreground">
              {order.productconfiguration && <>Config: {order.productconfiguration}</>}
              {order.prodqty != null && (
                <>{order.productconfiguration ? " · " : ""}Qty: <span className="font-mono">{Number(order.prodqty).toLocaleString()}</span></>
              )}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            {fmtShort(order.schedulefromdate)}
            {order.scheduledenddate && ` → ${fmtShort(order.scheduledenddate)}`}
            {" · "}
            {fmtHours(order.totalscheduledtime)}
            {(() => {
              const eStr = (order.scheduledenddate as string | null | undefined)?.substring(0, 10);
              if (!eStr) return null;
              const daysLate = differenceInCalendarDays(new Date(), parseISO(eStr));
              if (daysLate <= 0) return null;
              return <span className="text-red-500 font-semibold"> · {daysLate}d Late</span>;
            })()}
          </div>
          <div className="border-t border-border pt-1.5">
            {!pickLoaded ? (
              <div className="text-xs text-muted-foreground">{pickError ? "Pick status unavailable" : "Loading pick status…"}</div>
            ) : pickItems?.length ? (
              <>
                <div className="text-xs font-semibold text-red-600 dark:text-red-400 mb-0.5">Remaining to pick:</div>
                <ul className="text-xs space-y-0.5 max-h-48 overflow-y-auto pr-1">
                  {pickItems.map((it) => (
                    <li key={it.itemnumber} className="whitespace-nowrap">
                      <span className="font-mono tabular-nums">
                        {Number(it.remaining).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        {it.unit ? ` ${it.unit}` : ""}
                      </span>
                      {" - "}
                      <span className="font-mono">{it.itemnumber}</span>
                      {it.description && <span className="text-muted-foreground"> : {it.description}</span>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">All items picked</div>
            )}
          </div>
          {(() => {
            const total = order.totalscheduledtime as number | null | undefined;
            if (!total || total <= 0) return null;
            const done = (order.consumedhours as number | null | undefined) ?? 0;
            const ratio = done / total;
            const pct = Math.round(ratio * 100);
            const clamped = Math.min(100, Math.max(0, ratio * 100));
            const eStr = (order.scheduledenddate as string | null | undefined)?.substring(0, 10) ?? "";
            const overdue = !!eStr && startOfDay(parseISO(eStr)) < startOfDay(new Date());
            const exp = (order.expectedconsumedhours as number | null | undefined) ?? null;
            const behind = exp != null && exp > 0 && (done - exp) < -0.05;
            const barColor = behind ? "bg-red-500" : "bg-emerald-500";
            return (
              <div className="border-t border-border pt-1.5">
                <div className="text-xs font-semibold text-foreground mb-1 flex items-center gap-1.5">
                  Posted Hours
                  {overdue && <span className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wide">· Past due</span>}
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden mb-0.5 ring-1 ring-inset ring-border">
                  <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${clamped}%` }} />
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {fmtHours(done)} of {fmtHours(total)} posted ({pct}%)
                </div>
                {(() => {
                  const exp = order.expectedconsumedhours as number | null | undefined;
                  if (exp == null) return null;
                  const delta = done - exp;
                  const behind = delta < -0.05;
                  const over = ratio > 1 && delta > 0.05;
                  const ahead = delta > 0.05 && !over;
                  return (
                    <div className="text-xs tabular-nums mt-0.5">
                      <span className="text-muted-foreground">Posted Hours: {fmtHours(done)} · Target Hours: {fmtHours(exp)}</span>{" "}
                      {behind && (
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {fmtHours(Math.abs(delta))} Behind Target Hours
                        </span>
                      )}
                      {over && (
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          {fmtHours(delta)} Over Target Hours
                        </span>
                      )}
                      {ahead && (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          {fmtHours(delta)} Ahead Target Hours
                        </span>
                      )}
                      {!behind && !over && !ahead && (
                        <span className="font-semibold text-muted-foreground">On Schedule Target Hours</span>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })()}
          <div className="border-t border-border pt-1.5 text-xs text-muted-foreground">
            <span>Pool: {order.productionpool ?? "Unassigned"}</span>
            {order.demandproductionordernumber && (
              <span> · Ref: <span className="font-mono">{order.demandproductionordernumber}</span></span>
            )}
            <span> · </span>
            <span>{groupName}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Resource Utilization (bottom-of-board weekly section) ────────────────────
// Aggregates posted labor hours (from /production-utilization) for the visible
// week window and shows, per production group: capacity (8h × Mon–Fri ×
// weeksToShow) vs posted hours + utilization %, a per-day Mon–Fri breakdown, a
// flag for board orders assigned to the group with zero posted hours this week,
// and a per-order → per-operation → per-day drill-down.
type UtilOp = { opnum: number | null; opname: string | null; perDay: Record<string, number>; total: number };
type UtilOrder = { itemname: string | null; total: number; ops: Record<string, UtilOp> };
type UtilGroup = { total: number; perDay: Record<string, number>; orders: Record<string, UtilOrder> };

export function ResourceUtilization({
  utilization,
  days,
  weeksToShow,
  visibleGroups,
  groupNameMap,
  groupedOrders,
  onOpenOrder,
}: {
  utilization: UtilizationEntry[] | undefined;
  days: Date[];
  weeksToShow: number;
  visibleGroups: readonly string[];
  groupNameMap: Record<string, string>;
  groupedOrders: Record<string, BoardOrder[]>;
  onOpenOrder: (prodid: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const dayKeys = useMemo(() => days.map((d) => format(d, "yyyy-MM-dd")), [days]);
  const perGroupCapacity = 8 * 5 * weeksToShow; // 8h × Mon–Fri × weeks shown

  const byGroup = useMemo(() => {
    const map: Record<string, UtilGroup> = {};
    for (const r of utilization ?? []) {
      const g = r.productiongroupid;
      if (!map[g]) map[g] = { total: 0, perDay: {}, orders: {} };
      const gm = map[g];
      gm.total += r.postedhours;
      gm.perDay[r.day] = (gm.perDay[r.day] ?? 0) + r.postedhours;
      if (!gm.orders[r.prodid]) gm.orders[r.prodid] = { itemname: r.itemname ?? null, total: 0, ops: {} };
      const om = gm.orders[r.prodid];
      om.total += r.postedhours;
      const opKey = `${r.operationnumber ?? ""}|${r.operationname ?? ""}`;
      if (!om.ops[opKey]) om.ops[opKey] = { opnum: r.operationnumber ?? null, opname: r.operationname ?? null, perDay: {}, total: 0 };
      om.ops[opKey].perDay[r.day] = (om.ops[opKey].perDay[r.day] ?? 0) + r.postedhours;
      om.ops[opKey].total += r.postedhours;
    }
    return map;
  }, [utilization]);

  // Board orders assigned to each group (across all resource rows, incl. the
  // synthetic Unassigned row), deduped by prodid — used to flag orders with
  // zero posted hours anywhere in the visible week.
  const assignedByGroup = useMemo(() => {
    const m: Record<string, { prodid: string; itemname: string | null }[]> = {};
    for (const g of visibleGroups) {
      const seen = new Set<string>();
      const list: { prodid: string; itemname: string | null }[] = [];
      const orders = groupedOrders[g] ?? [];
      for (const o of orders) {
        const id = o.prodid as string;
        if (seen.has(id)) continue;
        seen.add(id);
        list.push({ prodid: id, itemname: (o.itemname as string) ?? null });
      }
      m[g] = list;
    }
    return m;
  }, [groupedOrders, visibleGroups]);

  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="flex items-center gap-2 mb-3 px-1">
        <Gauge className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Resource Utilization for week</h2>
        <span className="text-[11px] text-muted-foreground">
          {format(days[0], "MMM d")}–{format(days[days.length - 1], "MMM d")} · {perGroupCapacity}h capacity/group
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-1.5 px-2 sticky left-0 bg-background">Group</th>
              <th className="text-right font-medium py-1.5 px-2 whitespace-nowrap">Posted / Cap</th>
              <th className="text-left font-medium py-1.5 px-2 w-40">Utilization</th>
              {dayKeys.map((k, i) => (
                <th key={k} className="text-right font-medium py-1.5 px-2 whitespace-nowrap">{format(days[i], "EEE d")}</th>
              ))}
              <th className="text-left font-medium py-1.5 px-2 whitespace-nowrap">No hours posted</th>
            </tr>
          </thead>
          <tbody>
            {visibleGroups.map((g) => {
              const gm = byGroup[g];
              const posted = gm?.total ?? 0;
              const ratio = perGroupCapacity > 0 ? posted / perGroupCapacity : 0;
              const pct = Math.round(ratio * 100);
              const barColor = ratio >= 1 ? "bg-red-500" : ratio >= 0.8 ? "bg-amber-500" : ratio > 0 ? "bg-emerald-500" : "bg-muted";
              const assigned = assignedByGroup[g] ?? [];
              const zeroOrders = assigned.filter((o) => !(gm?.orders[o.prodid]));
              const orderIds = gm ? Object.keys(gm.orders).sort() : [];
              const isOpen = !!expanded[g];
              return (
                <Fragment key={g}>
                  <tr
                    className="border-b border-border/60 hover:bg-muted/20 cursor-pointer"
                    onClick={() => setExpanded((e) => ({ ...e, [g]: !e[g] }))}
                    data-testid={`row-util-${g}`}
                  >
                    <td className="py-1.5 px-2 font-medium sticky left-0 bg-background">
                      <span className="inline-flex items-center gap-1">
                        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? "" : "-rotate-90"} ${orderIds.length ? "opacity-70" : "opacity-0"}`} />
                        {groupNameMap[g] ?? g}
                      </span>
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
                      <span className="font-bold">{fmt1(posted)}</span>
                      <span className="text-muted-foreground"> / {perGroupCapacity}</span>
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 min-w-16 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                        </div>
                        <span className="tabular-nums font-semibold w-9 text-right">{pct}%</span>
                      </div>
                    </td>
                    {dayKeys.map((k) => {
                      const h = gm?.perDay[k] ?? 0;
                      return (
                        <td key={k} className={`py-1.5 px-2 text-right tabular-nums ${h > 0 ? "" : "text-muted-foreground/40"}`}>
                          {h > 0 ? fmt1(h) : "·"}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2">
                      {zeroOrders.length > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 text-amber-700 bg-amber-500/15 border border-amber-500/30 rounded px-1.5 py-0.5 whitespace-nowrap"
                          title={zeroOrders.map((o) => o.prodid).join(", ")}
                        >
                          <AlertTriangle className="w-3 h-3" />
                          {zeroOrders.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </tr>

                  {isOpen && orderIds.length === 0 && zeroOrders.length === 0 && (
                    <tr key={`${g}-drill-empty`}>
                      <td colSpan={4 + dayKeys.length} className="bg-muted/10 px-2 py-2">
                        <div className="text-muted-foreground py-1">No posted hours this week.</div>
                      </td>
                    </tr>
                  )}
                  {isOpen && orderIds.length > 0 && (
                    <tr key={`${g}-drill-head`} className="bg-muted/10 text-muted-foreground text-[11px]">
                      <td className="py-1 px-2 font-medium sticky left-0 bg-background">Order</td>
                      <td colSpan={2} className="py-1 px-2 font-medium text-left">Operation</td>
                      {dayKeys.map((k, i) => (
                        <td key={k} className="py-1 px-2 font-medium text-right whitespace-nowrap">{format(days[i], "EEE")}</td>
                      ))}
                      <td className="py-1 px-2 font-medium text-right">Total</td>
                    </tr>
                  )}
                  {isOpen && orderIds.length > 0 && orderIds.map((prodid) => {
                    const om = gm!.orders[prodid];
                    const opKeys = Object.keys(om.ops).sort((a, b) => (om.ops[a].opnum ?? 0) - (om.ops[b].opnum ?? 0));
                    return opKeys.map((opKey, idx) => {
                      const op = om.ops[opKey];
                      return (
                        <tr key={`${g}-${prodid}-${opKey}`} className="bg-muted/10 border-t border-border/40 text-[11px]">
                          <td className="py-1 px-2 align-top sticky left-0 bg-background">
                            {idx === 0 ? (
                              <button
                                className="font-mono font-bold hover:underline underline-offset-2"
                                onClick={() => onOpenOrder(prodid)}
                                data-testid={`link-util-order-${prodid}`}
                              >
                                {prodid}
                              </button>
                            ) : null}
                            {idx === 0 && om.itemname && (
                              <div className="text-muted-foreground line-clamp-1 max-w-52">{om.itemname}</div>
                            )}
                          </td>
                          <td colSpan={2} className="py-1 px-2 whitespace-nowrap">
                            {op.opnum != null && <span className="text-muted-foreground mr-1">{op.opnum}</span>}
                            {op.opname ?? "—"}
                          </td>
                          {dayKeys.map((k) => {
                            const h = op.perDay[k] ?? 0;
                            return (
                              <td key={k} className={`py-1 px-2 text-right tabular-nums ${h > 0 ? "" : "text-muted-foreground/30"}`}>
                                {h > 0 ? fmt1(h) : "·"}
                              </td>
                            );
                          })}
                          <td className="py-1 px-2 text-right tabular-nums font-semibold">{fmt1(op.total)}</td>
                        </tr>
                      );
                    });
                  })}
                  {isOpen && zeroOrders.length > 0 && (
                    <tr key={`${g}-drill-zero`}>
                      <td colSpan={4 + dayKeys.length} className="bg-muted/10 px-2 py-2">
                        <div className="mt-2 pt-2 border-t border-border/40">
                            <div className="text-[11px] font-medium text-amber-700 mb-1 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Assigned to this group, zero hours posted this week
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {zeroOrders.map((o) => (
                                <button
                                  key={o.prodid}
                                  onClick={() => onOpenOrder(o.prodid)}
                                  className="inline-flex items-center gap-1 text-[11px] font-mono bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 hover:bg-amber-500/20"
                                  title={o.itemname ?? undefined}
                                  data-testid={`chip-util-zero-${o.prodid}`}
                                >
                                  {o.prodid}
                                </button>
                              ))}
                            </div>
                          </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Card sort order ───────────────────────────────────────────────────────────
const CARD_SORT_KEY = "shop-floor-card-sort";

function loadCardSort(): CardSortOrder {
  try {
    const raw = localStorage.getItem(CARD_SORT_KEY);
    if (raw === "time-desc" || raw === "time-asc" || raw === "prodid") return raw;
    return "prodid";
  } catch {
    return "prodid";
  }
}

function saveCardSort(v: CardSortOrder) {
  localStorage.setItem(CARD_SORT_KEY, v);
}

// ── Filter presets ─────────────────────────────────────────────────────────────
const PRESETS_KEY = "shop-floor-filter-presets";

// ── Sync-triggered refresh ─────────────────────────────────────────────────────
// The board refreshes only when D365 actually lands new data in the staging
// tables (a common trigger for all users), not on a per-user timer. We poll a
// lightweight sync-status endpoint and refetch the full data when the staging
// sync timestamp advances.
const SYNC_CHECK_MS = 60 * 1000; // how often to check the staging sync timestamp

// Watch the sync-status result and invalidate the board/utilization/picking
// queries exactly once per completed D365 batch export.
//
// A single batch export lands over several minutes and the staging sync
// timestamp advances progressively while rows insert, so refreshing the moment
// the timestamp changes can fire mid-export (double refresh + partially-loaded
// data). Instead we use a settle window: an advancing timestamp only marks a
// refresh as PENDING; the refresh fires when a subsequent probe returns the
// SAME timestamp again (the export has been quiet for a full probe interval).
//
// - First result seeds the baseline WITHOUT refetching (mount already fetched
//   fresh data).
// - An unchanged timestamp with nothing pending does nothing (no refetch storm).
// - `probedAt` must change on every probe completion (react-query's
//   dataUpdatedAt): structural sharing returns the identical object for an
//   unchanged payload, so the data alone can't signal "same value seen twice".
// True when `candidate` is strictly newer than `baseline`. A null/invalid
// candidate is never "newer"; any valid timestamp is newer than a null
// baseline. Exported for tests (dashboard-sync-refresh.test.tsx).
export function isNewerTimestamp(
  candidate: string | null,
  baseline: string | null | undefined,
): boolean {
  if (candidate === null) return false;
  const c = Date.parse(candidate);
  if (Number.isNaN(c)) return false;
  if (baseline == null) return true;
  const b = Date.parse(baseline);
  if (Number.isNaN(b)) return true;
  return c > b;
}

// Exported for tests (dashboard-sync-refresh.test.tsx).
export function useSyncTriggeredRefresh(
  syncStatus: { lastsync?: string | null; overlaylastupdated?: string | null } | undefined,
  probedAt: number,
) {
  const queryClient = useQueryClient();
  // lastsync: settle-window logic — D365 batch exports land over several
  // minutes, so we wait for the timestamp to hold steady across two probes
  // before refreshing (avoids a double-fetch mid-export).
  const prevLastsyncRef = useRef<string | null | undefined>(undefined);
  const settledLastsyncRef = useRef<string | null | undefined>(undefined);
  const lastsyncPendingRef = useRef(false);
  // overlaylastupdated: fire immediately on first advance — overlay writes are
  // atomic single-row upserts (not multi-minute batches), so they don't need a
  // settle window. This guarantees a group move appears within one probe cycle.
  const settledOverlayRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (syncStatus === undefined) return;
    const currentLastsync = syncStatus.lastsync ?? null;
    const currentOverlay = syncStatus.overlaylastupdated ?? null;
    if (prevLastsyncRef.current === undefined) {
      // First probe result: record the baseline, don't refetch (initial
      // load-on-mount already fetched the freshest data).
      prevLastsyncRef.current = currentLastsync;
      settledLastsyncRef.current = currentLastsync;
      settledOverlayRef.current = currentOverlay;
      return;
    }
    // overlaylastupdated: fire immediately when it advances (no settle window).
    if (isNewerTimestamp(currentOverlay, settledOverlayRef.current)) {
      settledOverlayRef.current = currentOverlay;
      queryClient.invalidateQueries({ queryKey: ["/api/production-board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-utilization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-picking"] });
    }
    // lastsync: settle-window — only FORWARD movement queues a refresh; a
    // regression (older value from replica lag / clock skew) must not.
    if (currentLastsync !== prevLastsyncRef.current) {
      lastsyncPendingRef.current = isNewerTimestamp(currentLastsync, prevLastsyncRef.current);
      prevLastsyncRef.current = currentLastsync;
      return;
    }
    if (lastsyncPendingRef.current) {
      // Same lastsync two probes in a row — export settled. Fire once.
      lastsyncPendingRef.current = false;
      if (isNewerTimestamp(currentLastsync, settledLastsyncRef.current)) {
        settledLastsyncRef.current = currentLastsync;
        queryClient.invalidateQueries({ queryKey: ["/api/production-board"] });
        queryClient.invalidateQueries({ queryKey: ["/api/production-utilization"] });
        queryClient.invalidateQueries({ queryKey: ["/api/production-picking"] });
      }
    }
  }, [syncStatus, probedAt, queryClient]);
}

type FilterPreset = {
  id: string;
  name: string;
  q: string;
  statuses: number[];
  groups: string[];
};

function loadPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    return raw ? (JSON.parse(raw) as FilterPreset[]) : [];
  } catch {
    return [];
  }
}

function savePresets(presets: FilterPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

// ── View-state snapshot (persisted to sessionStorage across order drill-down) ──
const VIEW_STATE_KEY = "board-view-state";
// Unallocated section filter persistence (localStorage, survives page reload).
const UNALLOC_FILTERS_KEY = "shop-floor-unalloc-filters";

type SavedViewState = {
  currentDate: string;
  viewSpan: "1w" | "2w";
  selectedGroups: string[];
  groupsTouched: boolean;
  boardSearch: string;
  unallocPoolFilter?: string[];
  unallocPoolTouched?: boolean;
};

type UnallocFiltersState = {
  pool: string[];
  poolTouched?: boolean;
};

function readUnallocFilters(): UnallocFiltersState {
  try {
    const raw = localStorage.getItem(UNALLOC_FILTERS_KEY);
    if (!raw) return { pool: [], poolTouched: false };
    const parsed = JSON.parse(raw) as UnallocFiltersState;
    return {
      pool: Array.isArray(parsed.pool) ? parsed.pool : [],
      poolTouched: parsed.poolTouched ?? false,
    };
  } catch { return { pool: [], poolTouched: false }; }
}

function writeUnallocFilters(pool: Set<string>, poolTouched: boolean) {
  localStorage.setItem(
    UNALLOC_FILTERS_KEY,
    JSON.stringify({ pool: [...pool], poolTouched }),
  );
}

// Board status + production-group pill filter persistence (localStorage,
// survives page reloads). Written at each mutation point so clearing a filter
// also clears its persisted value.
const BOARD_FILTERS_KEY = "shop-floor-board-filters";

type BoardFiltersState = {
  statuses: number[];
  selectedGroups: string[];
  groupsTouched: boolean;
};

function readBoardFilters(): BoardFiltersState {
  try {
    const raw = localStorage.getItem(BOARD_FILTERS_KEY);
    return raw
      ? (JSON.parse(raw) as BoardFiltersState)
      : { statuses: [], selectedGroups: [], groupsTouched: false };
  } catch { return { statuses: [], selectedGroups: [], groupsTouched: false }; }
}

function writeBoardFilters(
  statuses: number[],
  selectedGroups: Iterable<string>,
  groupsTouched: boolean,
) {
  try {
    localStorage.setItem(
      BOARD_FILTERS_KEY,
      JSON.stringify({ statuses, selectedGroups: [...selectedGroups], groupsTouched }),
    );
  } catch { /* storage unavailable — filters just won't persist */ }
}

function readSavedView(): SavedViewState | null {
  try {
    const raw = sessionStorage.getItem(VIEW_STATE_KEY);
    return raw ? (JSON.parse(raw) as SavedViewState) : null;
  } catch { return null; }
}

// ── Component ─────────────────────────────────────────────────────────────────
export function Dashboard() {
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const s = readSavedView();
    return s?.currentDate ? new Date(s.currentDate) : new Date();
  });
  const [activeTab, setActiveTab] = useState<Tab>("board");
  const [viewSpan, setViewSpan] = useState<"1w" | "2w">(() => {
    const s = readSavedView();
    return s?.viewSpan ?? "1w";
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>(loadPresets);
  const [savePresetName, setSavePresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [cardSort, setCardSort] = useState<CardSortOrder>(loadCardSort);
  // Schedule Board production-group pill filter (local view state). Untouched =
  // every group selected (default All).
  // Initialised from sessionStorage (navigate-back) or localStorage (reload).
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(() => {
    const s = readSavedView();
    if (s?.selectedGroups) return new Set(s.selectedGroups);
    return new Set(readBoardFilters().selectedGroups);
  });
  const [groupsTouched, setGroupsTouched] = useState<boolean>(() => {
    const s = readSavedView();
    if (s) return s.groupsTouched;
    return readBoardFilters().groupsTouched;
  });
  // Unallocated section pool filter. Untouched = All. Once touched, only selected
  // values pass; an empty selected set means None.
  const [unallocPoolFilter, setUnallocPoolFilter] = useState<Set<string>>(() => {
    const sv = readSavedView();
    if (sv?.unallocPoolFilter) return new Set(sv.unallocPoolFilter);
    return new Set(readUnallocFilters().pool);
  });
  const [unallocPoolTouched, setUnallocPoolTouched] = useState<boolean>(() => {
    const sv = readSavedView();
    if (sv?.unallocPoolTouched !== undefined) return sv.unallocPoolTouched;
    // Backwards compatibility: old empty array meant All (untouched); non-empty
    // array meant explicit selection (touched).
    const saved = readUnallocFilters().pool;
    return saved.length > 0 ? true : false;
  });
  const [boardSearch, setBoardSearch] = useState<string>(() => {
    const s = readSavedView();
    return s?.boardSearch ?? "";
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const presetsPanelRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const unallocatedSectionRef = useRef<HTMLElement>(null);
  const SCROLL_KEY = "board-scroll-top";

  // URL-synced filter state
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { q, statuses: activeStatuses, groups: activeGroups } = parseSearchParams(search);

  // Working week: Monday → Friday (5 working days, 8h each). Weekends are not
  // working days, so the board only shows Mon–Fri columns. The view span toggle
  // lets the user see one week (5 columns) or two weeks (10 columns).
  const weeksToShow = viewSpan === "2w" ? 2 : 1;
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd   = addDays(weekStart, weeksToShow * 7 - 3); // last Friday in range
  const days      = eachDayOfInterval({ start: weekStart, end: weekEnd })
    .filter((d) => { const dow = d.getDay(); return dow !== 0 && dow !== 6; });

  // Fetch a wide window (1 wk before → 6 wks after) to include in-progress orders
  const fromDate = format(subWeeks(weekStart, 1), "yyyy-MM-dd");
  const toDate   = format(addWeeks(weekEnd,   6), "yyyy-MM-dd");

  const { data: boardOrders, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useQuery({
    ...getGetProductionBoardQueryOptions({ fromDate, toDate }),
    // Sync-triggered refresh only: no timer, no refetch when the tab regains
    // focus. Data loads on mount and refetches when the sync watcher below
    // detects that D365 landed new data in staging.
    refetchOnWindowFocus: false,
  });

  // ── Sync watcher ─────────────────────────────────────────────────────────
  // Poll the lightweight sync-status endpoint; when the staging sync timestamp
  // advances AND then holds steady for a full probe interval (the export has
  // finished landing), refetch the full board data exactly once. This is the
  // single common refresh trigger shared by all users.
  const { data: syncStatus, dataUpdatedAt: syncProbedAt } = useQuery({
    ...getGetProductionSyncStatusQueryOptions(),
    refetchInterval: SYNC_CHECK_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });
  useSyncTriggeredRefresh(syncStatus, syncProbedAt);

  // Posted labor hours for the visible week window (Mon → last Friday shown),
  // for the bottom Resource Utilization section. Keyed to the exact days[] range
  // so it tracks week navigation and the 1w/2w span toggle.
  const utilFrom = format(weekStart, "yyyy-MM-dd");
  const utilTo   = format(weekEnd,   "yyyy-MM-dd");
  const { data: utilization } = useQuery({
    ...getGetProductionUtilizationQueryOptions({ fromDate: utilFrom, toDate: utilTo }),
    refetchOnWindowFocus: false,
  });

  // Production group id -> display name (for section headers, incl. empty groups).
  // Some D365 group names lead with a code that doesn't match the real group id
  // (e.g. id "Inst01" is named "Instr01- Rodney"). When the name's leading
  // code-like token has the same digits but differs from the id, swap it for
  // the true group id so sections are always labeled by their actual id.
  const { data: productionGroups } = useQuery({
    ...getGetProductionGroupsQueryOptions(),
    refetchOnWindowFocus: false,
  });
  const groupNameMap = useMemo(() => {
    const normalize = (id: string, name: string): string => {
      const m = name.match(/^([A-Za-z]+\d+)(.*)$/);
      if (!m) return name;
      const [, token, rest] = m;
      if (token.toLowerCase() === id.toLowerCase()) return name;
      const idDigits = id.match(/\d+$/)?.[0];
      const tokenDigits = token.match(/\d+$/)?.[0];
      if (idDigits && idDigits === tokenDigits) return `${id}${rest}`;
      return name;
    };
    const m: Record<string, string> = {};
    const safeGroups = Array.isArray(productionGroups)
        ? productionGroups
        : [];
    for (const g of safeGroups ?? []) {
      if (g.groupname) m[g.groupid] = normalize(g.groupid, g.groupname);
    }
    return m;
  }, [productionGroups]);

  // Options for the "Change production group" dialog: ONLY the board's own
  // pill groups (Assy01-10 excl. retired Assy08, Inst01-03, Paint), in board
  // order. All other D365 groups (incl. GenAssy/GenInstr) are excluded so
  // orders can't be moved off the board from here.
  const groupSelectOptions = useMemo(() => {
    // const byId = new Map((productionGroups ?? []).map((g) => [g.groupid, g]));
    const groups = Array.isArray(productionGroups)
        ? productionGroups: [];
          const byId = new Map(
          groups.map((g) => [g.groupid, g])
        );
    return FILTER_GROUPS.map(
      (id) => byId.get(id) ?? { groupid: id, groupname: undefined },
    );
  }, [productionGroups]);

  // Production-group editor: changes are written to D365 F&O in real time via
  // the API (OData write-back), then the board refetches to show the new group.
  const [groupEdit, setGroupEdit] = useState<{ prodid: string; current: string } | null>(null);
  const [groupEditValue, setGroupEditValue] = useState("");
  const updateGroupMutation = useUpdateProductionGroup({
    mutation: {
      onSuccess: (data) => {
        toast.success(`Order ${data.prodid} moved to ${groupNameMap[data.groupid] ?? data.groupid}`, {
          description: "Change synced to Dynamics 365",
        });
        setGroupEdit(null);
        refetch();
      },
      onError: (err) => {
        const e = err as { data?: { message?: string } | null; message?: string } | null;
        const msg = e?.data?.message ?? e?.message ?? "Failed to update production group";
        toast.error("Production group update failed", { description: msg, duration: 10000 });
      },
    },
  });

  function openGroupEdit(order: BoardOrder, e: React.MouseEvent) {
    e.stopPropagation();
    const current = (order.productiongroupid as string) ?? "";
    setGroupEdit({ prodid: order.prodid as string, current });
    setGroupEditValue(current === "(ungrouped)" ? "" : current);
  }

  // Raw production-order data grid for the Unallocated section (dialog view).
  // Only fetched when the grid dialog is opened.
  const [showUnallocGrid, setShowUnallocGrid] = useState(false);
  const { data: unallocDetails, isLoading: loadingUnallocDetails } = useQuery({
    ...getGetUnallocatedOrderDetailsQueryOptions(),
    enabled: showUnallocGrid,
    refetchOnWindowFocus: false,
  });

  // Per-order components still remaining to pick (fetched separately; cached
  // server-side because the aggregate is slow). Keyed by production order id.
  const { data: pickingData, isError: pickError } = useQuery({
    ...getGetProductionPickingQueryOptions(),
    refetchOnWindowFocus: false,
  });
  const pickLoaded = pickingData !== undefined;
  const pickMap = useMemo(() => {
    const m: Record<string, { itemnumber: string; description?: string | null; remaining: number; unit?: string | null }[]> = {};
    for (const p of pickingData ?? []) m[p.prodid] = p.items;
    return m;
  }, [pickingData]);

  function handleCardSortChange(v: CardSortOrder) {
    setCardSort(v);
    saveCardSort(v);
  }

  function sortDayOrders(orders: BoardOrder[]): BoardOrder[] {
    return sortDayOrdersPure(orders, cardSort);
  }

  // Show a toast when a background refetch brings in fresh data (not on first load)
  const prevDataUpdatedAtRef = useRef<number>(0);
  const hasLoadedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    if (isFetching) return;
    if (!dataUpdatedAt) return;
    if (!hasLoadedOnceRef.current) {
      hasLoadedOnceRef.current = true;
      prevDataUpdatedAtRef.current = dataUpdatedAt;
      return;
    }
    if (dataUpdatedAt !== prevDataUpdatedAtRef.current) {
      prevDataUpdatedAtRef.current = dataUpdatedAt;
      toast.success("Board updated", { duration: 2500 });
    }
  }, [isFetching, dataUpdatedAt]);

  // Last D365 → PostgreSQL sync time: max syncstartdatetime across all board orders
  const lastDataSync = useMemo(() => {
    if (!boardOrders?.length) return null;
    let max: Date | null = null;
    for (const o of boardOrders) {
      if (!o.syncstartdatetime) continue;
      const d = new Date(o.syncstartdatetime);
      if (!max || d > max) max = d;
    }
    return max;
  }, [boardOrders]);

  function formatSyncTime(d: Date): string {
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
      hour12: true,
    });
  }

  // Apply filters then group (pure logic lives in board-logic.ts)
  const { groupedOrders, unscheduledOrders, unallocatedOrders } = useMemo(
    () => buildBoardData(boardOrders, q, activeStatuses, RESOURCE_PALETTE.length),
    [boardOrders, q, activeStatuses],
  );

  // Unique pool values present in unallocated orders, sorted alphabetically.
  const unallocPools = useMemo(() => {
    const s = new Set<string>();
    for (const o of unallocatedOrders) {
      if (o.productionpool) s.add(o.productionpool as string);
    }
    return [...s].sort();
  }, [unallocatedOrders]);

  // Derived early so matchesBoardSearch (below) can close over it without TDZ.
  const boardSearchTerm = boardSearch.trim().toLowerCase();

  // Top-10 autocomplete suggestions from all board orders, deduplicated by
  // prodid (same order can have multiple route-operation rows in the API).
  const suggestions = useMemo<BoardOrder[]>(() => {
    if (!boardSearchTerm || !boardOrders?.length) return [];
    const seen = new Set<string>();
    const result: BoardOrder[] = [];
    for (const o of boardOrders) {
      const pid = String(o.prodid ?? "");
      if (seen.has(pid)) continue;
      const t = boardSearchTerm;
      if (
        pid.toLowerCase().includes(t) ||
        (o.itemname as string ?? "").toLowerCase().includes(t) ||
        (o.resourcecode as string ?? "").toLowerCase().includes(t)
      ) {
        seen.add(pid);
        result.push(o);
        if (result.length >= 10) break;
      }
    }
    return result;
  }, [boardOrders, boardSearchTerm]);

  // Navigate to the week containing an order's start date.
  // Keeps the current viewSpan (Week / 2 Weeks) — no forced expansion.
  function navigateToOrder(order: BoardOrder) {
    const sStr = (order.schedulefromdate as string | null | undefined)?.substring(0, 10);
    if (!sStr) return;
    setCurrentDate(startOfWeek(startOfDay(parseISO(sStr)), { weekStartsOn: 1 }));
  }

  // Called when the user selects a suggestion row.
  function selectSuggestion(order: BoardOrder) {
    setBoardSearch(String(order.prodid ?? ""));
    setShowSuggestions(false);
    setSuggestionIndex(-1);
    navigateToOrder(order);
  }

  // Unallocated orders after applying the pool filter.
  // Untouched pool filter means All; touched empty filter means None.
  const filteredUnallocatedOrders = useMemo(() => {
    return unallocatedOrders.filter(o => {
      if (unallocPoolTouched && !unallocPoolFilter.has(o.productionpool as string)) return false;
      return true;
    });
  }, [unallocatedOrders, unallocPoolFilter, unallocPoolTouched]);

  // Unallocated orders after pool filter AND board search.
  // matchesBoardSearch is defined further down in the component but is hoisted.
  const displayedUnallocatedOrders = useMemo(
    () => (boardSearch.trim() ? filteredUnallocatedOrders.filter(o => matchesBoardSearch(o)) : filteredUnallocatedOrders),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredUnallocatedOrders, boardSearch],
  );

  // Pill-filter selection. Untouched = all filter groups; once touched we honour
  // the explicit set (intersected with the known groups so it can't drift).
  const effectiveGroups = groupsTouched
    ? new Set(FILTER_GROUPS.filter((g) => selectedGroups.has(g)))
    : new Set<string>(FILTER_GROUPS);

  function toggleFilterGroup(group: string) {
    const next = new Set(effectiveGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setSelectedGroups(next);
    setGroupsTouched(true);
    writeBoardFilters(activeStatuses, next, true);
  }
  function toggleFamilyFilter(members: Set<string>) {
    const next = new Set(effectiveGroups);
    const allOn = Array.from(members).every((m) => next.has(m));
    if (allOn) {
      members.forEach((m) => next.delete(m));
    } else {
      members.forEach((m) => next.add(m));
    }
    setSelectedGroups(next);
    setGroupsTouched(true);
    writeBoardFilters(activeStatuses, next, true);
  }
  function selectAllGroups() {
    setSelectedGroups(new Set(FILTER_GROUPS));
    setGroupsTouched(true);
    writeBoardFilters(activeStatuses, FILTER_GROUPS, true);
  }
  function selectNoneGroups() {
    setSelectedGroups(new Set());
    setGroupsTouched(true);
    writeBoardFilters(activeStatuses, [], true);
  }

  // Group sections to render, in display order. Always shown even when empty so
  // planners can see open availability. GenAssy/GenInstr are excluded here —
  // they roll up into the "Unallocated" section.
  const visibleGroups = FILTER_GROUPS.filter((g) => effectiveGroups.has(g));

  // Sections rendered on the board: each visible filter group, then Unallocated.
  // The Unallocated section renders from `unallocatedOrders` (a flat list), not
  // from `resources`, so its resources map is intentionally empty.

  // Centralized predicate — checks order number, item name, resource code/name,
  // and optionally a pre-resolved group label so callers don't repeat logic.
  function matchesBoardSearch(
    o: BoardOrder,
    groupLabel?: string,
  ): boolean {
    if (!boardSearchTerm) return true;
    const fields = [
      (o.prodid as string) ?? "",
      (o.itemname as string) ?? "",
      (o.resourcecode as string) ?? "",
      (o.resourcename as string) ?? "",
      groupLabel ?? groupNameMap[(o.productiongroupid as string) ?? ""] ?? (o.productiongroupid as string) ?? "",
    ];
    return fields.some(f => f.toLowerCase().includes(boardSearchTerm));
  }

  const groupSections = visibleGroups.map((g) => {
    const rawOrders = groupedOrders[g] ?? [];
    const groupLabel = groupNameMap[g] ?? g;
    const orders = boardSearchTerm
      ? rawOrders.filter(o => matchesBoardSearch(o, groupLabel))
      : rawOrders;
    return { key: g, label: groupLabel, orders };
  });
  const sections = [
    // When searching, hide groups with 0 matching orders.
    ...(boardSearchTerm
      ? groupSections.filter(s => s.orders.length > 0)
      : groupSections),
    {
      key: "__unallocated__",
      label: "Unallocated",
      orders: [] as BoardOrder[],
    },
  ];

  // Active filter category count (for badge). Includes the local boardSearch so
  // the chip strip appears whenever any filter — URL-based or the search box — is
  // active, making it clear that multiple filters may be combining.
  const activeFilterCount =
    (q.trim() ? 1 : 0) +
    (activeStatuses.length > 0 ? 1 : 0);

  // URL update helpers
  function setQ(val: string) {
    setLocation(buildSearchString(val, activeStatuses, activeGroups), { replace: true });
  }
  function toggleStatus(status: number) {
    const next = activeStatuses.includes(status)
      ? activeStatuses.filter((s) => s !== status)
      : [...activeStatuses, status];
    setLocation(buildSearchString(q, next, activeGroups), { replace: true });
    writeBoardFilters(next, selectedGroups, groupsTouched);
  }
  function clearAll() {
    setLocation("/", { replace: true });
    // Clearing the URL filters also clears their persisted values.
    writeBoardFilters([], selectedGroups, groupsTouched);
  }

  // Preset actions
  function applyPreset(preset: FilterPreset) {
    setLocation(buildSearchString(preset.q, preset.statuses, preset.groups), { replace: true });
    writeBoardFilters(preset.statuses, selectedGroups, groupsTouched);
    setPresetsOpen(false);
  }

  function deletePreset(id: string) {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    savePresets(next);
  }

  function commitSavePreset() {
    const name = savePresetName.trim();
    if (!name) return;
    const newPreset: FilterPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      q,
      statuses: activeStatuses,
      groups: activeGroups,
    };
    const next = [...presets, newPreset];
    setPresets(next);
    savePresets(next);
    setSavePresetName("");
    setSavingPreset(false);
  }

  // Close filter panel on outside click
  useEffect(() => {
    if (!filtersOpen) return;
    function handler(e: MouseEvent) {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filtersOpen]);

  // Close presets panel on outside click
  useEffect(() => {
    if (!presetsOpen) return;
    function handler(e: MouseEvent) {
      if (presetsPanelRef.current && !presetsPanelRef.current.contains(e.target as Node)) {
        setPresetsOpen(false);
        setSavingPreset(false);
        setSavePresetName("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [presetsOpen]);

  // Restore the persisted status filter on first load. Only when the URL does
  // not already carry a `status` param (e.g. navigate-back from an order detail
  // keeps its own search string), so an explicit URL always wins.
  useEffect(() => {
    const saved = readBoardFilters().statuses;
    if (saved.length === 0) return;
    if (new URLSearchParams(search).get("status") !== null) return;
    setLocation(buildSearchString(q, saved, activeGroups), { replace: true });
  // Run once on mount — later URL changes are user-driven and persisted at
  // their mutation points instead.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist unallocated-section pool filter to localStorage so it survives reloads.
  useEffect(() => {
    writeUnallocFilters(unallocPoolFilter, unallocPoolTouched);
  }, [unallocPoolFilter, unallocPoolTouched]);

  // Restore board scroll position when returning from order detail.
  // Also clear the view-state snapshot (already consumed by lazy initialisers).
  useEffect(() => {
    sessionStorage.removeItem(VIEW_STATE_KEY);
    const saved = sessionStorage.getItem(SCROLL_KEY);
    if (saved !== null && mainRef.current) {
      mainRef.current.scrollTop = parseInt(saved, 10);
      sessionStorage.removeItem(SCROLL_KEY);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Navigate to order detail, saving the current scroll position and all local
  // view state (group pills, search, week, span) so the back arrow restores
  // the board exactly as the user left it.
  function openOrder(prodid: string) {
    if (mainRef.current) {
      sessionStorage.setItem(SCROLL_KEY, String(mainRef.current.scrollTop));
    }
    const snapshot: SavedViewState = {
      currentDate: currentDate.toISOString(),
      viewSpan,
      selectedGroups: [...effectiveGroups],
      groupsTouched,
      boardSearch,
      unallocPoolFilter: [...unallocPoolFilter],
      unallocPoolTouched,
    };
    sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(snapshot));
    setLocation(`/order/${prodid}${search}`);
  }

  // An order appears in every weekday cell its [start, end] window overlaps.
  function getOrdersForDay(orders: BoardOrder[], day: Date): BoardOrder[] {
    return getOrdersForDayPure(orders, day, weekStart, weekEnd);
  }

  // Shared Department + Production Group pill filters
  const filterControls = (
    <div className="flex flex-col gap-2">
      {/* Family quick-select row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Department:
        </span>
        <button
          onClick={selectAllGroups}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          All
        </button>
        <button
          onClick={selectNoneGroups}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          None
        </button>
        <span className="text-muted-foreground text-xs">|</span>
        {FAMILY_FILTERS.map((family) => {
          const allOn = Array.from(family.members).every((m) => effectiveGroups.has(m));
          return (
            <button
              key={family.label}
              onClick={() => toggleFamilyFilter(family.members)}
              data-testid={`filter-family-${family.label.toLowerCase()}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                allOn
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {family.label}
            </button>
          );
        })}
      </div>
      {/* Individual pill filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Production Group:
        </span>
        {FILTER_GROUPS.map((g) => {
          const on = effectiveGroups.has(g);
          return (
            <button
              key={g}
              onClick={() => toggleFilterGroup(g)}
              data-testid={`filter-group-${g}`}
              className={`rounded-full px-3 py-1 text-xs font-semibold font-mono transition-colors ${
                on
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {g}
            </button>
          );
        })}
      </div>

      {/* Board search — autocomplete dropdown */}
      <div className="w-full sm:w-1/2 lg:w-1/3 xl:max-w-sm relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none z-10" />
        <input
          type="search"
          data-testid="board-search-input"
          className="w-full bg-muted border border-border rounded-lg pl-9 pr-9 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Search orders…"
          value={boardSearch}
          onChange={e => { setBoardSearch(e.target.value); setShowSuggestions(true); setSuggestionIndex(-1); }}
          onFocus={() => { if (boardSearch.trim()) setShowSuggestions(true); }}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSuggestionIndex(i => Math.min(i + 1, suggestions.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSuggestionIndex(i => Math.max(i - 1, -1)); }
            else if (e.key === "Enter" && suggestionIndex >= 0 && suggestions[suggestionIndex]) { selectSuggestion(suggestions[suggestionIndex]); }
            else if (e.key === "Escape") { setShowSuggestions(false); setSuggestionIndex(-1); }
          }}
        />
        {boardSearch && (
          <button
            type="button"
            onClick={() => { setBoardSearch(""); setShowSuggestions(false); }}
            aria-label="Clear search"
            data-testid="board-search-clear"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden">
            {suggestions.map((order, idx) => (
              <button
                key={String(order.prodid)}
                type="button"
                onMouseDown={e => { e.preventDefault(); selectSuggestion(order); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors border-b border-border/50 last:border-0 ${
                  idx === suggestionIndex ? "bg-muted" : "hover:bg-muted/60"
                }`}
              >
                <span className="font-mono font-bold shrink-0">{String(order.prodid)}</span>
                {order.itemname && <span className="text-muted-foreground truncate">· {order.itemname as string}</span>}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground whitespace-nowrap">{fmtShort(order.schedulefromdate)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );

  const tabBtn = (t: Tab, icon: React.ReactNode, label: React.ReactNode) => (
    <button
      onClick={() => setActiveTab(t)}
      className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
        activeTab === t
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="flex flex-col h-screen w-full bg-background text-sm overflow-hidden">

      {/* ── Top header ──────────────────────────────────────────────────────── */}
      <header className="flex-none border-b border-border bg-card px-3 md:px-4 flex items-center gap-2 md:gap-4">
        {/* Logo */}
        <div className="flex items-center gap-2 py-2.5 md:py-3 pr-3 md:pr-4 border-r border-border shrink-0">
          <BarChart2 className="w-5 h-5 text-primary" />
          <span className="font-bold uppercase tracking-tight hidden sm:inline">Shop Floor</span>
        </div>

        {/* Tabs */}
        <nav className="flex items-stretch h-full -mb-px">
          {tabBtn("board", <CalendarDays className="w-4 h-4" />, <><span className="hidden lg:inline">Schedule Board</span><span className="lg:hidden">Board</span></>)}
          {tabBtn("utilization", <Gauge className="w-4 h-4" />, "Utilization")}
          {/* Hidden per request: Unscheduled, Booking / Schedule, KPI tabs.
          {tabBtn(
            "unscheduled",
            <AlertTriangle className="w-4 h-4" />,
            <span className="flex items-center gap-1.5">
              Unscheduled
              {unscheduledOrders.length > 0 && (
                <span className="bg-amber-500 text-white rounded-full text-xs px-1.5 leading-none py-0.5">
                  {unscheduledOrders.length}
                </span>
              )}
            </span>,
          )}
          <button
            onClick={() => setLocation("/booking")}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            data-testid="link-booking-schedule"
          >
            <CalendarDays className="w-4 h-4" />Booking / Schedule
          </button>
          <button
            onClick={() => setLocation("/kpi")}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            data-testid="link-kpi"
          >
            <Gauge className="w-4 h-4" />KPI
          </button>
          */}
        </nav>

        {/* Week / 2-week view toggle */}
        <div className="flex items-center rounded-md border border-border overflow-hidden shrink-0" data-testid="toggle-view-span">
          <button
            type="button"
            onClick={() => setViewSpan("1w")}
            className={`h-8 px-3 text-xs font-medium whitespace-nowrap transition-colors ${
              viewSpan === "1w" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
            }`}
            data-testid="button-view-1w"
          >
            Week
          </button>
          <button
            type="button"
            onClick={() => setViewSpan("2w")}
            className={`h-8 px-3 text-xs font-medium whitespace-nowrap border-l border-border transition-colors ${
              viewSpan === "2w" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground"
            }`}
            data-testid="button-view-2w"
          >
            2 Weeks
          </button>
        </div>

        {/* Right side: sync status + week nav */}
        <div className="ml-auto flex items-center gap-1.5 md:gap-2">

          {/* Last data sync (board auto-refreshes when D365 lands new data) */}
          <div className="flex items-center gap-1 md:gap-1.5">
            {lastDataSync && (
              <span
                className={`text-xs whitespace-nowrap hidden xl:inline ${
                  Date.now() - lastDataSync.getTime() > 60 * 60 * 1000
                    ? "text-red-500 font-medium"
                    : Date.now() - lastDataSync.getTime() > 30 * 60 * 1000
                      ? "text-amber-500"
                      : "text-muted-foreground"
                }`}
                title={
                  Date.now() - lastDataSync.getTime() > 30 * 60 * 1000
                    ? "D365 data may be stale — the staging mirror has not updated recently"
                    : `Last data sync: ${formatSyncTime(lastDataSync)}`
                }
                data-testid="last-data-sync"
              >
                Last Data Sync: {formatSyncTime(lastDataSync)}
              </span>
            )}
            {isFetching && (
              <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Refreshing board data" />
            )}
          </div>

          {/* Week navigation */}
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(subWeeks(currentDate, weeksToShow))} data-testid="button-prev-week">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 md:px-3" onClick={() => setCurrentDate(new Date())} data-testid="button-today">
              Today
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentDate(addWeeks(currentDate, weeksToShow))} data-testid="button-next-week">
              <ChevronRight className="w-4 h-4" />
            </Button>
            <span className="font-mono text-xs md:text-sm text-muted-foreground ml-1 md:ml-2 whitespace-nowrap hidden sm:inline">
              {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
            </span>
          </div>
        </div>
      </header>

      {/* ── Active filter chips ────────────────────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div className="flex-none border-b border-border bg-card/50 px-4 py-1.5 flex items-center gap-2 flex-wrap" data-testid="filter-chips">
          {q.trim() && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono">
              <Search className="w-3 h-3" />{q}
              <button onClick={() => setQ("")} aria-label="Remove search filter"><X className="w-3 h-3 ml-0.5" /></button>
            </span>
          )}
          {activeStatuses.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs">
              <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[s] ?? "bg-slate-500"}`} />
              {STATUS_LABELS[s] ?? String(s)}
              <button onClick={() => toggleStatus(s)} aria-label="Remove status filter"><X className="w-3 h-3 ml-0.5" /></button>
            </span>
          ))}
        </div>
      )}

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main ref={mainRef} className="flex-1 overflow-auto">

        {/* Loading skeleton */}
        {isLoading && (
          <div className="p-4 flex flex-col gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-lg" />)}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="p-8 text-red-700 font-mono text-center" data-testid="banner-db-error">
            Failed to load board data — check API server logs
          </div>
        )}

        {/* ── Schedule Board tab ─────────────────────────────────────────── */}
        {!isLoading && !isError && activeTab === "board" && (
          <div className="p-3 flex flex-col gap-3">
            {filterControls}

            {sections
              .map(({ key, label, orders }) => {
                // Unallocated section: red-bordered cards (not a Gantt grid),
                // showing every GenAssy + GenInstr order regardless of the
                // week/2-week window.
                if (key === "__unallocated__") {
                  return (
                    <section key={key} ref={unallocatedSectionRef} className="rounded-lg border border-border overflow-hidden min-h-[300px] flex flex-col">
                      <div className="bg-slate-800 text-white px-4 py-2 flex items-center gap-3 border-b border-border flex-wrap">
                        <span className="font-bold text-base tracking-tight">{label}</span>
                        <span className="text-slate-300 text-xs">
                          {displayedUnallocatedOrders.length}{(unallocPoolTouched || boardSearchTerm) && unallocatedOrders.length !== displayedUnallocatedOrders.length ? ` of ${unallocatedOrders.length}` : ""} order{displayedUnallocatedOrders.length !== 1 ? "s" : ""}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowUnallocGrid(true)}
                          className="ml-auto flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200 underline underline-offset-2"
                          data-testid="link-unallocated-grid"
                        >
                          <TableIcon className="w-3.5 h-3.5" />
                          View production order data
                        </button>
                      </div>

                      {/* Pool filter bar — All/None quick links + individual pills */}
                      {unallocPools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-muted/50 border-b border-border/50">
                          <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Pool:
                          </span>
                          <button
                            type="button"
                            onClick={() => { setUnallocPoolFilter(new Set()); setUnallocPoolTouched(false); }}
                            className={`text-xs font-medium transition-colors ${!unallocPoolTouched ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={() => { setUnallocPoolFilter(new Set()); setUnallocPoolTouched(true); }}
                            className={`text-xs font-medium transition-colors ${unallocPoolTouched && unallocPoolFilter.size === 0 ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            None
                          </button>
                          <span className="text-muted-foreground text-xs">|</span>
                          {unallocPools.map(pool => {
                            const active = !unallocPoolTouched || unallocPoolFilter.has(pool);
                            return (
                              <button
                                key={pool}
                                type="button"
                                onClick={() => {
                                  setUnallocPoolFilter(prev => {
                                    const next = new Set(prev);
                                    if (next.has(pool)) next.delete(pool);
                                    else next.add(pool);
                                    return next;
                                  });
                                  setUnallocPoolTouched(true);
                                }}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                                  active
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                                }`}
                              >
                                {pool}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Resource filter bar — All/None quick links + individual pills */}
                      {displayedUnallocatedOrders.length === 0 ? (
                        <div className="flex-1 px-3 py-6 text-center text-xs italic text-muted-foreground/60 flex items-center justify-center">
                          {unallocatedOrders.length === 0
                            ? "No unallocated orders"
                            : boardSearchTerm
                            ? "No unallocated orders match the search"
                            : "No orders match the selected pool filter"}
                        </div>
                      ) : (
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 p-3 content-start">
                          {displayedUnallocatedOrders.map((order) => {
                            const pickItems = pickMap[order.prodid as string];
                            return (
                              <OrderCardTooltip
                                key={order.prodid}
                                order={order}
                                pickItems={pickItems}
                                pickLoaded={pickLoaded}
                                pickError={pickError}
                                groupName={order.productiongroupid as string}
                              >
                              <div
                                role="button"
                                tabIndex={0}
                                data-testid={`link-order-${order.prodid}`}
                                onClick={() => openOrder(order.prodid as string)}
                                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openOrder(order.prodid as string)}
                                className="min-w-0 rounded-lg border-2 border-red-500 bg-card px-3 py-2 cursor-pointer hover:shadow-md hover:border-red-600 transition-all"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <PickStatusDot loaded={pickLoaded} hasRemaining={!!pickItems?.length} prodid={order.prodid as string} />
                                  <span className="font-mono text-sm font-bold leading-none shrink-0">{order.prodid}</span>
                                  {order.itemname && (
                                    <span className="text-xs text-muted-foreground truncate">· {order.itemname}</span>
                                  )}
                                </div>
                                {(order.productconfiguration || order.prodqty != null) && (
                                  <div className="text-[11px] text-muted-foreground truncate mt-0.5" title={order.productconfiguration ?? undefined}>
                                    {order.productconfiguration && <>Config: {order.productconfiguration}</>}
                                    {order.prodqty != null && (
                                      <>{order.productconfiguration ? " · " : ""}Qty: <span className="font-mono">{Number(order.prodqty).toLocaleString()}</span></>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5 min-w-0 whitespace-nowrap overflow-hidden">
                                  <span className="truncate min-w-0">
                                    Pool: {order.productionpool ?? "Unassigned"}
                                  </span>
                                  {order.demandproductionordernumber && (
                                    <span className="truncate min-w-0">
                                      Ref: <span className="font-mono">{order.demandproductionordernumber}</span>
                                    </span>
                                  )}
                                  <span className="truncate min-w-0">
                                    Prod Group: {order.productiongroupid}
                                  </span>
                                  <button
                                    onClick={(e) => openGroupEdit(order, e)}
                                    title="Change production group (syncs to D365)"
                                    aria-label="Change production group"
                                    data-testid={`button-edit-group-${order.prodid}`}
                                    className="shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                </div>
                                <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                                  Resource: {order.resourcecode ?? "Unassigned"}
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1 min-w-0">
                                  <span className="truncate">
                                    {fmtShort(order.schedulefromdate)}
                                    {order.scheduledenddate && ` → ${fmtShort(order.scheduledenddate)}`}
                                  </span>
                                  <span className="flex items-center gap-1 whitespace-nowrap">
                                    <Clock className="w-3 h-3 inline-block shrink-0" />
                                    {fmtHours(order.totalscheduledtime)}
                                  </span>
                                  {(() => {
                                    const eStr = (order.scheduledenddate as string | null | undefined)?.substring(0, 10);
                                    if (!eStr) return null;
                                    const daysLate = differenceInCalendarDays(new Date(), parseISO(eStr));
                                    if (daysLate <= 0) return null;
                                    return <span className="text-red-500 font-semibold whitespace-nowrap">{daysLate}d Late</span>;
                                  })()}
                                </div>
                                <HoursProgress
                                  consumed={order.consumedhours}
                                  total={order.totalscheduledtime}
                                  endDate={order.scheduledenddate}
                                  expected={order.expectedconsumedhours}
                                />
                              </div>
                              </OrderCardTooltip>
                            );
                          })}
                        </div>
                      )}

                      {/* Raw production-order data grid (from D365 prod order + released product) */}
                      <Dialog open={showUnallocGrid} onOpenChange={setShowUnallocGrid}>
                        <DialogContent className="max-w-[96vw] w-[96vw]">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              <TableIcon className="w-4 h-4" />
                              Unallocated production order data
                            </DialogTitle>
                          </DialogHeader>
                          <div className="overflow-auto max-h-[70vh] border border-border rounded-md">
                            {loadingUnallocDetails ? (
                              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
                            ) : !unallocDetails || unallocDetails.length === 0 ? (
                              <div className="p-6 text-center text-sm italic text-muted-foreground">
                                No production orders found
                              </div>
                            ) : (
                              <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0 bg-muted z-10">
                                  <tr className="text-muted-foreground uppercase tracking-wider text-[10px]">
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Production Order</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Item Number</th>
                                    <th className="text-left px-3 py-2">Production Name</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Production Group</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Production Pool</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Sales Class 1</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Sales Class 2</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Sales Class 3</th>
                                    <th className="text-left px-3 py-2 whitespace-nowrap">Status</th>
                                    <th className="text-right px-3 py-2 whitespace-nowrap">Quantity</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {unallocDetails.map((row) => (
                                    <tr
                                      key={row.productionordernumber}
                                      className="border-t border-border hover:bg-muted/40 cursor-pointer"
                                      onClick={() => openOrder(row.productionordernumber)}
                                      data-testid={`row-unalloc-${row.productionordernumber}`}
                                    >
                                      <td className="px-3 py-1.5 font-mono font-semibold whitespace-nowrap">{row.productionordernumber}</td>
                                      <td className="px-3 py-1.5 font-mono whitespace-nowrap">{row.itemnumber ?? "—"}</td>
                                      <td className="px-3 py-1.5 max-w-[280px] truncate" title={row.productionname ?? ""}>{row.productionname ?? "—"}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">{row.productiongroup ?? "—"}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">{row.productionpool ?? "—"}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">{row.salesclassification1 ?? "—"}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">{row.salesclassification2 ?? "—"}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">{row.salesclassification3 ?? "—"}</td>
                                      <td className="px-3 py-1.5 whitespace-nowrap">
                                        {row.productionorderstatus != null
                                          ? (STATUS_LABELS[row.productionorderstatus] ?? row.productionorderstatus)
                                          : "—"}
                                      </td>
                                      <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap">
                                        {row.quantity != null ? Number(row.quantity).toLocaleString() : "—"}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {unallocDetails?.length ?? 0} production order{(unallocDetails?.length ?? 0) !== 1 ? "s" : ""} · GenAssy · GenInstr · GenElec · Elec Setup · Started orders only
                          </div>
                        </DialogContent>
                      </Dialog>
                    </section>
                  );
                }

                return (
                  <section key={key} className="rounded-lg border border-border overflow-hidden">

                    {/* Group header — simplified: group name only */}
                    <div className="bg-slate-800 text-white px-4 py-2 flex items-center gap-3 border-b border-border">
                      <span className="font-bold text-base tracking-tight">{label}</span>
                    </div>

                    {/* Calendar grid */}
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse table-fixed" style={{ minWidth: `${144 + days.length * 120}px` }}>
                        <thead>
                          <tr className="bg-muted/20 border-b border-border">
                            <th className="text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground font-medium w-36 border-r border-border/50">
                              Resource
                            </th>
                            {days.map(day => (
                              <th
                                key={day.toISOString()}
                                className={`px-2 py-1.5 text-center border-l border-border/30 font-medium ${
                                  isSameDay(day, new Date()) ? "bg-primary/5" : ""
                                }`}
                                style={{ width: `calc((100% - 9rem) / ${days.length})` }}
                              >
                                <div className={`text-xs ${isSameDay(day, new Date()) ? "text-primary" : "text-muted-foreground"}`}>
                                  {format(day, "EEE")}
                                </div>
                                <div className={`text-sm font-bold ${isSameDay(day, new Date()) ? "text-primary" : "text-foreground"}`}>
                                  {format(day, "MMM d")}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {orders.length === 0 && (
                            <tr>
                              <td colSpan={days.length + 1} className="px-3 py-4 text-center text-xs italic text-muted-foreground/60">
                                No scheduled orders — open for scheduling
                              </td>
                            </tr>
                          )}
                          {orders.map(order => {
                            const isUnassigned = !order.resourcecode;
                            const displayCode  = isUnassigned ? "Unassigned" : (order.resourcecode as string);
                            const resourcename = isUnassigned ? null : (order.resourcename as string | null | undefined);
                            const wStart       = startOfDay(weekStart);
                            const wEnd         = startOfDay(weekEnd);

                            // Compute the bar position for this single order.
                            // Overdue in-progress orders (whole window before the visible
                            // week) are pinned to the first column with a ← marker.
                            const dayTimes    = days.map(d => startOfDay(d).getTime());
                            const firstDayTime = dayTimes[0];
                            const sStr = toDateStr(order.schedulefromdate);
                            let barProps: { first: number; last: number; carriedIn: boolean; carriedOut: boolean } | null = null;
                            if (sStr) {
                              const start = startOfDay(parseISO(sStr)).getTime();
                              const eStr  = toDateStr(order.scheduledenddate);
                              const end   = eStr ? startOfDay(parseISO(eStr)).getTime() : start;
                              if (start <= wEnd.getTime()) {
                                let first = -1, last = -1;
                                dayTimes.forEach((t, i) => {
                                  if (t >= start && t <= end) {
                                    if (first === -1) first = i;
                                    last = i;
                                  }
                                });
                                if (first === -1) {
                                  if (end < firstDayTime) {
                                    barProps = { first: 0, last: 0, carriedIn: true, carriedOut: false };
                                  }
                                } else {
                                  barProps = { first, last, carriedIn: start < wStart.getTime(), carriedOut: end > wEnd.getTime() };
                                }
                              }
                            }

                            const pickItems = pickMap[order.prodid as string];

                            return (
                              <tr key={order.prodid} className="border-b border-border/40 hover:bg-muted/5 transition-colors">

                                {/* Resource code + order reference details */}
                                <td className="px-3 py-2 align-top border-r border-border/50 bg-muted/10 w-36">
                                  <div className="min-w-0">
                                    <div className={`font-mono text-xs font-semibold truncate ${isUnassigned ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{displayCode}</div>
                                    {resourcename && (
                                      <div className="text-xs text-muted-foreground truncate">{resourcename}</div>
                                    )}
                                    <div className="text-[11px] text-muted-foreground mt-1 space-y-0.5">
                                      <div className="font-mono text-xs font-bold">{order.prodid}</div>
                                      <div>Start Date: {fmtShort(order.schedulefromdate) ?? "—"}</div>
                                      <div>End Date: {fmtShort(order.scheduledenddate) ?? "—"}</div>
                                    </div>
                                  </div>
                                </td>

                                {/* Gantt bar: single order bar spanning its date range */}
                                <td colSpan={days.length} className="p-0 align-top">
                                  <div className="relative">
                                    {/* Background day columns (separators + today highlight) */}
                                    <div
                                      className="absolute inset-0 grid pointer-events-none"
                                      style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                                    >
                                      {days.map(day => (
                                        <div
                                          key={day.toISOString()}
                                          className="border-l border-border/30"
                                        />
                                      ))}
                                    </div>

                                    {!barProps ? (
                                      <div className="px-2 py-3 text-xs italic text-muted-foreground/40">—</div>
                                    ) : (
                                      <div
                                        className="relative grid gap-1 p-1"
                                        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                                      >
                                        <OrderCardTooltip
                                          order={order}
                                          pickItems={pickItems}
                                          pickLoaded={pickLoaded}
                                          pickError={pickError}
                                          groupName={groupNameMap[order.productiongroupid as string] ?? (order.productiongroupid as string)}
                                        >
                                          <div
                                            role="button"
                                            tabIndex={0}
                                            data-testid={`link-order-${order.prodid}`}
                                            onClick={() => openOrder(order.prodid as string)}
                                            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openOrder(order.prodid as string)}
                                            style={{ gridColumn: `${barProps.first + 1} / span ${barProps.last - barProps.first + 1}` }}
                                            className="min-w-0 rounded border px-2 py-1 cursor-pointer hover:bg-slate-100 transition-all bg-slate-100 border-slate-300"
                                          >
                                            <div className="flex items-center gap-1 min-w-0">
                                              {barProps.carriedIn && <span className="text-[10px] opacity-60 shrink-0">←</span>}
                                              <PickStatusDot loaded={pickLoaded} hasRemaining={!!pickItems?.length} prodid={order.prodid as string} />
                                              <span className="font-mono text-xs font-bold leading-none shrink-0">{order.prodid}</span>
                                              {order.itemname && (
                                                <span className="text-[11px] text-muted-foreground truncate">· {order.itemname}</span>
                                              )}
                                              <button
                                                onClick={(e) => openGroupEdit(order, e)}
                                                title="Change production group (syncs to D365)"
                                                aria-label="Change production group"
                                                data-testid={`button-edit-group-${order.prodid}`}
                                                className="ml-auto shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                                              >
                                                <Pencil className="w-3 h-3" />
                                              </button>
                                              {barProps.carriedOut && <span className="text-[10px] opacity-60 shrink-0">→</span>}
                                            </div>
                                            {(order.productconfiguration || order.prodqty != null) && (
                                              <div className="text-[10px] text-muted-foreground truncate" title={order.productconfiguration ?? undefined}>
                                                {order.productconfiguration && <>Config: {order.productconfiguration}</>}
                                                {order.prodqty != null && (
                                                  <>{order.productconfiguration ? " · " : ""}Qty: <span className="font-mono">{Number(order.prodqty).toLocaleString()}</span></>
                                                )}
                                              </div>
                                            )}
                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground truncate">
                                              Pool: {order.productionpool ?? "Unassigned"}
                                              {order.demandproductionordernumber && (
                                                <span className="truncate">
                                                  Ref: <span className="font-mono">{order.demandproductionordernumber}</span>
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 min-w-0">
                                              <span className="truncate">
                                                {fmtShort(order.schedulefromdate)}
                                                {order.scheduledenddate && ` → ${fmtShort(order.scheduledenddate)}`}
                                              </span>
                                              <span className="flex items-center gap-1 whitespace-nowrap">
                                                <Clock className="w-2.5 h-2.5 inline-block shrink-0" />
                                                {fmtHours(order.totalscheduledtime)}
                                              </span>
                                              {(() => {
                                                const eStr = (order.scheduledenddate as string | null | undefined)?.substring(0, 10);
                                                if (!eStr) return null;
                                                const daysLate = differenceInCalendarDays(new Date(), parseISO(eStr));
                                                if (daysLate <= 0) return null;
                                                return <span className="text-red-500 font-semibold whitespace-nowrap">{daysLate}d Late</span>;
                                              })()}
                                            </div>
                                            <HoursProgress
                                              consumed={order.consumedhours}
                                              total={order.totalscheduledtime}
                                              endDate={order.scheduledenddate}
                                              expected={order.expectedconsumedhours}
                                            />
                                          </div>
                                        </OrderCardTooltip>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}

            {/* Groups are always rendered (availability view); only surface a
                hint when active filters left every group empty. */}
            {activeFilterCount > 0 && Object.keys(groupedOrders).length === 0 && (
              <div className="py-10 text-center text-muted-foreground flex flex-col items-center gap-2">
                <Filter className="w-8 h-8 opacity-30" />
                <span className="text-sm">No orders match the active filters</span>
                <button className="text-xs underline underline-offset-2 hover:text-foreground" onClick={clearAll}>
                  Clear filters
                </button>
              </div>
            )}

          </div>
        )}

        {/* ── Unscheduled tab ────────────────────────────────────────────── */}
        {!isLoading && !isError && activeTab === "unscheduled" && (
          <div className="p-4">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="font-semibold text-lg">Unscheduled Orders</h2>
              <span className="px-2 py-0.5 bg-amber-500/15 text-amber-700 border border-amber-500/30 rounded text-xs font-mono">
                {unscheduledOrders.length} orders — no resource reservation
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {unscheduledOrders
                .sort((a, b) => (a.schedulefromdate ?? "").localeCompare(b.schedulefromdate ?? ""))
                .map(order => (
                  <div
                    key={order.prodid}
                    role="button"
                    tabIndex={0}
                    data-testid={`link-order-${order.prodid}`}
                    onClick={() => openOrder(order.prodid as string)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openOrder(order.prodid as string)}
                    className="rounded-lg border border-border bg-card hover:bg-muted/20 p-3 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-mono font-bold text-sm">{order.prodid}</span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">{order.productiongroupid}</span>
                    </div>
                    {order.itemname && (
                      <div className="text-xs text-muted-foreground line-clamp-2 mb-1">{order.itemname}</div>
                    )}
                    <div className="text-[10px] text-muted-foreground/70">
                      {fmtShort(order.schedulefromdate)}
                      {order.scheduledenddate && ` → ${fmtShort(order.scheduledenddate)}`}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-0.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 inline-block shrink-0" />
                      {fmtHours(order.totalscheduledtime)}
                    </div>
                    <HoursProgress
                      consumed={order.consumedhours}
                      total={order.totalscheduledtime}
                      endDate={order.scheduledenddate}
                      expected={order.expectedconsumedhours}
                    />
                    {order.workername && (
                      <div
                        className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-1"
                        title={order.workername}
                      >
                        <User className="w-2.5 h-2.5 inline-block shrink-0" />
                        <span className="line-clamp-1">{order.workername}</span>
                      </div>
                    )}
                  </div>
                ))}
            </div>
            {unscheduledOrders.length === 0 && (
              <div className="py-12 text-center text-muted-foreground">
                {activeFilterCount > 0 ? "No unscheduled orders match the active filters" : "All orders in range are scheduled"}
              </div>
            )}
          </div>
        )}

        {/* ── Utilization tab ────────────────────────────────────────────── */}
        {!isLoading && !isError && activeTab === "utilization" && (
          <div className="p-3 flex flex-col gap-3">
            {filterControls}
            <ResourceUtilization
              utilization={utilization}
              days={days}
              weeksToShow={weeksToShow}
              visibleGroups={visibleGroups}
              groupNameMap={groupNameMap}
              groupedOrders={groupedOrders}
              onOpenOrder={openOrder}
            />
          </div>
        )}
      </main>

      {/* ── Scroll to top / bottom (long board navigation) ──────────────────── */}
      {!isLoading && !isError && activeTab === "board" && (
        <div className="fixed bottom-16 right-4 z-40 flex flex-col gap-2 items-end" data-testid="board-scroll-nav">
          <button
            type="button"
            onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            title="Scroll to top"
            aria-label="Scroll to top"
            data-testid="button-scroll-top"
            className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (unallocatedSectionRef.current && mainRef.current) {
                const top = unallocatedSectionRef.current.offsetTop - mainRef.current.offsetTop;
                mainRef.current.scrollTo({ top, behavior: "smooth" });
              }
            }}
            title="Scroll to Unallocated"
            aria-label="Scroll to Unallocated"
            data-testid="button-scroll-unallocated"
            className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg hover:text-foreground hover:bg-muted transition-colors"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Production-group editor — writes the change to D365 F&O in real time */}
      <Dialog open={groupEdit !== null} onOpenChange={(open) => { if (!open) setGroupEdit(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Change production group</DialogTitle>
          </DialogHeader>
          {groupEdit && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Order <span className="font-mono font-semibold text-foreground">{groupEdit.prodid}</span>
                {" · Current group: "}
                <span className="font-semibold text-foreground">
                  {groupNameMap[groupEdit.current] ?? groupEdit.current}
                </span>
              </div>
              <Select value={groupEditValue} onValueChange={setGroupEditValue}>
                <SelectTrigger data-testid="select-production-group">
                  <SelectValue placeholder="Select a production group" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {groupSelectOptions.map((g) => (
                    <SelectItem key={g.groupid} value={g.groupid}>
                      {g.groupid}
                      {g.groupname ? ` — ${g.groupname}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The change is written to Dynamics 365 Finance &amp; Operations immediately.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setGroupEdit(null)}
                  disabled={updateGroupMutation.isPending}
                  data-testid="button-cancel-group"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  data-testid="button-save-group"
                  disabled={!groupEditValue || groupEditValue === groupEdit.current || updateGroupMutation.isPending}
                  onClick={() =>
                    updateGroupMutation.mutate({
                      prodid: groupEdit.prodid,
                      data: { groupid: groupEditValue },
                    })
                  }
                >
                  {updateGroupMutation.isPending ? "Syncing to D365…" : "Save & sync to D365"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
