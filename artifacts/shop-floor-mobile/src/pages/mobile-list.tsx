import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetProductionBoardQueryOptions,
  getGetProductionPickingQueryOptions,
  getGetProductionSyncStatusQueryOptions,
  type BoardOrder,
} from "@workspace/api-client-react";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  format, addWeeks, subWeeks, startOfWeek, endOfWeek, parseISO,
  startOfDay, endOfDay, addDays,
} from "date-fns";
import {
  BarChart2, Filter, Search, X, ChevronRight, RefreshCw,
  AlertTriangle, SlidersHorizontal, List, Layers, ChevronDown, Calendar, Clock, User,
} from "lucide-react";
import { useLocation } from "wouter";
import { Drawer } from "vaul";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const STATUS_LABELS: Record<number, string> = {
  0: "Created", 1: "Estimated", 2: "Scheduled", 3: "Released",
  4: "Started", 5: "Reported", 6: "Ended", 7: "Ordered",
};

const STATUS_BADGE: Record<number, string> = {
  3: "bg-blue-500/15 text-blue-700 border-blue-500/30",
  4: "bg-green-500/15 text-green-700 border-green-500/30",
  5: "bg-gray-500/15 text-gray-700 border-gray-500/30",
  1: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  2: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30",
  6: "bg-purple-500/15 text-purple-700 border-purple-500/30",
  0: "bg-orange-500/15 text-orange-700 border-orange-500/30",
  7: "bg-orange-500/15 text-orange-700 border-orange-500/30",
};

const STATUS_DOT: Record<number, string> = {
  3: "bg-blue-400", 4: "bg-green-400", 5: "bg-gray-400",
  1: "bg-amber-400", 2: "bg-indigo-400", 6: "bg-purple-400",
  0: "bg-orange-400", 7: "bg-orange-400",
};

const ALL_STATUSES = [
  { value: 4, label: "Started" },
  { value: 3, label: "Released" },
  { value: 2, label: "Scheduled" },
  { value: 1, label: "Estimated" },
  { value: 5, label: "Reported" },
  { value: 0, label: "Created" },
  { value: 7, label: "Ordered" },
  { value: 6, label: "Ended" },
];

const UNSCHEDULED_KEY = "__unscheduled__";

type DatePreset = "today" | "this-week" | "next-7" | "custom";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  "today": "Today",
  "this-week": "This week",
  "next-7": "Next 7 days",
  "custom": "Custom range",
};

function getPresetRange(preset: DatePreset | null, customFrom: string, customTo: string): { start: Date; end: Date } | null {
  const now = new Date();
  if (preset === "today") {
    return { start: startOfDay(now), end: endOfDay(now) };
  }
  if (preset === "this-week") {
    return {
      start: startOfDay(startOfWeek(now, { weekStartsOn: 1 })),
      end: endOfDay(endOfWeek(now, { weekStartsOn: 1 })),
    };
  }
  if (preset === "next-7") {
    return { start: startOfDay(now), end: endOfDay(addDays(now, 6)) };
  }
  if (preset === "custom") {
    if (!customFrom && !customTo) return null;
    const start = customFrom ? startOfDay(parseISO(customFrom)) : new Date(0);
    const end = customTo ? endOfDay(parseISO(customTo)) : new Date(8640000000000000);
    return { start, end };
  }
  return null;
}

// How often to check the lightweight staging sync timestamp (same watcher
// cadence as the desktop board so both converge on new data together).
const SYNC_CHECK_MS = 60 * 1000;

