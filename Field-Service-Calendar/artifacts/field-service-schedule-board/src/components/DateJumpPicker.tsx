import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── helpers ────────────────────────────────────────────────────────────────

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** Returns the ISO date for the Monday of the week containing `d`.
 *  Always reads the date components via UTC getters because all cell
 *  Date objects in the grid are constructed with Date.UTC(). */
function startOfWeekISO(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW_ABBR = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

// ─── types ───────────────────────────────────────────────────────────────────

export type DateJumpPickerMode = "week" | "month";

interface DateJumpPickerProps {
  /** ISO date string for the current start of the displayed range */
  value: string;
  mode: DateJumpPickerMode;
  onSelect: (iso: string) => void;
  children: React.ReactNode;
}

// ─── component ───────────────────────────────────────────────────────────────

export function DateJumpPicker({ value, mode, onSelect, children }: DateJumpPickerProps) {
  const [open, setOpen] = useState(false);

  // The "page" being shown in the popover header (a month for week-mode, a year for month-mode)
  const valueDate = new Date(value + "T00:00:00Z");
  const [pageYear, setPageYear] = useState(valueDate.getUTCFullYear());
  const [pageMonth, setPageMonth] = useState(valueDate.getUTCMonth()); // 0-based; only used in week mode

  // Year-selection overlay
  const [showYearGrid, setShowYearGrid] = useState(false);

  // Keep page in sync when value changes externally
  useEffect(() => {
    const d = new Date(value + "T00:00:00Z");
    setPageYear(d.getUTCFullYear());
    setPageMonth(d.getUTCMonth());
    setShowYearGrid(false);
  }, [value, open]);

  const handleSelect = useCallback(
    (iso: string) => {
      onSelect(iso);
      setOpen(false);
      setShowYearGrid(false);
    },
    [onSelect],
  );

  // ── nav helpers ─────────────────────────────────────────────────────────

  const prevPage = () => {
    if (mode === "week") {
      if (pageMonth === 0) {
        setPageMonth(11);
        setPageYear((y) => y - 1);
      } else {
        setPageMonth((m) => m - 1);
      }
    } else {
      setPageYear((y) => y - 1);
    }
  };

  const nextPage = () => {
    if (mode === "week") {
      if (pageMonth === 11) {
        setPageMonth(0);
        setPageYear((y) => y + 1);
      } else {
        setPageMonth((m) => m + 1);
      }
    } else {
      setPageYear((y) => y + 1);
    }
  };

  const headerLabel = mode === "week" ? `${MONTH_ABBR[pageMonth]} ${pageYear}` : `${pageYear}`;

  // ── keyboard handler for the popover ────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setShowYearGrid(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label="Open date picker"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="cursor-pointer rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((o) => !o);
            }
          }}
        >
          {children}
        </div>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto p-3 select-none"
        align="center"
        onKeyDown={handleKeyDown}
        aria-label="Date picker"
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            aria-label="Previous"
            className="p-1 rounded hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={prevPage}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            className="text-sm font-semibold px-2 py-0.5 rounded hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={showYearGrid ? "Hide year grid" : "Show year grid"}
            onClick={() => setShowYearGrid((v) => !v)}
          >
            {headerLabel}
          </button>

          <button
            type="button"
            aria-label="Next"
            className="p-1 rounded hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={nextPage}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* ── Year-jump overlay ──────────────────────────────────────── */}
        {showYearGrid && (
          <YearGrid
            currentYear={pageYear}
            onSelect={(y) => {
              setPageYear(y);
              setShowYearGrid(false);
            }}
          />
        )}

        {/* ── Calendar body ──────────────────────────────────────────── */}
        {!showYearGrid && mode === "week" && (
          <WeekModeGrid
            pageYear={pageYear}
            pageMonth={pageMonth}
            activeStart={value}
            onSelect={handleSelect}
          />
        )}

        {!showYearGrid && mode === "month" && (
          <MonthModeGrid
            pageYear={pageYear}
            activeStart={value}
            onSelect={handleSelect}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

// ─── WeekModeGrid ─────────────────────────────────────────────────────────────

interface WeekModeGridProps {
  pageYear: number;
  pageMonth: number;
  activeStart: string; // ISO, the Monday of the current week shown on the board
  onSelect: (iso: string) => void;
}

function WeekModeGrid({ pageYear, pageMonth, activeStart, onSelect }: WeekModeGridProps) {
  // Compute the active week range (Mon–Sun) for highlighting
  const activeMonday = new Date(activeStart + "T00:00:00Z");
  const activeSunday = new Date(Date.UTC(activeMonday.getUTCFullYear(), activeMonday.getUTCMonth(), activeMonday.getUTCDate() + 6));

  // Build the day cells for the month grid
  // First day shown = Sunday before (or on) the 1st of the month
  const firstOfMonth = new Date(Date.UTC(pageYear, pageMonth, 1));
  const startDow = firstOfMonth.getUTCDay(); // 0=Sun
  const gridStart = new Date(Date.UTC(pageYear, pageMonth, 1 - startDow));

  // We always show 6 rows × 7 cols = 42 cells
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(Date.UTC(gridStart.getUTCFullYear(), gridStart.getUTCMonth(), gridStart.getUTCDate() + i)));
  }

  const isActiveWeek = (d: Date) => {
    const t = d.getTime();
    return t >= activeMonday.getTime() && t <= activeSunday.getTime();
  };

  const isInCurrentMonth = (d: Date) => d.getUTCMonth() === pageMonth;

  const todayISO = new Date().toISOString().slice(0, 10);
  const isTodayCell = (d: Date) => d.toISOString().slice(0, 10) === todayISO;

  return (
    <div role="grid" aria-label="Month calendar">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1" role="row">
        {DOW_ABBR.map((d) => (
          <div
            key={d}
            role="columnheader"
            className="text-center text-xs text-muted-foreground font-medium py-0.5"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-y-0.5" role="rowgroup">
        {cells.map((d, i) => {
          const active = isActiveWeek(d);
          const isMonday = d.getUTCDay() === 1;
          const isSunday = d.getUTCDay() === 0;
          const inMonth = isInCurrentMonth(d);
          const isToday = isTodayCell(d);

          // Rounded ends for the active week highlight band
          const bandClass = active
            ? cn(
                "bg-primary/15",
                isMonday && "rounded-l-full",
                isSunday && "rounded-r-full",
              )
            : "";

          return (
            <div key={i} role="gridcell" className={bandClass}>
              <button
                type="button"
                className={cn(
                  "w-full text-xs py-1 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  inMonth ? "text-foreground" : "text-muted-foreground/50",
                  isToday && !active && "font-bold underline",
                  active && "font-semibold text-primary",
                  "hover:bg-primary/20",
                )}
                aria-label={d.toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
                aria-pressed={active}
                onClick={() => onSelect(startOfWeekISO(d))}
              >
                {d.getUTCDate()}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MonthModeGrid ────────────────────────────────────────────────────────────

interface MonthModeGridProps {
  pageYear: number;
  activeStart: string; // ISO, 1st of the currently viewed month
  onSelect: (iso: string) => void;
}

function MonthModeGrid({ pageYear, activeStart, onSelect }: MonthModeGridProps) {
  const activeDate = new Date(activeStart + "T00:00:00Z");
  const activeYear = activeDate.getUTCFullYear();
  const activeMonth = activeDate.getUTCMonth();

  return (
    <div className="grid grid-cols-4 gap-1" role="grid" aria-label="Month grid">
      {MONTH_ABBR.map((abbr, idx) => {
        const isActive = pageYear === activeYear && idx === activeMonth;
        const iso = isoDate(pageYear, idx, 1);
        return (
          <button
            key={abbr}
            type="button"
            role="gridcell"
            aria-pressed={isActive}
            aria-label={`${abbr} ${pageYear}`}
            className={cn(
              "py-2 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-primary text-primary-foreground font-semibold"
                : "hover:bg-accent",
            )}
            onClick={() => onSelect(iso)}
          >
            {abbr}
          </button>
        );
      })}
    </div>
  );
}

// ─── YearGrid ────────────────────────────────────────────────────────────────

interface YearGridProps {
  currentYear: number;
  onSelect: (year: number) => void;
}

function YearGrid({ currentYear, onSelect }: YearGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate ±10 years around the current year
  const years: number[] = [];
  for (let y = currentYear - 10; y <= currentYear + 10; y++) {
    years.push(y);
  }

  // Scroll the current year into view
  useEffect(() => {
    if (containerRef.current) {
      const el = containerRef.current.querySelector("[data-current='true']") as HTMLElement | null;
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-48 overflow-y-auto grid grid-cols-3 gap-1 pr-1"
      role="grid"
      aria-label="Year selection"
    >
      {years.map((y) => (
        <button
          key={y}
          type="button"
          data-current={y === currentYear ? "true" : undefined}
          aria-pressed={y === currentYear}
          className={cn(
            "py-1.5 text-sm rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            y === currentYear
              ? "bg-primary text-primary-foreground font-semibold"
              : "hover:bg-accent",
          )}
          onClick={() => onSelect(y)}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
