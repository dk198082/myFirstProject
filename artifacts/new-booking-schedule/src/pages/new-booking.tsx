import { useMemo, useRef } from "react";
import { useLocation } from "wouter";
import {
  useGetMachineOrders,
  getGetMachineOrdersQueryKey,
  AssignableOrder,
} from "@workspace/api-client-react";
import { format, parseISO, isValid } from "date-fns";
import { computeSlotDates } from "@/lib/business-days";
import { ArrowDown, ArrowUp, BarChart2, CalendarDays, Download, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import * as XLSX from "xlsx";

const PICK_DAYS = 5;
const PACK_DAYS = 10;
const INTERVAL_DAYS = 14;
const OPEN_SLOTS = 4;

const STATUS_STARTED = 4;
const COMMITTED_STATUSES = new Set([0, 1, 2, 3]);

type Family = {
  tab: string;
  label: string;
  weekday: number;
  assyDays: number;
};

const FAMILIES: Family[] = [
  { tab: "300SL", label: "300SL", weekday: 3, assyDays: 15 },
  { tab: "600SL", label: "600SL", weekday: 5, assyDays: 20 },
  { tab: "1000/2000SL", label: "1000 / 2000SL", weekday: 1, assyDays: 25 },
  { tab: "MetalsImpact", label: "IT406 / IT542", weekday: 3, assyDays: 20 },
];

type Status = "STARTED" | "BOOKED" | "OPEN";

interface Row {
  key: string;
  resource: string;
  prodOrder: string;
  status: Status;
  productionStart: string | null;
  pick: number;
  assyStart: string | null;
  assy: number;
  assyEnd: string | null;
  ship: string | null;
  group: string;
}

function isoDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.slice(0, 10);
  const d = parseISO(s);
  return isValid(d) ? s : null;
}

function pretty(iso: string | null): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  return isValid(d) ? format(d, "EEE dd-MMM-yy") : "—";
}

function onOrAfterWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  const diff = (weekday - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

function toIso(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

const byScheduleAsc = (a: AssignableOrder, b: AssignableOrder) => {
  const da = isoDate(a.schedulefromdate) ?? "9999";
  const db = isoDate(b.schedulefromdate) ?? "9999";
  return da < db ? -1 : da > db ? 1 : 0;
};

function buildFamilyRows(family: Family, orders: AssignableOrder[]): Row[] {
  const mine = orders.filter((o) => o.tab === family.tab);

  const started = mine
    .filter((o) => o.productionstatus === STATUS_STARTED)
    .sort(byScheduleAsc);
  const booked = mine
    .filter(
      (o) =>
        o.productionstatus != null &&
        COMMITTED_STATUSES.has(o.productionstatus),
    )
    .sort(byScheduleAsc);

  const rows: Row[] = [];

  const pushOrder = (o: AssignableOrder, status: Status) => {
    const ps = isoDate(o.schedulefromdate);
    const dates = computeSlotDates(ps, family.assyDays, PACK_DAYS, PICK_DAYS);
    rows.push({
      key: `${status}-${o.prodid}`,
      resource: o.resources || o.productiongroup || "",
      prodOrder: o.prodid,
      status,
      productionStart: ps,
      pick: PICK_DAYS,
      assyStart: dates.assyStart,
      assy: family.assyDays,
      assyEnd: dates.assyEnd,
      ship: dates.ship,
      group: o.productiongroup || "",
    });
  };

  for (const o of started) pushOrder(o, "STARTED");
  for (const o of booked) pushOrder(o, "BOOKED");

  const lastCommitted = [...started, ...booked]
    .map((o) => isoDate(o.schedulefromdate))
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const base = lastCommitted
    ? addDays(parseISO(lastCommitted), INTERVAL_DAYS)
    : new Date();
  let cadence = onOrAfterWeekday(base, family.weekday);

  for (let i = 0; i < OPEN_SLOTS; i++) {
    const ps = toIso(cadence);
    const dates = computeSlotDates(ps, family.assyDays, PACK_DAYS, PICK_DAYS);
    rows.push({
      key: `open-${ps}-${i}`,
      resource: "",
      prodOrder: "",
      status: "OPEN",
      productionStart: ps,
      pick: PICK_DAYS,
      assyStart: dates.assyStart,
      assy: family.assyDays,
      assyEnd: dates.assyEnd,
      ship: dates.ship,
      group: "",
    });
    cadence = addDays(cadence, INTERVAL_DAYS);
  }

  return rows;
}

const STATUS_STYLES: Record<Status, string> = {
  STARTED: "bg-emerald-100 text-emerald-800",
  BOOKED: "bg-orange-100 text-orange-800",
  OPEN: "bg-sky-50 text-sky-800",
};

export function NewBooking() {
  const [, setLocation] = useLocation();
  const {
    data: orders,
    isLoading,
    isFetching,
    refetch,
  } = useGetMachineOrders({
    query: { queryKey: getGetMachineOrdersQueryKey() },
  });

  const families = useMemo(() => {
    const seen = new Set<string>();
    const all = (orders ?? []).filter((o) => {
      if (seen.has(o.prodid)) return false;
      seen.add(o.prodid);
      return true;
    });
    return FAMILIES.map((f) => ({
      family: f,
      rows: buildFamilyRows(f, all),
    })).filter((g) => g.rows.length > 0);
  }, [orders]);

  const visibleFamilies = families;

  const exportExcel = () => {
    if (visibleFamilies.length === 0) return;
    const DATE_FMT = "ddd dd-mmm-yy";
    const headers = [
      "Allocated Resource",
      "Assigned Prod Order",
      "Prod Group",
      "Status",
      "Prod Start",
      "Pick",
      "Assy Start",
      "Assy",
      "Assy End",
      "Ship Date",
    ];
    const dateCols: [number, (r: Row) => string | null][] = [
      [4, (r) => r.productionStart],
      [6, (r) => r.assyStart],
      [8, (r) => r.assyEnd],
      [9, (r) => r.ship],
    ];
    const wb = XLSX.utils.book_new();
    for (const { family, rows } of visibleFamilies) {
      const aoa: (string | number | null)[][] = [headers];
      for (const r of rows) {
        aoa.push([
          r.resource || "",
          r.prodOrder || "",
          r.group || "",
          r.status,
          null,
          r.pick,
          null,
          r.assy,
          null,
          null,
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      rows.forEach((r, i) => {
        for (const [col, getIso] of dateCols) {
          const iso = getIso(r);
          if (!iso || !isValid(parseISO(iso))) continue;
          const addr = XLSX.utils.encode_cell({ r: i + 1, c: col });
          ws[addr] = { t: "d", v: parseISO(iso), z: DATE_FMT };
        }
      });
      const sheetName = family.label.replace(/[/\\?*[\]:]/g, "-").slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    const stamp = format(new Date(), "yyyy-MM-dd");
    XLSX.writeFile(wb, `new-booking-schedule-${stamp}.xlsx`, {
      cellDates: true,
    });
  };

  const mainRef = useRef<HTMLElement>(null);
  const scrollTo = (pos: "top" | "bottom") => {
    const el = mainRef.current;
    const top =
      pos === "top" ? 0 : Math.max(el?.scrollHeight ?? 0, document.documentElement.scrollHeight);
    el?.scrollTo({ top, behavior: "smooth" });
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex-none border-b border-border bg-card px-4 flex items-center gap-4">
        <div className="flex items-center gap-2 py-3 pr-4 border-r border-border shrink-0">
          <BarChart2 className="w-5 h-5 text-primary" />
          <span className="font-bold uppercase tracking-tight">New Booking Schedule</span>
        </div>
        <nav className="flex items-stretch h-full -mb-px">
          <span className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-primary text-foreground">
            <CalendarDays className="w-4 h-4" />
            New Booking / Schedule
          </span>
          <button
            onClick={() => setLocation("/booking")}
            className="flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            data-testid="link-booking-schedule"
          >
            <CalendarDays className="w-4 h-4" />
            Booking / Schedule
          </button>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportExcel}
            disabled={visibleFamilies.length === 0}
            className="flex items-center gap-1.5 px-3 h-8 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-export-excel"
          >
            <Download className="w-4 h-4" />
            Export Excel
          </button>
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 h-8 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </header>

      <main ref={mainRef} className="flex-1 overflow-auto p-4">
        <div className="w-full">
          <div className="mb-4">
            <h1 className="text-2xl font-bold tracking-tight">
              New Booking / Schedule
            </h1>
            <p className="text-sm text-muted-foreground">
              Next available production and ship dates for new machine orders,
              by family. <span className="font-medium">OPEN</span> rows are
              slots you can book.
            </p>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : visibleFamilies.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              No machine orders found.
            </div>
          ) : (
            <div className="space-y-8">
              {visibleFamilies.map(({ family, rows }) => (
                <section
                  key={family.tab}
                  className="border border-border rounded-lg overflow-hidden bg-card"
                  data-testid={`family-${family.tab}`}
                >
                  <div className="bg-primary text-primary-foreground px-4 py-2 font-bold text-center tracking-wide">
                    {family.label}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                          <Th>Allocated Resource</Th>
                          <Th>Assigned Prod Order</Th>
                          <Th>Prod Group</Th>
                          <Th>Status</Th>
                          <Th>Prod Start</Th>
                          <Th center>Pick</Th>
                          <Th>Assy Start</Th>
                          <Th center>Assy</Th>
                          <Th>Assy End</Th>
                          <Th>Ship Date</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr
                            key={r.key}
                            className="border-t border-border"
                            data-testid={`row-${family.tab}-${r.status}`}
                          >
                            <Td wrap className="font-medium min-w-[10rem]">{r.resource || ""}</Td>
                            <Td className="font-mono text-xs">{r.prodOrder || ""}</Td>
                            <Td>{r.group || ""}</Td>
                            <Td>
                              <span
                                className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[r.status]}`}
                              >
                                {r.status}
                              </span>
                            </Td>
                            <Td>{pretty(r.productionStart)}</Td>
                            <Td center>{r.pick}</Td>
                            <Td>{pretty(r.assyStart)}</Td>
                            <Td center>{r.assy}</Td>
                            <Td>{pretty(r.assyEnd)}</Td>
                            <Td className="font-medium">{pretty(r.ship)}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>

      <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-2" data-testid="booking-scroll-nav">
        <button
          type="button"
          onClick={() => scrollTo("top")}
          title="Scroll to top"
          aria-label="Scroll to top"
          data-testid="button-scroll-top"
          className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => scrollTo("bottom")}
          title="Scroll to bottom"
          aria-label="Scroll to bottom"
          data-testid="button-scroll-bottom"
          className="w-9 h-9 flex items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg hover:text-foreground hover:bg-muted transition-colors"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Th({
  children,
  center,
}: {
  children: React.ReactNode;
  center?: boolean;
}) {
  return (
    <th
      className={`px-3 py-2 font-semibold whitespace-nowrap ${center ? "text-center" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  center,
  wrap,
  className = "",
}: {
  children: React.ReactNode;
  center?: boolean;
  wrap?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 ${wrap ? "whitespace-normal break-words" : "whitespace-nowrap"} ${center ? "text-center" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}

export default NewBooking;