// True when `candidate` is strictly newer than `baseline`. A null/invalid
// candidate is never "newer"; any valid timestamp is newer than a null
// baseline. Mirrors the desktop board's isNewerTimestamp.
function isNewerSyncTimestamp(
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

const PULL_THRESHOLD = 72; // px needed to trigger refresh
const PULL_MAX = 96;       // max visual stretch before clamping

function fmtHours(val: number | null | undefined): string {
  if (val == null || val === 0) return "—";
  const totalMinutes = Math.round(val * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function fmtShort(d: string | null | undefined) {
  if (!d) return "";
  try { return format(parseISO(d.substring(0, 10)), "MMM d"); } catch { return d; }
}

function statusLabel(s: number | null | undefined) {
  if (s == null) return "—";
  return STATUS_LABELS[s] ?? String(s);
}
function statusBadge(s: number | null | undefined) {
  if (s == null) return "bg-muted text-muted-foreground border-border";
  return STATUS_BADGE[s] ?? "bg-orange-500/15 text-orange-700 border-orange-500/30";
}

// Pick status dot: /production-picking only returns orders WITH remaining
// lines, so an order missing from the map is fully picked — but only once the
// picking query has actually loaded (pickLoaded). Same semantics as desktop.
function PickStatusDot({ loaded, hasRemaining, prodid }: { loaded: boolean; hasRemaining: boolean; prodid: string }) {
  if (!loaded) return null;
  return (
    <span
      data-testid={`dot-pick-${prodid}`}
      aria-label={hasRemaining ? "Items remaining to pick" : "All items picked"}
      className={`w-2 h-2 rounded-full shrink-0 ${hasRemaining ? "bg-red-500" : "bg-emerald-500"}`}
    />
  );
}

function OrderCard({ order, onTap, pickLoaded, pickHasRemaining }: {
  order: BoardOrder;
  onTap: () => void;
  pickLoaded: boolean;
  pickHasRemaining: boolean;
}) {
  return (
    <button
      className="w-full text-left bg-card border border-border rounded-xl p-4 flex items-start gap-3 active:scale-[0.99] transition-transform"
      onClick={onTap}
      data-testid={`order-card-${order.prodid}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <PickStatusDot loaded={pickLoaded} hasRemaining={pickHasRemaining} prodid={order.prodid as string} />
          <span className="font-mono font-bold text-sm tracking-tight">{order.prodid}</span>
          {order.productionstatus != null && (
            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border uppercase tracking-wider ${statusBadge(order.productionstatus)}`}>
              {statusLabel(order.productionstatus)}
            </span>
          )}
        </div>
        <p className="text-sm text-foreground/80 truncate mb-2">{order.itemname || "—"}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          {order.productiongroupid && (
            <span className="font-mono">{order.productiongroupid}</span>
          )}
          {order.resourcecode && (
            <span className="font-mono opacity-70">{order.resourcecode}</span>
          )}
          {(order.schedulefromdate || order.scheduledenddate) && (
            <span>
              {fmtShort(order.schedulefromdate)}
              {order.scheduledenddate ? ` – ${fmtShort(order.scheduledenddate)}` : ""}
            </span>
          )}
          {order.prodqty != null && (
            <span>Qty: {Number(order.prodqty).toLocaleString()}</span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 shrink-0" />
            {fmtHours(order.totalscheduledtime)}
          </span>
        </div>
        {order.workername && (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground/80 min-w-0">
            <User className="w-3 h-3 shrink-0" />
            <span className="truncate">{order.workername}</span>
          </div>
        )}
        {!order.resourcecode && (
          <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-700">
            <AlertTriangle className="w-3 h-3" />
            Unscheduled
          </div>
        )}
      </div>
      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
    </button>
  );
}

function GroupSection({
  groupKey,
  orders,
  onTap,
  defaultOpen = true,
  pickLoaded,
  pickMap,
}: {
  groupKey: string;
  orders: BoardOrder[];
  onTap: (order: BoardOrder) => void;
  defaultOpen?: boolean;
  pickLoaded: boolean;
  pickMap: Record<string, unknown[]>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isUnscheduled = groupKey === UNSCHEDULED_KEY;

  return (
    <div>
      <button
        className="w-full flex items-center justify-between px-1 py-2 text-left"
        onClick={() => setOpen(o => !o)}
        data-testid={`group-header-${groupKey}`}
      >
        <div className="flex items-center gap-2">
          {isUnscheduled ? (
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
          ) : (
            <Layers className="w-4 h-4 text-primary/70 shrink-0" />
          )}
          <span className={`font-semibold text-sm font-mono ${isUnscheduled ? "text-amber-700" : "text-foreground"}`}>
            {isUnscheduled ? "Unscheduled" : groupKey}
          </span>
          <span className="text-xs text-muted-foreground">
            ({orders.length})
          </span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 pb-2">
          {orders.map(order => (
            <OrderCard
              key={order.prodid}
              order={order}
              onTap={() => onTap(order)}
              pickLoaded={pickLoaded}
              pickHasRemaining={!!pickMap[order.prodid as string]?.length}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const DATE_FILTER_KEY = "sf-mobile-date-filter";

function loadDateFilter(): { preset: DatePreset | null; from: string; to: string } {
  try {
    const raw = localStorage.getItem(DATE_FILTER_KEY);
    if (!raw) return { preset: null, from: "", to: "" };
    const parsed = JSON.parse(raw);
    const validPresets: DatePreset[] = ["today", "this-week", "next-7", "custom"];
    const preset = validPresets.includes(parsed.preset) ? parsed.preset : null;
    return {
      preset,
      from: typeof parsed.from === "string" ? parsed.from : "",
      to: typeof parsed.to === "string" ? parsed.to : "",
    };
  } catch {
    return { preset: null, from: "", to: "" };
  }
}

function usePullToRefresh(
  scrollRef: React.RefObject<HTMLElement | null>,
  onRefresh: () => Promise<unknown>,
) {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startY = useRef(0);
  const pulling = useRef(false);
  const refreshing = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function onTouchStart(e: TouchEvent) {
      if (refreshing.current) return;
      if (el!.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!pulling.current || refreshing.current) return;
      if (el!.scrollTop > 0) {
        pulling.current = false;
        setPullDistance(0);
        return;
      }
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPullDistance(0);
        return;
      }
      // Rubber-band: slow down as we approach max
      const clamped = Math.min(delta * 0.45, PULL_MAX);
      setPullDistance(clamped);
      if (clamped > 0) e.preventDefault();
    }

    function onTouchEnd() {
      if (!pulling.current || refreshing.current) return;
      pulling.current = false;

      setPullDistance(prev => {
        if (prev >= PULL_THRESHOLD) {
          refreshing.current = true;
          setIsRefreshing(true);
          onRefresh().finally(() => {
            refreshing.current = false;
            setIsRefreshing(false);
          });
          return 0;
        }
        return 0;
      });
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [scrollRef, onRefresh]);

  return { pullDistance, isRefreshing };
}

export function MobileList() {
  const [, setLocation] = useLocation();
  const [q, setQ] = useState("");
  const [activeStatuses, setActiveStatuses] = useState<number[]>([]);
  const [activeGroups, setActiveGroups] = useState<string[]>([]);
  const [activeDatePreset, setActiveDatePreset] = useState<DatePreset | null>(() => loadDateFilter().preset);
  const [customFrom, setCustomFrom] = useState(() => loadDateFilter().from);
  const [customTo, setCustomTo] = useState(() => loadDateFilter().to);

  useEffect(() => {
    if (activeDatePreset === null && !customFrom && !customTo) {
      localStorage.removeItem(DATE_FILTER_KEY);
    } else {
      localStorage.setItem(DATE_FILTER_KEY, JSON.stringify({ preset: activeDatePreset, from: customFrom, to: customTo }));
    }
  }, [activeDatePreset, customFrom, customTo]);

  const [filterOpen, setFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const fromDate = format(subWeeks(weekStart, 1), "yyyy-MM-dd");
  const toDate = format(addWeeks(weekEnd, 6), "yyyy-MM-dd");

  const queryClient = useQueryClient();

  const { data: boardOrders, isLoading, isError, isFetching, refetch } = useQuery({
    ...getGetProductionBoardQueryOptions({ fromDate, toDate }),
    // Sync-triggered refresh only (same trigger as the desktop board): no
    // fixed timer. Data loads on mount and refetches when the sync watcher
    // below detects that D365 landed new data in staging. Pull-to-refresh
    // remains available as a manual gesture.
    refetchOnWindowFocus: false,
  });

  // ── Sync watcher ─────────────────────────────────────────────────────────
  // Poll the lightweight sync-status endpoint; refetch the full data when
  // either the D365 staging timestamp OR the local overlay timestamp (written
  // by any manager's group move) advances. An advance marks a refresh as
  // pending; it fires when a later probe returns the SAME values again (change
  // settled). Same settle logic as the desktop board.
  // `dataUpdatedAt` is needed because react-query's structural sharing returns
  // the identical object for an unchanged payload — data alone can't signal
  // "same value seen twice".
  const { data: syncStatus, dataUpdatedAt: syncProbedAt } = useQuery({
    ...getGetProductionSyncStatusQueryOptions(),
    refetchInterval: SYNC_CHECK_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
  });
  // lastsync: settle-window logic — D365 batch exports land over several
  // minutes, so we wait for the timestamp to hold steady across two probes
  // before refreshing. Only FORWARD movement queues a refresh.
  const prevLastsyncRef = useRef<string | null | undefined>(undefined);
  const settledLastsyncRef = useRef<string | null | undefined>(undefined);
  const lastsyncPendingRef = useRef(false);
  // overlaylastupdated: fire immediately on first advance — overlay writes are
  // atomic single-row upserts, so they don't need a settle window. This
  // guarantees a group move appears within one probe cycle (≈60 s).
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
    if (isNewerSyncTimestamp(currentOverlay, settledOverlayRef.current)) {
      settledOverlayRef.current = currentOverlay;
      queryClient.invalidateQueries({ queryKey: ["/api/production-board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/production-picking"] });
    }
    // lastsync: settle-window — regression must not queue a refresh.
    if (currentLastsync !== prevLastsyncRef.current) {
      lastsyncPendingRef.current = isNewerSyncTimestamp(currentLastsync, prevLastsyncRef.current);
      prevLastsyncRef.current = currentLastsync;
      return;
    }
    if (lastsyncPendingRef.current) {
      lastsyncPendingRef.current = false;
      if (isNewerSyncTimestamp(currentLastsync, settledLastsyncRef.current)) {
        settledLastsyncRef.current = currentLastsync;
        // Export settled — refresh everything the mobile list shows.
        queryClient.invalidateQueries({ queryKey: ["/api/production-board"] });
        queryClient.invalidateQueries({ queryKey: ["/api/production-picking"] });
      }
    }
  }, [syncStatus, syncProbedAt, queryClient]);

  // Per-order components still remaining to pick (same cached endpoint as the
  // desktop board). Keyed by production order id.
  const { data: pickingData } = useQuery(getGetProductionPickingQueryOptions());
  const pickLoaded = pickingData !== undefined;
  const pickMap = useMemo(() => {
    const m: Record<string, unknown[]> = {};
    for (const p of pickingData ?? []) m[p.prodid] = p.items;
    return m;
  }, [pickingData]);

  const scrollRef = useRef<HTMLElement | null>(null);
  const handleRefresh = useCallback(() => refetch().then(() => {}), [refetch]);
  const { pullDistance, isRefreshing } = usePullToRefresh(scrollRef, handleRefresh);

  const allGroups = useMemo(() => {
    if (!boardOrders) return [];
    const set = new Set(boardOrders.map(o => o.productiongroupid).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [boardOrders]);

  const activeDateRange = useMemo(
    () => getPresetRange(activeDatePreset, customFrom, customTo),
    [activeDatePreset, customFrom, customTo],
  );

  const filtered = useMemo(() => {
    if (!boardOrders) return [];
    const searchLower = q.trim().toLowerCase();
    return boardOrders.filter(o => {
      if (activeStatuses.length > 0 && !activeStatuses.includes(o.productionstatus as number)) return false;
      if (activeGroups.length > 0 && !activeGroups.includes(o.productiongroupid as string)) return false;
      if (activeDateRange) {
        const from = o.schedulefromdate ? parseISO(o.schedulefromdate.substring(0, 10)) : null;
        const to = o.scheduledenddate ? parseISO(o.scheduledenddate.substring(0, 10)) : null;
        if (!from && !to) return false;
        const orderStart = from ?? to!;
        const orderEnd = to ?? from!;
        if (orderEnd < activeDateRange.start || orderStart > activeDateRange.end) return false;
      }
      if (searchLower) {
        const id = (o.prodid ?? "").toLowerCase();
        const name = (o.itemname ?? "").toLowerCase();
        if (!id.includes(searchLower) && !name.includes(searchLower)) return false;
      }
      return true;
    });
  }, [boardOrders, q, activeStatuses, activeGroups, activeDateRange]);

  const hasDateFilter = activeDatePreset !== null && (activeDatePreset !== "custom" || customFrom || customTo);

  const grouped = useMemo(() => {
    const map = new Map<string, BoardOrder[]>();
    for (const order of filtered) {
      const key = !order.resourcecode
        ? UNSCHEDULED_KEY
        : (order.productiongroupid ?? order.resourcecode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(order);
    }
    const scheduled = Array.from(map.entries())
      .filter(([k]) => k !== UNSCHEDULED_KEY)
      .sort(([a], [b]) => a.localeCompare(b));
    const unscheduled = map.get(UNSCHEDULED_KEY);
    return unscheduled
      ? [...scheduled, [UNSCHEDULED_KEY, unscheduled] as [string, BoardOrder[]]]
      : scheduled;
  }, [filtered]);

  const activeFilterCount =
    (activeStatuses.length > 0 ? 1 : 0) +
    (activeGroups.length > 0 ? 1 : 0) +
    (hasDateFilter ? 1 : 0);

  const toggleStatus = useCallback((v: number) => {
    setActiveStatuses(prev =>
      prev.includes(v) ? prev.filter(s => s !== v) : [...prev, v]
    );
  }, []);

  const toggleGroup = useCallback((g: string) => {
    setActiveGroups(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  }, []);

  const clearDateFilter = useCallback(() => {
    setActiveDatePreset(null);
    setCustomFrom("");
    setCustomTo("");
  }, []);

  const clearFilters = useCallback(() => {
    setActiveStatuses([]);
    setActiveGroups([]);
    clearDateFilter();
  }, [clearDateFilter]);

  function dateChipLabel(): string {
    if (!activeDatePreset) return "";
    if (activeDatePreset !== "custom") return DATE_PRESET_LABELS[activeDatePreset];
    const parts: string[] = [];
    if (customFrom) parts.push(format(parseISO(customFrom), "MMM d"));
    if (customTo) parts.push(format(parseISO(customTo), "MMM d"));
    return parts.join(" – ") || "Custom";
  }

  const handleOrderTap = useCallback((order: BoardOrder) => {
    setLocation(`/order/${order.prodid}`);
  }, [setLocation]);

  // How far to visually translate the list content (rubber-band effect)
  const listTranslateY = isRefreshing ? 0 : pullDistance;
  // Indicator height: clamp to pull distance or fixed when refreshing
  const indicatorHeight = isRefreshing ? PULL_THRESHOLD : pullDistance;
  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const readyToRelease = pullDistance >= PULL_THRESHOLD;

  return (
    <div className="flex flex-col h-dvh bg-background">
      {/* Header */}
      <header className="flex-none bg-card border-b border-border px-4 pt-safe-top">
        <div className="flex items-center gap-3 py-3">
          <BarChart2 className="w-5 h-5 text-primary shrink-0" />
          <span className="font-bold uppercase tracking-tight text-sm">Shop Floor</span>
          <div className="ml-auto flex items-center gap-2">
            {isFetching && !isLoading && !isRefreshing && (
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
            )}
            {/* View toggle */}
            <div
              className="flex items-center bg-muted rounded-lg p-0.5 border border-border"
              data-testid="view-mode-toggle"
            >
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === "flat"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setViewMode("flat")}
                data-testid="view-mode-flat"
                aria-pressed={viewMode === "flat"}
              >
                <List className="w-3.5 h-3.5" />
                List
              </button>
              <button
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  viewMode === "grouped"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setViewMode("grouped")}
                data-testid="view-mode-grouped"
                aria-pressed={viewMode === "grouped"}
              >
                <Layers className="w-3.5 h-3.5" />
                By group
              </button>
            </div>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative pb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            className="w-full bg-muted border border-border rounded-lg pl-9 pr-9 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search orders or items…"
            value={q}
            onChange={e => setQ(e.target.value)}
            data-testid="mobile-search"
          />
          {q && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => setQ("")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Quick-select date pills */}
        <div className="flex items-center gap-2 pb-3 overflow-x-auto">
          {(["today", "this-week", "next-7"] as const).map(preset => {
            const active = activeDatePreset === preset;
            return (
              <button
                key={preset}
                onClick={() => setActiveDatePreset(prev => prev === preset ? null : preset)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap shrink-0 transition-colors ${
                  active
                    ? "bg-primary/15 border-primary/40 text-primary"
                    : "bg-muted border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
                data-testid={`quick-date-${preset}`}
                aria-pressed={active}
              >
                <Calendar className="w-3 h-3" />
                {DATE_PRESET_LABELS[preset]}
                {active && <X className="w-3 h-3" />}
              </button>
            );
          })}
        </div>
      </header>

      {/* Filter chip bar */}
      {activeFilterCount > 0 && (
        <div className="flex-none flex items-center gap-2 px-4 py-2 bg-card border-b border-border overflow-x-auto">
          {hasDateFilter && (
            <button
              onClick={clearDateFilter}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs text-primary whitespace-nowrap shrink-0"
              data-testid="chip-date-range"
            >
              <Calendar className="w-3 h-3" />
              {dateChipLabel()}
              <X className="w-3 h-3" />
            </button>
          )}
          {activeStatuses.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs text-primary whitespace-nowrap shrink-0"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[s] ?? "bg-slate-400"}`} />
              {STATUS_LABELS[s]}
              <X className="w-3 h-3" />
            </button>
          ))}
          {activeGroups.map(g => (
            <button
              key={g}
              onClick={() => toggleGroup(g)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/30 text-xs text-primary whitespace-nowrap shrink-0 font-mono"
            >
              {g}
              <X className="w-3 h-3" />
            </button>
          ))}
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground underline underline-offset-2 whitespace-nowrap shrink-0 ml-1"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Order list */}
      <main
        ref={scrollRef as React.RefObject<HTMLElement>}
        className="flex-1 overflow-y-auto relative"
        style={{ overflowAnchor: "none" }}
      >
        {/* Pull-to-refresh indicator */}
        {(pullDistance > 0 || isRefreshing) && (
          <div
            className="flex items-center justify-center overflow-hidden transition-none"
            style={{ height: indicatorHeight }}
            data-testid="pull-refresh-indicator"
          >
            <div
              className="flex flex-col items-center gap-1"
              style={{ opacity: Math.max(pullProgress, isRefreshing ? 1 : 0) }}
            >
              <RefreshCw
                className={`w-5 h-5 text-primary transition-transform ${isRefreshing ? "animate-spin" : ""}`}
                style={
                  !isRefreshing
                    ? { transform: `rotate(${pullProgress * 270}deg)` }
                    : undefined
                }
              />
              <span className="text-[11px] text-muted-foreground">
                {isRefreshing ? "Syncing…" : readyToRelease ? "Release to refresh" : "Pull to refresh"}
              </span>
            </div>
          </div>
        )}

        {/* List content — shifts down while pulling */}
        <div
          style={{
            transform: listTranslateY > 0 ? `translateY(${listTranslateY}px)` : undefined,
            transition: pullDistance === 0 && !isRefreshing ? "transform 0.2s ease" : "none",
          }}
        >
          {isLoading ? (
            <div className="flex flex-col gap-3 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <div className="p-6 text-center text-destructive">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">Failed to load orders</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No orders match your filters</p>
              {(q || activeFilterCount > 0) && (
                <button
                  className="mt-3 text-xs text-primary underline"
                  onClick={() => { setQ(""); clearFilters(); }}
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : viewMode === "flat" ? (
            <div className="flex flex-col gap-3 p-4 pb-28">
              <p className="text-xs text-muted-foreground">
                {filtered.length} order{filtered.length !== 1 ? "s" : ""}
                {(q || activeFilterCount > 0) ? " (filtered)" : ""}
              </p>
              {filtered.map(order => (
                <OrderCard
                  key={order.prodid}
                  order={order}
                  onTap={() => handleOrderTap(order)}
                  pickLoaded={pickLoaded}
                  pickHasRemaining={!!pickMap[order.prodid as string]?.length}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-4 pb-28">
              <p className="text-xs text-muted-foreground mb-1">
                {filtered.length} order{filtered.length !== 1 ? "s" : ""} in {grouped.length} group{grouped.length !== 1 ? "s" : ""}
                {(q || activeFilterCount > 0) ? " (filtered)" : ""}
              </p>
              {grouped.map(([groupKey, orders]) => (
                <GroupSection
                  key={groupKey}
                  groupKey={groupKey}
                  orders={orders}
                  onTap={handleOrderTap}
                  defaultOpen
                  pickLoaded={pickLoaded}
                  pickMap={pickMap}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Bottom filter button */}
      <div className="fixed bottom-0 left-0 right-0 flex justify-center pb-safe-bottom px-4 pb-6 pointer-events-none">
        <Drawer.Root open={filterOpen} onOpenChange={setFilterOpen}>
          <Drawer.Trigger asChild>
            <button
              className="pointer-events-auto flex items-center gap-2 px-5 py-3 rounded-full bg-primary text-primary-foreground text-sm font-medium shadow-lg shadow-primary/20 active:scale-95 transition-transform"
              data-testid="mobile-filter-btn"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <Badge className="ml-1 h-5 px-1.5 text-xs bg-white/20 text-white border-0">
                  {activeFilterCount}
                </Badge>
              )}
            </button>
          </Drawer.Trigger>

          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-black/50 z-40" />
            <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-card rounded-t-2xl border-t border-border max-h-[80dvh] flex flex-col">
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-border" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
                <Drawer.Title className="font-semibold text-base">Filters</Drawer.Title>
                <div className="flex items-center gap-3">
                  {activeFilterCount > 0 && (
                    <button
                      className="text-sm text-muted-foreground underline underline-offset-2"
                      onClick={clearFilters}
                      data-testid="mobile-clear-filters"
                    >
                      Clear all
                    </button>
                  )}
                  <button
                    onClick={() => setFilterOpen(false)}
                    className="text-muted-foreground"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto flex-1 pb-safe-bottom">
                {/* Date Range filter */}
                <div className="px-5 py-4 border-b border-border">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Date Range</p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {(["today", "this-week", "next-7", "custom"] as DatePreset[]).map(preset => (
                      <button
                        key={preset}
                        onClick={() => setActiveDatePreset(prev => prev === preset ? null : preset)}
                        className={`py-2 px-3 rounded-lg text-sm font-medium border transition-colors text-left ${
                          activeDatePreset === preset
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "bg-muted border-border text-foreground/80 hover:border-border/80"
                        }`}
                        data-testid={`mobile-date-preset-${preset}`}
                      >
                        {DATE_PRESET_LABELS[preset]}
                      </button>
                    ))}
                  </div>
                  {activeDatePreset === "custom" && (
                    <div className="flex flex-col gap-2 mt-1">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground w-8 shrink-0">From</label>
                        <input
                          type="date"
                          value={customFrom}
                          onChange={e => setCustomFrom(e.target.value)}
                          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          data-testid="mobile-custom-from"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-muted-foreground w-8 shrink-0">To</label>
                        <input
                          type="date"
                          value={customTo}
                          min={customFrom || undefined}
                          onChange={e => setCustomTo(e.target.value)}
                          className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          data-testid="mobile-custom-to"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Status filter */}
                <div className="px-5 py-4 border-b border-border">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Status</p>
                  <div className="grid grid-cols-2 gap-3">
                    {ALL_STATUSES.map(s => (
                      <label key={s.value} className="flex items-center gap-2.5 cursor-pointer">
                        <Checkbox
                          id={`m-status-${s.value}`}
                          checked={activeStatuses.includes(s.value)}
                          onCheckedChange={() => toggleStatus(s.value)}
                          data-testid={`mobile-checkbox-status-${s.value}`}
                        />
                        <Label htmlFor={`m-status-${s.value}`} className="text-sm cursor-pointer flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[s.value] ?? "bg-slate-500"}`} />
                          {s.label}
                        </Label>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Resource group filter */}
                <div className="px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Resource Group</p>
                  {allGroups.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No groups available</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {allGroups.map(g => (
                        <label key={g} className="flex items-center gap-2.5 cursor-pointer">
                          <Checkbox
                            id={`m-group-${g}`}
                            checked={activeGroups.includes(g)}
                            onCheckedChange={() => toggleGroup(g)}
                            data-testid={`mobile-checkbox-group-${g}`}
                          />
                          <Label htmlFor={`m-group-${g}`} className="text-sm cursor-pointer font-mono truncate max-w-[220px]">
                            {g}
                          </Label>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Done button */}
              <div className="px-5 py-4 border-t border-border shrink-0 pb-safe-bottom">
                <button
                  className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium text-sm"
                  onClick={() => setFilterOpen(false)}
                  data-testid="mobile-filter-done"
                >
                  Show {filtered.length} order{filtered.length !== 1 ? "s" : ""}
                </button>
              </div>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </div>
    </div>
  );
}
