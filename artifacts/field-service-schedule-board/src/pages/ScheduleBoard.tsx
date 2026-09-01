import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  useGetWbScheduleBoard,
  useGetWbUnscheduledJobs,
  useGetWbResourceUtilization,
  useSaveWbBooking,
  useListWbScheduleBlocks,
  useDeleteWbScheduleBlock,
  useUpdateWbScheduleBlock,
  useListWbPlaceholderJobs,
  useDeleteWbPlaceholderJob,
  useUpdateWbPlaceholderJob,
  useSearchWbJobs,
  useListWbBookingNotes,
  getListWbBookingNotesQueryKey,
  getSearchWbJobsQueryKey,
  getListWbWorkOrdersQueryKey,
  getGetWbScheduleBoardQueryKey,
  getGetWbResourceUtilizationQueryKey,
  getGetWbUnscheduledJobsQueryKey,
  getListWbScheduleBlocksQueryKey,
  getListWbPlaceholderJobsQueryKey,
  useGetWbServiceLocation,
  getGetWbServiceLocationQueryKey,
  type WbWorkOrder,
  type UnscheduledJob,
  type ScheduleBlock,
  type PlaceholderJob,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Globe,
  Phone,
  Briefcase,
  AlertTriangle,
  User,
  MapPin,
  Clock,
  Download,
  ExternalLink,
  RefreshCw,
  Car,
  Sun,
  Pencil,
  Plus,
  X,
  Search,
} from "lucide-react";
import { EditBookingDialog } from "@/components/EditBookingDialog";
import { AddBlockDialog } from "@/components/AddBlockDialog";
import { EditBlockDialog } from "@/components/EditBlockDialog";
import { EditPlaceholderJobDialog } from "@/components/EditPlaceholderJobDialog";
import { CalendarReportDialog, type CalendarReportTech } from "@/components/CalendarReportDialog";
import { DateJumpPicker } from "@/components/DateJumpPicker";
import {
  timeToMins,
  conflictedIdsForTech,
  wouldDropConflict,
} from "@/lib/conflicts";
import { planDrop } from "@/lib/dropPlan";

type ViewMode = "week" | "month" | "tech";
type GroupByMode = "tech-region" | "service-location";

function startOfWeekISO(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function startOfMonthISO(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
    .toISOString()
    .slice(0, 10);
}

function addYearsISO(iso: string, years: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const targetYear = d.getUTCFullYear() + years;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDayOfTargetMonth);
  return new Date(Date.UTC(targetYear, d.getUTCMonth(), day))
    .toISOString()
    .slice(0, 10);
}

function nextQuarterStartISO(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const currentQuarterStartMonth = Math.floor(d.getUTCMonth() / 3) * 3;
  return new Date(
    Date.UTC(d.getUTCFullYear(), currentQuarterStartMonth + 3, 1),
  )
    .toISOString()
    .slice(0, 10);
}

function fmtDayHeader(iso: string, mode: ViewMode): { dow: string; date: string } {
  const d = new Date(iso + "T00:00:00Z");
  return {
    dow: d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
    date:
      mode === "week"
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
        : String(d.getUTCDate()),
  };
}

function fmtRangeLabel(start: string, dayCount: number, mode: ViewMode): string {
  const s = new Date(start + "T00:00:00Z");
  if (mode === "month") {
    return s.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const e = new Date(start + "T00:00:00Z");
  e.setUTCDate(e.getUTCDate() + Math.max(0, dayCount - 1));
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}, ${s.getUTCFullYear()}`;
}

function fmtTime(t: string | null | undefined): string {
  if (!t) return "";
  const hhmm = t.length >= 5 ? t.slice(0, 5) : t;
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  if (!Number.isFinite(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mStr ?? "00"} ${period}`;
}

/**
 * Convert a split UTC date ("2026-06-30") + time ("14:30:00") pair into a
 * 12-hour local-time string ("10:30 AM"). Falls back to the raw UTC fmtTime
 * when the date part is missing so single-field callers still work.
 */
function fmtLocalTime(
  date: string | null | undefined,
  time: string | null | undefined,
): string {
  if (!time) return "";
  if (!date) return fmtTime(time); // no date → can't convert, show UTC
  const iso = `${date}T${time.includes(":") && time.length >= 5 ? time : time + ":00"}`;
  // Treat as UTC by appending Z only when the string has no zone info.
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z");
  if (isNaN(d.getTime())) return fmtTime(time);
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "";
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const mins = Math.max(0, toMin(end) - toMin(start));
  if (!mins) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// localStorage key for the visual-only per-cell chip ordering.
const CHIP_ORDER_LS_KEY = "scheduleBoard.chipOrder";

// Distinct, accessible palette for technicians. Each entry pairs a
// chip background/border with a matching dot for the technician label.
const TECH_PALETTE = [
  { chip: "bg-blue-100   text-blue-900   border-blue-400   hover:bg-blue-200", dot: "bg-blue-500" },
  { chip: "bg-emerald-100 text-emerald-900 border-emerald-400 hover:bg-emerald-200", dot: "bg-emerald-500" },
  { chip: "bg-amber-100  text-amber-900  border-amber-400  hover:bg-amber-200", dot: "bg-amber-500" },
  { chip: "bg-rose-100   text-rose-900   border-rose-400   hover:bg-rose-200", dot: "bg-rose-500" },
  { chip: "bg-violet-100 text-violet-900 border-violet-400 hover:bg-violet-200", dot: "bg-violet-500" },
  { chip: "bg-cyan-100   text-cyan-900   border-cyan-400   hover:bg-cyan-200", dot: "bg-cyan-500" },
  { chip: "bg-fuchsia-100 text-fuchsia-900 border-fuchsia-400 hover:bg-fuchsia-200", dot: "bg-fuchsia-500" },
  { chip: "bg-lime-100   text-lime-900   border-lime-500   hover:bg-lime-200", dot: "bg-lime-500" },
  { chip: "bg-orange-100 text-orange-900 border-orange-400 hover:bg-orange-200", dot: "bg-orange-500" },
  { chip: "bg-teal-100   text-teal-900   border-teal-400   hover:bg-teal-200", dot: "bg-teal-500" },
  { chip: "bg-pink-100   text-pink-900   border-pink-400   hover:bg-pink-200", dot: "bg-pink-500" },
  { chip: "bg-indigo-100 text-indigo-900 border-indigo-400 hover:bg-indigo-200", dot: "bg-indigo-500" },
  { chip: "bg-sky-100    text-sky-900    border-sky-400    hover:bg-sky-200", dot: "bg-sky-500" },
  { chip: "bg-yellow-100 text-yellow-900 border-yellow-500 hover:bg-yellow-200", dot: "bg-yellow-500" },
  { chip: "bg-red-100    text-red-900    border-red-400    hover:bg-red-200", dot: "bg-red-500" },
  { chip: "bg-gray-100  text-gray-700   border-gray-300   hover:bg-gray-200", dot: "bg-gray-400" },
  // R5 default: brighter red while keeping black text legible.
  { chip: "bg-red-300    text-black      border-red-600    hover:bg-red-400", dot: "bg-red-600" },
];


// Fixed region → palette-index map.  R99 uses index 15 (gray).
const REGION_COLOR_MAP: Record<string, number> = {
  R1: 0,   // blue
  R2: 13,  // yellow
  R3: 4,   // violet / purple
  R4: 12,  // sky blue
  R5: 16,  // bright red with black text
  R8: 14,  // red
  R99: 15, // gray
};

const REGION_POTENTIAL_COLOR_MAP: Record<string, number> = {
  ...REGION_COLOR_MAP,
  R4: 10, // Colour 11 — pink
};

const REGION_CUSTOM_COLOR_MAP: Record<string, number> = {
  ...REGION_COLOR_MAP,
  R4: 8, // orange
};

type RegionColorKind = "potential" | "custom" | "standard";

const REGION_TECHNICIAN_ORDER: Record<string, readonly string[]> = {
  R2: [
    "Gene Leitheiser",
    "Steve Lockhart",
    "Brian Uniejewski",
    "Eric Vennemeyer",
    "Josh Whitta",
  ],
  R5: [
    "Matthew Piechoski",
    "George Hopf",
    "Garrett Glidden",
    "Robert Walck",
  ],
};

function regionColorIndex(
  regionName: string | null | undefined,
  kind: RegionColorKind = "standard",
): number {
  const map =
    kind === "potential"
      ? REGION_POTENTIAL_COLOR_MAP
      : kind === "custom"
        ? REGION_CUSTOM_COLOR_MAP
        : REGION_COLOR_MAP;
  return map[regionName ?? ""] ?? 0;
}

function regionPaletteEntry(
  regionName: string | null | undefined,
  kind: RegionColorKind = "standard",
) {
  if (!regionName) return TECH_PALETTE[0];
  const idx = regionColorIndex(regionName, kind);
  return TECH_PALETTE[idx] ?? TECH_PALETTE[0];
}

function cancelledChipColor() {
  return "bg-gray-100 text-gray-500 border-gray-300 line-through hover:bg-gray-200";
}

type ScheduleJob = {
  booking_id: string;
  work_order_id?: string | null;
  work_order_number?: string | null;
  title?: string | null;
  system_status?: string | null;
  booking_status?: string | null;
  customer_name?: string | null;
  technician_name?: string | null;
  contact_name?: string | null;
  contact_businessphone?: string | null;
  crmstart_time?: string | null;
  crmstarttime?: string | null;
  crmend_time?: string | null;
  crmendtime?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  city?: string | null;
  state?: string | null;
  day_index: number;
  span_start_day?: number | null;
  span_end_day?: number | null;
  equipment_names?: string[] | null;
  notes?: string | null;
};

type CrossLocationBooking = {
  locationId: string;
  locationName: string;
  homeRegionName: string | null;
  job: ScheduleJob;
};

function CrossLocationBookingIndicator({
  bookings,
  testId,
}: {
  bookings: CrossLocationBooking[];
  testId: string;
}) {
  const bookingDetails = bookings.map(({ locationName, homeRegionName, job }) => {
    const start = fmtLocalTime(job.crmstart_time, job.crmstarttime);
    const end = fmtLocalTime(job.crmend_time, job.crmendtime);
    const time = start && end ? `${start} – ${end}` : start || end;
    return {
      region: homeRegionName || "another region",
      location: [job.city, job.state].filter(Boolean).join(", ") || locationName,
      time: time || "—",
    };
  });
  const firstBooking = bookingDetails[0];

  return (
    <div
      className="relative z-10 flex w-full items-start gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-left text-[10px] font-semibold leading-tight text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
      data-testid={testId}
      role="status"
      aria-label={`Booked in ${firstBooking?.region}; Location: ${firstBooking?.location}; Time: ${firstBooking?.time}`}
      onClick={(event) => event.stopPropagation()}
    >
      <MapPin className="mt-0.5 h-2.5 w-2.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate">Booked in {firstBooking?.region}</span>
        <span className="block truncate font-medium opacity-80">
          Location: {firstBooking?.location}
        </span>
        <span className="block truncate font-medium opacity-80">
          Time: {firstBooking?.time}
          {bookingDetails.length > 1 && ` · +${bookingDetails.length - 1} more`}
        </span>
      </span>
    </div>
  );
}

// Build the shape EditBookingDialog expects (WbWorkOrder) from a board tile.
function buildEditRow(job: ScheduleJob, technicianId: string): WbWorkOrder {
  return {
    work_order_id: job.work_order_id ?? "",
    work_order_number: job.work_order_number ?? null,
    title: job.title ?? null,
    system_status: job.system_status ?? null,
    customer_name: job.customer_name ?? null,
    booking_id: job.booking_id,
    booking_status: job.booking_status ?? null,
    start_time: job.start_time ?? null,
    end_time: job.end_time ?? null,
    technician_id: technicianId,
    technician_name: job.technician_name ?? null,
    pending_writeback: null,
  };
}

// Build the WbWorkOrder shape for an unscheduled job. A null booking_id puts the
// dialog in "new booking" mode so it stages a create rather than an edit.
function buildNewBookingRow(job: UnscheduledJob, technicianId: string | null): WbWorkOrder {
  return {
    work_order_id: job.work_order_id ?? "",
    work_order_number: job.work_order_number ?? null,
    title: job.work_order_type ?? null,
    system_status: "Unscheduled",
    customer_name: job.customer_name ?? null,
    booking_id: null,
    booking_status: null,
    start_time: null,
    end_time: null,
    technician_id: technicianId,
    technician_name: technicianId
      ? job.best_fit_techs?.find((t) => t.technician_id === technicianId)?.resource_name ?? null
      : null,
    pending_writeback: null,
  };
}

// Count distinct bookings in a chip list. Multi-day bookings emit one chip per
// spanned day, so the raw chip count over-reports the number of bookings.
function jobMatchesSearch(job: ScheduleJob, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return !!(
    job.work_order_number?.toLowerCase().includes(lower) ||
    job.customer_name?.toLowerCase().includes(lower) ||
    job.city?.toLowerCase().includes(lower) ||
    job.state?.toLowerCase().includes(lower) ||
    job.technician_name?.toLowerCase().includes(lower) ||
    job.title?.toLowerCase().includes(lower)
  );
}

function placeholderJobMatchesSearch(job: PlaceholderJob, q: string, techName?: string | null): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return !!(
    job.customer_name?.toLowerCase().includes(lower) ||
    job.city?.toLowerCase().includes(lower) ||
    job.state?.toLowerCase().includes(lower) ||
    job.status?.toLowerCase().includes(lower) ||
    job.title?.toLowerCase().includes(lower) ||
    techName?.toLowerCase().includes(lower)
  );
}

function distinctJobCount(jobs: { booking_id: string }[]): number {
  return new Set(jobs.map((j) => j.booking_id)).size;
}

// Label for a chip's time range. A multi-day booking renders one chip per day:
// the first day runs from its start time onward (→), interior days are full
// days, and the last day runs until its end time.
function chipTimeLabel(job: ScheduleJob): string {
  const start = fmtLocalTime(job.crmstart_time, job.crmstarttime);
  const end = fmtLocalTime(job.crmend_time, job.crmendtime);
  const spanStart = job.span_start_day ?? job.day_index;
  const spanEnd = job.span_end_day ?? job.day_index;
  if (spanEnd <= spanStart) {
    return end ? `${start}–${end}` : start;
  }
  if (job.day_index <= spanStart) return start ? `${start} →` : "→";
  if (job.day_index >= spanEnd) return end ? `→ ${end}` : "→";
  return "All day";
}

function fmtBlockDuration(startIso: string, endIso: string): string {
  return fmtMins(Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

/**
 * Day (YYYY-MM-DD) an item's end time falls on for display purposes.
 * An end exactly at midnight belongs to the previous day, so e.g. a block
 * ending at 00:00 on the 12th doesn't render an extra chip on the 12th.
 */
function effectiveEndDay(endIso: string): string {
  const endDay = endIso.slice(0, 10);
  if (endIso.slice(11, 19) === "00:00:00") {
    return addDaysISO(endDay, -1);
  }
  return endDay;
}

function fmtBlockDay(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtBlockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Render chip notes: preserve line breaks entered in the dialog textarea while
// allowing each line to wrap within the chip.
function ChipNotes({ notes, className }: { notes: string; className: string }) {
  const wrappingClassName = className
    .replace(/\btruncate\b/g, "whitespace-normal break-words")
    .trim()
    .concat(" font-bold");
  const lines = notes
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length === 1) return <div className={wrappingClassName}>{lines[0]}</div>;
  return (
    <div className={wrappingClassName}>
      {lines.map((line, i) => (
        <div key={i} className="whitespace-normal break-words">
          • {line}
        </div>
      ))}
    </div>
  );
}

function BlockChip({
  block,
  dayIso,
  onEdit,
  onDelete,
  onDragStart,
  onResizeStart,
  onDragEnd,
  isDragging,
  regionName,
}: {
  block: ScheduleBlock;
  /** The day cell this chip instance is rendered in (YYYY-MM-DD). */
  dayIso?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onDragStart?: () => void;
  onResizeStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  regionName: string;
}) {
  const isDriveTime = block.block_type === "drive_time";
  const isPTO = block.block_type === "pto";
  const isCustom = block.block_type === "custom";
  const duration = fmtBlockDuration(block.start_time, block.end_time);

  const startDay = block.start_time.slice(0, 10);
  const endDay = effectiveEndDay(block.end_time);
  const isMultiDay = endDay > startDay;
  const dayCount = isMultiDay
    ? Math.round(
        (new Date(`${endDay}T00:00:00`).getTime() - new Date(`${startDay}T00:00:00`).getTime()) /
          86_400_000,
      ) + 1
    : 1;

  // If a colour index is set, resolve it from the shared palette; otherwise fall
  // back to the region colour.
  const paletteOverride =
    block.color_index != null
      ? TECH_PALETTE[block.color_index]?.chip ?? null
      : null;
  const chipCls = paletteOverride ?? regionPaletteEntry(regionName, isCustom ? "custom" : "standard").chip;

  const typeLabel = isDriveTime ? "Travel Time" : isPTO ? "PTO" : "Custom";
  const label = isDriveTime ? "Travel Time" : isPTO ? "PTO" : (block.title?.trim() || "Custom");

  // For multi-day blocks (rendered once per day), only the start-day chip moves
  // the block and only the end-day chip exposes the stretch handle, so the
  // affordances always act on the block's real boundaries.
  const canDrag = !!onDragStart && (!dayIso || dayIso === startDay);
  const showResizeHandle = !!onResizeStart && (!dayIso || dayIso === endDay);

  // HOVER DISABLED — to restore: replace <> with <Tooltip>, uncomment
  // <TooltipTrigger asChild> / </TooltipTrigger>, and the <TooltipContent> block.
  return (
    <>
      {/* <TooltipTrigger asChild> */}
      <div
        role="button"
        tabIndex={0}
        draggable={canDrag}
        onClick={onEdit}
        onKeyDown={(e) => e.key === "Enter" && onEdit?.()}
        onDragStart={(e) => {
          if (!canDrag) {
            e.preventDefault();
            return;
          }
          onDragStart?.();
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(block.id));
          }
        }}
        onDragEnd={() => onDragEnd?.()}
        className={`relative w-full rounded border text-[11px] px-1.5 py-1 leading-tight cursor-pointer hover:brightness-95 transition-[filter] ${chipCls} ${isDragging ? "opacity-40" : ""}`}
      >
        <div className="flex items-center gap-1">
          {isDriveTime ? (
            <Car className="h-3 w-3 shrink-0" />
          ) : isPTO ? (
            <Sun className="h-3 w-3 shrink-0" />
          ) : (
            <Pencil className="h-3 w-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 font-semibold whitespace-normal break-words">{label}</span>
          {onDelete && <button
            type="button"
            className="ml-auto shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Remove block"
          >
            <X className="h-3 w-3" />
          </button>}
        </div>
        <div className="opacity-80 whitespace-normal break-words">
          {isMultiDay ? `${dayCount} days` : duration}
        </div>
        {block.notes && (
          <ChipNotes notes={block.notes} className="opacity-60 truncate" />
        )}
        {showResizeHandle && (
          <div
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              onResizeStart?.();
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(block.id));
              }
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              onDragEnd?.();
            }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-current opacity-0 hover:opacity-30 transition-opacity"
            title="Drag onto another day to extend or shorten this block"
            aria-label="Resize block"
          />
        )}
      </div>
      {/* </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        <div className="space-y-0.5">
          <div className="font-semibold">{label}</div>
          {isCustom && block.title?.trim() && (
            <div className="text-xs opacity-80">{typeLabel}</div>
          )}
          {isMultiDay ? (
            <div className="text-xs">
              {fmtBlockDay(startDay)} → {fmtBlockDay(endDay)} ({dayCount} days)
            </div>
          ) : (
            <div className="text-xs">{fmtBlockDay(startDay)}</div>
          )}
          <div className="text-xs">
            {fmtBlockTime(block.start_time)} – {fmtBlockTime(block.end_time)}
            {!isMultiDay && duration ? ` (${duration})` : ""}
          </div>
          {block.notes && <div className="text-xs opacity-80">{block.notes}</div>}
        </div>
      </TooltipContent>
      </Tooltip> */}
    </>
  );
}

function PlaceholderJobChip({
  job,
  dayIso,
  technicianId,
  onEdit,
  onDelete,
  onDragStart,
  onResizeStart,
  onDragEnd,
  isDragging,
  dimmed,
  regionName,
}: {
  job: PlaceholderJob;
  /** The day cell this chip instance is rendered in (YYYY-MM-DD). */
  dayIso?: string;
  technicianId?: string | null;
  onEdit?: () => void;
  onDelete?: () => void;
  onDragStart?: () => void;
  onResizeStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  dimmed?: boolean;
  regionName: string;
}) {
  const colorCls = job.color_index != null
     ? TECH_PALETTE[job.color_index]?.chip ?? regionPaletteEntry(regionName, "potential").chip
     : regionPaletteEntry(regionName, "potential").chip;
  const duration = fmtBlockDuration(job.start_time, job.end_time);
  const location = [job.city, job.state].filter(Boolean).join(", ");

  const startDay = job.start_time.slice(0, 10);
  const endDay = effectiveEndDay(job.end_time);
  const isMultiDay = endDay > startDay;
  const dayCount = isMultiDay
    ? Math.round(
        (new Date(`${endDay}T00:00:00`).getTime() - new Date(`${startDay}T00:00:00`).getTime()) /
          86_400_000,
      ) + 1
    : 1;

  // Mirrors BlockChip: for multi-day placeholders (rendered once per day), only
  // the start-day chip moves the job and only the end-day chip exposes the
  // stretch handle, so the affordances always act on the job's real boundaries.
  const canDrag = !!onDragStart && (!dayIso || dayIso === startDay);
  const showResizeHandle = !!onResizeStart && (!dayIso || dayIso === endDay);

  // When a service location is linked, prefetch its detail (equipment, contact)
  // so the rich tooltip is ready on hover. Cache is shared across all chips for
  // the same location, so a repeated location only fetches once.
  // Fetch is disabled while the tooltip is hidden to avoid silent wasted traffic.
  const { data: locDetail } = useGetWbServiceLocation(
    job.service_location_id ?? "",
    {
      query: {
        queryKey: getGetWbServiceLocationQueryKey(job.service_location_id ?? ""),
        enabled: false, // re-enable with tooltip (see HOVER DISABLED comment above)
        staleTime: 5 * 60_000,
      },
    },
  );
  // HOVER DISABLED — to restore: replace <> with <Tooltip>, uncomment
  // <TooltipTrigger asChild> / </TooltipTrigger>, both <TooltipContent> blocks,
  // and flip enabled back to `!!job.service_location_id` below.
  return (
    <>
      {/* <TooltipTrigger asChild> */}
      <div
        role="button"
        tabIndex={0}
        draggable={canDrag}
        onClick={onEdit}
        onKeyDown={(e) => e.key === "Enter" && onEdit?.()}
        onDragStart={(e) => {
          if (!canDrag) {
            e.preventDefault();
            return;
          }
          onDragStart?.();
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(job.id));
          }
        }}
        onDragEnd={() => onDragEnd?.()}
        className={`relative w-full rounded border border-dashed text-[11px] px-1.5 py-1 leading-tight cursor-pointer transition-colors ${colorCls} ${isDragging ? "opacity-40" : ""} ${dimmed ? "opacity-20" : ""}`}
      >
        {/* Diagonal stripe overlay — marks this as a potential job */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: "repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(0,0,0,0.06) 4px, rgba(0,0,0,0.06) 5px)" }}
        />
        {onDelete && <button
          type="button"
          className="absolute top-0.5 right-0.5 z-10 opacity-40 hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Remove placeholder job"
        >
          <X className="h-3 w-3" />
        </button>}
        <div className="relative opacity-90 whitespace-normal break-words pr-3">{job.customer_name || job.title}</div>
        {location && <div className="relative opacity-70 whitespace-normal break-words">{location}</div>}
        {job.status && <div className="relative opacity-60 whitespace-normal break-words">{job.status}</div>}
        {job.notes && (
          <ChipNotes notes={job.notes} className="relative opacity-60 truncate" />
        )}
        {showResizeHandle && (
          <div
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              onResizeStart?.();
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(job.id));
              }
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              onDragEnd?.();
            }}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r bg-current opacity-0 hover:opacity-30 transition-opacity"
            title="Drag onto another day to extend or shorten this placeholder job"
            aria-label="Resize placeholder job"
          />
        )}
      </div>
      {/* </TooltipTrigger>

      {job.service_location_id ? (
        // Rich tooltip for CRM-linked placeholder jobs (matches JobChip structure).
        // Canonical name/address from locDetail takes priority over freeform fields
        // so the tooltip always reflects what's in CRM, not stale freeform text.
        <TooltipContent side="top" className={`max-w-xs p-3 space-y-1.5 text-xs border ${colorCls}`}>
          <div className="font-bold text-sm">{job.title}</div>
          <div className="opacity-70 -mt-1">Potential Job</div>
          <div className="border-t border-current/20 pt-1.5 space-y-1">
            {(locDetail?.name ?? job.customer_name) && (
              <div>
                <span className="font-medium opacity-70">Customer:</span>{" "}
                {locDetail?.name ?? job.customer_name}
              </div>
            )}
            {[locDetail?.city ?? job.city, locDetail?.state ?? job.state].filter(Boolean).join(", ") && (
              <div>
                <span className="font-medium opacity-70">Location:</span>{" "}
                {[locDetail?.city ?? job.city, locDetail?.state ?? job.state].filter(Boolean).join(", ")}
              </div>
            )}
            {isMultiDay ? (
              <div>
                <span className="font-medium opacity-70">Dates:</span>{" "}
                {fmtBlockDay(startDay)} → {fmtBlockDay(endDay)} ({dayCount} days)
              </div>
            ) : (
              <div>
                <span className="font-medium opacity-70">Date:</span>{" "}
                {fmtBlockDay(startDay)}
              </div>
            )}
            <div>
              <span className="font-medium opacity-70">Time:</span>{" "}
              {fmtBlockTime(job.start_time)} – {fmtBlockTime(job.end_time)}
              {!isMultiDay && duration ? ` (${duration})` : ""}
            </div>
            {job.status && (
              <div className="pt-0.5">
                <Badge variant="outline" className="text-[10px] border-current/40">
                  {job.status}
                </Badge>
              </div>
            )}
            {(locDetail?.equipment?.length ?? 0) > 0 && (
              <div className="border-t border-current/20 pt-1.5">
                <span className="font-medium opacity-70">Equipment:</span>
                <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                  {locDetail!.equipment.slice(0, 5).map((eq, i) => (
                    <li key={`${eq.equipmentid}-${i}`} className="truncate">
                      {eq.name ?? "—"}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {job.notes && (
              <div className="opacity-80 border-t border-current/20 pt-1">{job.notes}</div>
            )}
            <div className="pt-1">
              <Link
                href={`/service-location/${job.service_location_id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] font-medium underline hover:opacity-80"
              >
                <ExternalLink className="h-3 w-3" />
                View service location details
              </Link>
            </div>
          </div>
        </TooltipContent>
      ) : (
        // Simple freeform tooltip for unlinked placeholder jobs
        <TooltipContent side="top" className={`max-w-[260px] border ${colorCls}`}>
          <div className="space-y-0.5">
            <div className="font-semibold">{job.title}</div>
            <div className="text-xs opacity-80">Potential Job</div>
            {job.customer_name && <div className="text-xs">{job.customer_name}</div>}
            {location && <div className="text-xs">{location}</div>}
            {isMultiDay ? (
              <div className="text-xs">
                {fmtBlockDay(startDay)} → {fmtBlockDay(endDay)} ({dayCount} days)
              </div>
            ) : (
              <div className="text-xs">{fmtBlockDay(startDay)}</div>
            )}
            <div className="text-xs">
              {fmtBlockTime(job.start_time)} – {fmtBlockTime(job.end_time)}
              {!isMultiDay && duration ? ` (${duration})` : ""}
            </div>
            {job.status && (
              <div className="text-xs pt-0.5">
                <Badge variant="outline" className="text-[10px]">{job.status}</Badge>
              </div>
            )}
            {job.notes && <div className="text-xs opacity-80">{job.notes}</div>}
          </div>
        </TooltipContent>
      )}
      </Tooltip> */}
    </>
  );
}

function JobChip({
  job,
  compact,
  colorClass,
  isConflict,
  syncPending,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
  showEquipment,
  showDuration = true,
  dimmed,
  localNote,
}: {
  job: ScheduleJob;
  compact: boolean;
  colorClass: string;
  isConflict?: boolean;
  /** True while a CRM save for this booking is actively syncing back to the mirror DB (22 s window). */
  syncPending?: boolean;
  onOpen?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
  showEquipment?: boolean;
  showDuration?: boolean;
  /** Fades the chip when a search is active and this job doesn't match. */
  dimmed?: boolean;
  /** Dispatcher note stored locally (not from CRM). */
  localNote?: string | null;
}) {
  const isCancelled = (job.system_status ?? "").toLowerCase() === "cancelled";
  const spanStart = job.span_start_day ?? job.day_index;
  const spanEnd = job.span_end_day ?? job.day_index;
  const isMultiDay = spanEnd > spanStart;
  const isStartChip = !isMultiDay || job.day_index <= spanStart;
  const dayPos = job.day_index - spanStart + 1;
  const dayTotal = spanEnd - spanStart + 1;
  const chip = (
    <button
      type="button"
      draggable={isStartChip}
      onClick={onOpen}
      onDragStart={(e) => {
        if (!isStartChip) {
          e.preventDefault();
          return;
        }
        onDragStart?.();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", job.booking_id);
        }
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`relative w-full text-left text-[11px] leading-tight rounded border ${compact ? "px-1 py-0.5" : "px-1.5 py-1"} ${isStartChip ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} transition-opacity transition-colors ${isCancelled ? cancelledChipColor() : colorClass} ${isConflict ? "ring-2 ring-amber-400 ring-offset-0" : ""} ${isDragging ? "opacity-40" : ""} ${dimmed ? "opacity-20" : ""}`}
      data-testid={`chip-job-${job.booking_id}`}
    >
      {syncPending && (
        <RefreshCw
          className="absolute top-0.5 right-0.5 h-3 w-3 text-red-500 animate-spin"
          aria-label="Syncing with CRM"
        />
      )}
      <div className="flex items-center gap-1">
         <span className="min-w-0 flex-1 font-semibold whitespace-normal break-words">{job.work_order_number ?? "WO"}</span>
        {isMultiDay && (
          <span className="shrink-0 rounded bg-black/10 px-1 text-[9px] font-semibold tabular-nums">
            D{dayPos}/{dayTotal}
          </span>
        )}
        {isConflict && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Double-booked" />
        )}
      </div>
      {!compact && <div className="opacity-90 whitespace-normal break-words">{job.customer_name ?? "—"}</div>}
      {!compact && (job.city || job.state) && (
        <div className="opacity-75 whitespace-normal break-words">
          {[job.city, job.state].filter(Boolean).join(", ")}
        </div>
      )}
      {!compact && (job.crmstarttime || job.crmendtime) && showDuration && (
        <div className="opacity-80 whitespace-normal break-words">
          {isMultiDay
            ? chipTimeLabel(job)
            : fmtDuration(job.crmstarttime, job.crmendtime) || chipTimeLabel(job)}
        </div>
      )}
      {!compact && job.notes && (
        <div className="font-bold opacity-70 whitespace-normal break-words">{job.notes}</div>
      )}
      {!compact && localNote && (
        <ChipNotes notes={localNote} className="opacity-75 truncate border-t border-current/20 mt-0.5 pt-0.5 italic" />
      )}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent
        side="top"
        className={`max-w-xs p-3 space-y-1.5 text-xs border ${isCancelled ? cancelledChipColor() : colorClass}`}
      >
        <div className="font-bold text-sm">{job.work_order_number ?? "Work Order"}</div>
        {job.title && <div className="opacity-80 -mt-1">{job.title}</div>}
        <div className="border-t border-current/20 pt-1.5 space-y-1">
          <div>
            <span className="font-medium opacity-70">Customer:</span>{" "}
            {job.customer_name ?? "—"}
          </div>
          <div>
            <span className="font-medium opacity-70">Technician:</span>{" "}
            {job.technician_name ?? "—"}
          </div>
          <div>
            <span className="font-medium opacity-70">Date:</span>{" "}
            {job.crmstart_time ? fmtBlockDay(job.crmstart_time) : "—"}
            {job.crmend_time && job.crmend_time !== job.crmstart_time
              ? ` → ${fmtBlockDay(job.crmend_time)}`
              : ""}
          </div>
          <div>
            <span className="font-medium opacity-70">Time:</span>{" "}
            {fmtLocalTime(job.crmstart_time, job.crmstarttime) || "—"}
            {" – "}
            {fmtLocalTime(job.crmend_time, job.crmendtime) || "—"}
            {fmtDuration(job.crmstarttime ?? undefined, job.crmendtime ?? undefined)
              ? ` (${fmtDuration(job.crmstarttime ?? undefined, job.crmendtime ?? undefined)})`
              : ""}
          </div>
          {(job.city || job.state) && (
            <div>
              <span className="font-medium opacity-70">Location:</span>{" "}
              {[job.city, job.state].filter(Boolean).join(", ") || "—"}
            </div>
          )}
          {job.system_status && (
            <div className="pt-0.5">
              <Badge variant="outline" className="text-[10px] border-current/40">
                {job.system_status}
              </Badge>
            </div>
          )}
          {showEquipment && (job.equipment_names?.length ?? 0) > 0 && (
            <div className="border-t border-current/20 pt-1.5">
              <span className="font-medium opacity-70">Equipment:</span>
              <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                {job.equipment_names!.slice(0, 5).map((name, i) => (
                  <li key={`${name}-${i}`} className="truncate">
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isConflict && (
            <div className="flex items-center gap-1 pt-1 text-amber-600 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              Double-booked — time conflict
            </div>
          )}
          {localNote && (
            <div className="border-t border-current/20 pt-1.5 space-y-0.5">
              <span className="font-medium opacity-70">Note:</span>
              <div className="opacity-90 whitespace-pre-wrap">{localNote}</div>
            </div>
          )}
          {job.work_order_id && (
            <div className="pt-1">
              <Link
                href={`/work-order/${job.work_order_id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] font-medium underline hover:opacity-80"
              >
                <ExternalLink className="h-3 w-3" />
                View work order details
              </Link>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Utilization helpers ───────────────────────────────────────────────────────

function utilColors(pct: number) {
  if (pct > 100) return { bar: "bg-red-500", text: "text-red-700", bg: "bg-red-50" };
  if (pct >= 80) return { bar: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" };
  return { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" };
}

function fmtUtilHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

// Quote a single CSV cell, escaping embedded quotes and wrapping when the value
// contains a comma, quote, or newline (RFC 4180).
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Trigger a client-side download of CSV text as a file.
function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Shared hover readout for the capacity badges. The badges only have room for a
// single "X of Yh booked" figure, so the tooltip breaks that down into booked,
// capacity, remaining, and utilization % to help dispatchers make confident
// assignment decisions without leaving the board.
function CapacityTooltipContent({
  utilizedMinutes,
  capacityMinutes,
  colorClass,
  jobMinutes,
  potentialMinutes,
  driveTimeMinutes,
  ptoMinutes,
}: {
  utilizedMinutes: number;
  capacityMinutes: number;
  colorClass?: string;
  jobMinutes?: number;
  potentialMinutes?: number;
  driveTimeMinutes?: number;
  ptoMinutes?: number;
}) {
  const pct = capacityMinutes > 0 ? Math.round((utilizedMinutes / capacityMinutes) * 100) : 0;
  const remainingMinutes = capacityMinutes - utilizedMinutes;
  const colors = utilColors(pct);
  const labelCls = colorClass ? "font-medium opacity-70" : "font-medium text-muted-foreground";
  const hasBreakdown =
    (jobMinutes ?? 0) > 0 ||
    (potentialMinutes ?? 0) > 0 ||
    (driveTimeMinutes ?? 0) > 0 ||
    (ptoMinutes ?? 0) > 0;
  return (
    <TooltipContent
      side="top"
      className={`max-w-xs p-3 space-y-1 text-xs ${colorClass ? `border ${colorClass}` : ""}`}
    >
      <div className="font-bold text-sm">Capacity</div>
      <div className={`pt-1.5 space-y-1 border-t ${colorClass ? "border-current/20" : "border-border"}`}>
        <div className="flex justify-between gap-4">
          <span className={labelCls}>Booked:</span>
          <span>{fmtUtilHours(utilizedMinutes)}</span>
        </div>
        {hasBreakdown && (
          <div className="pl-2 space-y-0.5 text-[10px] opacity-80">
            {(jobMinutes ?? 0) > 0 && (
              <div className="flex justify-between gap-4">
                <span className={labelCls}>↳ Jobs:</span>
                <span>{fmtMins(jobMinutes!)}</span>
              </div>
            )}
            {(potentialMinutes ?? 0) > 0 && (
              <div className="flex justify-between gap-4">
                <span className={labelCls}>↳ Potential:</span>
                <span>{fmtMins(potentialMinutes!)}</span>
              </div>
            )}
            {(driveTimeMinutes ?? 0) > 0 && (
              <div className="flex justify-between gap-4">
                <span className={labelCls}>↳ Travel Time:</span>
                <span>{fmtMins(driveTimeMinutes!)}</span>
              </div>
            )}
            {(ptoMinutes ?? 0) > 0 && (
              <div className="flex justify-between gap-4">
                <span className={labelCls}>↳ PTO:</span>
                <span>{fmtMins(ptoMinutes!)}</span>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className={labelCls}>Capacity:</span>
          <span>{capacityMinutes > 0 ? fmtUtilHours(capacityMinutes) : "—"}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className={labelCls}>Remaining:</span>
          <span>
            {capacityMinutes > 0
              ? remainingMinutes >= 0
                ? fmtUtilHours(remainingMinutes)
                : `-${fmtUtilHours(-remainingMinutes)}`
              : "—"}
          </span>
        </div>
        <div className="flex justify-between gap-4 pt-0.5">
          <span className={labelCls}>Utilization:</span>
          <span className={`font-semibold ${capacityMinutes > 0 ? colors.text : ""}`}>
            {capacityMinutes > 0 ? `${pct}%` : "—"}
          </span>
        </div>
      </div>
    </TooltipContent>
  );
}

// At-a-glance availability readout shown on idle technician rows (capacity
// planning). An idle tech has booked nothing in the range, so we surface how
// much capacity is free, e.g. "Idle · 0 of 40h booked".
function IdleCapacityBadge({
  capacityMinutes,
  colorClass,
}: {
  capacityMinutes: number;
  colorClass?: string;
}) {
  const capH = Math.round(capacityMinutes / 60);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
          data-testid="idle-capacity-badge"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          {capH > 0 ? `Idle · 0 of ${capH}h booked` : "Idle · available"}
        </div>
      </TooltipTrigger>
      <CapacityTooltipContent utilizedMinutes={0} capacityMinutes={capacityMinutes} colorClass={colorClass} />
    </Tooltip>
  );
}

// At-a-glance utilization readout for technicians that already have jobs in the
// range. Surfaces how many hours are booked against capacity (e.g. "24 of 40h
// booked") plus a small bar tinted by utilization, so a dispatcher can tell
// whether a busy tech still has spare hours. Intentionally styled differently
// from the green idle pill so idle techs keep reading as fully "free".
function CapacityBadge({
  utilizedMinutes,
  capacityMinutes,
  colorClass,
  jobMinutes,
  potentialMinutes,
  driveTimeMinutes,
  ptoMinutes,
}: {
  utilizedMinutes: number;
  capacityMinutes: number;
  colorClass?: string;
  jobMinutes?: number;
  potentialMinutes?: number;
  driveTimeMinutes?: number;
  ptoMinutes?: number;
}) {
  const utilH = Math.round(utilizedMinutes / 60);
  const capH = Math.round(capacityMinutes / 60);
  const pct = capacityMinutes > 0 ? Math.round((utilizedMinutes / capacityMinutes) * 100) : 0;
  const colors = utilColors(pct);
  const barPct = Math.max(0, Math.min(100, pct));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="mt-0.5 flex items-center gap-1.5" data-testid="capacity-badge">
          <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-foreground/10">
            <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${barPct}%` }} />
          </div>
          <span className={`text-[10px] font-medium ${colors.text}`}>
            {capH > 0 ? `${utilH} of ${capH}h booked` : `${utilH}h booked`}
          </span>
        </div>
      </TooltipTrigger>
      <CapacityTooltipContent
        utilizedMinutes={utilizedMinutes}
        capacityMinutes={capacityMinutes}
        colorClass={colorClass}
        jobMinutes={jobMinutes}
        potentialMinutes={potentialMinutes}
        driveTimeMinutes={driveTimeMinutes}
        ptoMinutes={ptoMinutes}
      />
    </Tooltip>
  );
}

// Region-level roll-up of utilized vs. capacity hours for all techs in a region.
// Lets a dispatcher gauge how loaded a whole region is at a glance (e.g.
// "312 of 480h booked · 12 techs") with the same green/amber/red tinting used on
// the per-tech CapacityBadge. Shown in each region header across all views.
function RegionCapacityBadge({
  utilizedMinutes,
  capacityMinutes,
  techCount,
  colorClass,
}: {
  utilizedMinutes: number;
  capacityMinutes: number;
  techCount: number;
  colorClass?: string;
}) {
  const utilH = Math.round(utilizedMinutes / 60);
  const capH = Math.round(capacityMinutes / 60);
  const pct = capacityMinutes > 0 ? Math.round((utilizedMinutes / capacityMinutes) * 100) : 0;
  const colors = utilColors(pct);
  const barPct = Math.max(0, Math.min(100, pct));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 ${colors.bg} ${colors.text}`}
          data-testid="region-capacity-badge"
        >
          <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-foreground/10">
            <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${barPct}%` }} />
          </div>
          <span className="text-xs font-semibold whitespace-nowrap">
            {capH > 0 ? `${utilH} of ${capH}h booked` : `${utilH}h booked`}
            <span className="font-normal opacity-80">
              {" "}· {techCount} tech{techCount !== 1 ? "s" : ""}
            </span>
          </span>
        </div>
      </TooltipTrigger>
      <CapacityTooltipContent utilizedMinutes={utilizedMinutes} capacityMinutes={capacityMinutes} colorClass={colorClass} />
    </Tooltip>
  );
}

// ── Unscheduled card helpers ──────────────────────────────────────────────────

function fmtMins(mins: number | null | undefined): string {
  if (mins == null || mins <= 0) return "";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "No due date";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function getBucketIndex(dueDateISO: string | null | undefined): number {
  if (!dueDateISO) return 2;
  const d = new Date(dueDateISO + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return 2;
  const diffDays = (d.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (diffDays <= 14) return 0;
  if (diffDays <= 28) return 1;
  return 2;
}

function sortByDue(a: UnscheduledJob, b: UnscheduledJob): number {
  if (!a.due_date && !b.due_date) return 0;
  if (!a.due_date) return 1;
  if (!b.due_date) return -1;
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
}

function fmtFamiliarity(t: { city_jobs: number; region_jobs: number; same_region: boolean; region?: string | null }): string {
  const parts: string[] = [];
  if (t.same_region && t.region) parts.push(t.region);
  if (t.city_jobs > 0) parts.push(`${t.city_jobs} prior in city`);
  else if (t.region_jobs > 0) parts.push(`${t.region_jobs} prior in region`);
  return parts.join(" · ") || (t.region ?? "");
}

const UNSCHEDULED_BUCKETS = [
  {
    label: "Due Within 2 Weeks", sublabel: "Highest priority",
    border: "border-red-400", headerClass: "bg-red-50 border-b border-red-200 text-red-900",
    badgeClass: "bg-red-100 text-red-800 border border-red-200", dateClass: "text-red-700 font-semibold",
  },
  {
    label: "Due in 3–4 Weeks", sublabel: "Plan ahead",
    border: "border-amber-400", headerClass: "bg-amber-50 border-b border-amber-200 text-amber-900",
    badgeClass: "bg-amber-100 text-amber-800 border border-amber-200", dateClass: "text-amber-700 font-semibold",
  },
  {
    label: "Due in 4+ Weeks", sublabel: "Future / unset",
    border: "border-slate-300", headerClass: "bg-slate-50 border-b border-slate-200 text-slate-800",
    badgeClass: "bg-slate-100 text-slate-700 border border-slate-200", dateClass: "text-slate-600",
  },
];

function UnscheduledJobCard({
  job,
  bucketIdx,
  onSchedule,
  highlighted,
}: {
  job: UnscheduledJob;
  bucketIdx: number;
  onSchedule: (job: UnscheduledJob, technicianId: string | null) => void;
  highlighted?: boolean;
}) {
  const t1 = job.best_fit_techs?.[0];
  const t2 = job.best_fit_techs?.[1];
  const duration = fmtMins(job.duration_minutes);
  const loc = [job.city, job.state].filter(Boolean).join(", ");
  const dateClass = UNSCHEDULED_BUCKETS[bucketIdx].dateClass;
  const canSchedule = !!job.work_order_id;

  return (
    <div
      className={`group bg-white rounded-lg border shadow-sm hover:shadow-md transition-all p-4 flex flex-col gap-3 min-w-[260px] max-w-[300px] w-[280px] shrink-0 ${canSchedule ? "cursor-pointer" : ""} ${highlighted ? "border-primary ring-2 ring-primary/30 hover:border-primary" : "border-card-border hover:border-primary/50"}`}
      onClick={canSchedule ? () => onSchedule(job, t1?.technician_id ?? null) : undefined}
      role={canSchedule ? "button" : undefined}
      tabIndex={canSchedule ? 0 : undefined}
      onKeyDown={
        canSchedule
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSchedule(job, t1?.technician_id ?? null);
              }
            }
          : undefined
      }
      data-testid={`unscheduled-card-${job.work_order_id ?? job.work_order_number}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="font-mono font-bold text-sm">WO# {job.work_order_number ?? "—"}</span>
          {job.work_order_type && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <Badge
                variant="outline"
                className={`text-xs px-1.5 py-0 h-4 font-normal ${
                  job.work_order_type.toLowerCase() === "install"
                    ? "border-violet-400 text-violet-700 bg-violet-50"
                    : "border-blue-300 text-blue-700 bg-blue-50"
                }`}
              >
                {job.work_order_type}
              </Badge>
              {job.work_order_type.toLowerCase() === "install" && job.sales_order_number && (
                <span className="text-xs text-muted-foreground font-mono">SO: {job.sales_order_number}</span>
              )}
            </div>
          )}
        </div>
        <span className={`text-xs whitespace-nowrap shrink-0 ${dateClass}`}>
          {fmtDateShort(job.due_date)}
        </span>
      </div>

      <div>
        <div className="text-sm font-semibold text-foreground leading-tight">{job.customer_name ?? "—"}</div>
        {job.servicelocation && (
          <div className="text-xs text-muted-foreground truncate">{job.servicelocation}</div>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{loc || "—"}</span>
        {job.region && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 ml-auto shrink-0">{job.region}</Badge>
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {job.po_number && <span className="font-mono truncate">PO: {job.po_number}</span>}
        {duration && (
          <span className="flex items-center gap-1 shrink-0">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
        )}
      </div>

      {(job.contact_name || job.contact_phone) && (
        <div className="text-xs text-muted-foreground flex items-start gap-1.5">
          <User className="h-3 w-3 shrink-0 mt-0.5" />
          <div className="min-w-0">
            {job.contact_name && <div className="truncate">{job.contact_name}</div>}
            {job.contact_phone && (
              <div className="flex items-center gap-1">
                <Phone className="h-3 w-3 shrink-0" />
                <span className="truncate">{job.contact_phone}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {(t1 || t2) && (
        <div className="pt-2 border-t border-border space-y-1.5 mt-auto">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Best Fit</div>
          {[t1, t2].filter(Boolean).map((t, i) => (
            <button
              key={i}
              type="button"
              disabled={!canSchedule}
              onClick={(e) => {
                e.stopPropagation();
                onSchedule(job, t!.technician_id ?? null);
              }}
              className="w-full text-xs flex items-center justify-between gap-2 rounded-md border border-transparent px-1.5 py-1 -mx-1.5 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-transparent group/tech"
              data-testid={`schedule-with-${job.work_order_id ?? job.work_order_number}-${t!.technician_id}`}
              title={`Schedule with ${t!.resource_name ?? "technician"}`}
            >
              <span className="min-w-0">
                <span className="font-medium truncate block">{t!.resource_name ?? "—"}</span>
                <span className="text-muted-foreground truncate block text-[11px]">{fmtFamiliarity(t!)}</span>
              </span>
              <span className="shrink-0 inline-flex items-center gap-1 text-primary font-medium opacity-0 group-hover/tech:opacity-100 transition-opacity">
                <CalendarClock className="h-3 w-3" />
                Schedule
              </span>
            </button>
          ))}
        </div>
      )}

      {canSchedule && (
        <div className="text-[11px] text-muted-foreground italic text-center opacity-0 group-hover:opacity-100 transition-opacity">
          Click card to schedule
        </div>
      )}
    </div>
  );
}

export default function ScheduleBoard() {
  const { user } = useAuth();
  // Derive once; all write-gating in this component flows from this flag.
  const isEditor = user?.role === "editor";

  const [view, setView] = useState<ViewMode>("week");
  const [start, setStart] = useState<string>(() => startOfWeekISO(new Date()));
  const [selectedRegions, setSelectedRegions] = useState<Set<string> | null>(null);
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string> | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedUnscheduledId, setHighlightedUnscheduledId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WbWorkOrder | null>(null);
  // Estimated duration carried into the dialog when scheduling a new booking for
  // an unscheduled job, so the dialog can auto-fill the end time.
  const [editingDuration, setEditingDuration] = useState<number | null>(null);
  const [utilRegions, setUtilRegions] = useState<Set<string> | null>(null); // null = all
  // Calendar and Week view weekend visibility. Default off — both views show
  // Mon–Fri only; when true, Saturday and Sunday columns are included.
  const [showWeekends, setShowWeekends] = useState(false);
  // Grouping mode toggle. Default "tech-region" matches the original view;
  // "service-location" re-groups by work order state/city. Resets on page reload.
  const [groupBy, setGroupBy] = useState<GroupByMode>("tech-region");
  // When non-null, the board shows the stacked-weeks calendar for just this technician.
  const [focusedTechId, setFocusedTechId] = useState<string | null>(null);
  const [showCalendarReport, setShowCalendarReport] = useState(false);

  // Travel Time / PTO block being added (or null when dialog is closed).
  const [addingBlock, setAddingBlock] = useState<{
    technicianId: string;
    technicianName: string;
    date: string;
    regionName: string;
  } | null>(null);

  // Block being edited (or null when dialog is closed).
  const [editingBlock, setEditingBlock] = useState<{
    block: ScheduleBlock;
    technicianName: string;
    regionName: string;
  } | null>(null);

  // Placeholder job being edited (or null when dialog is closed).
  const [editingPlaceholder, setEditingPlaceholder] = useState<{
    job: PlaceholderJob;
    technicianName: string;
    regionName: string;
  } | null>(null);

  // Per-booking-id set of chips that are still syncing from CRM after a direct save.
  // Each id is removed individually after 22 s (matching the last follow-up refetch).
  const [pendingSyncIds, setPendingSyncIds] = useState<Set<string>>(new Set());
  const pendingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const handleSaveSuccess = (bookingId: string | null) => {
    if (!bookingId) return; // new booking — chip doesn't exist yet
    setPendingSyncIds((prev) => new Set([...prev, bookingId]));
    if (pendingTimersRef.current.has(bookingId)) {
      clearTimeout(pendingTimersRef.current.get(bookingId));
    }
    const timer = setTimeout(() => {
      setPendingSyncIds((prev) => {
        const next = new Set(prev);
        next.delete(bookingId);
        return next;
      });
      pendingTimersRef.current.delete(bookingId);
    }, 22_000);
    pendingTimersRef.current.set(bookingId, timer);
  };

  // Open the booking dialog in "new booking" mode for an unscheduled work order,
  // pre-filled with the work order and an optional suggested technician.
  const handleScheduleUnscheduled = (job: UnscheduledJob, technicianId: string | null) => {
    if (!job.work_order_id) return;
    setEditingDuration(job.duration_minutes ?? null);
    setEditing(buildNewBookingRow(job, technicianId));
  };

  // Drag-to-reschedule. The dragged payload (tile + source technician) lives in a
  // ref so the drop handler can read it synchronously — relying on state would be
  // racy because React may not have flushed the onDragStart update before onDrop.
  // `draggingId` and `dragOverCell` are state purely for visual feedback (dimming
  // the dragged tile and highlighting the hovered drop cell `${techId}:${dayIdx}`).
  const dragJobRef = useRef<{ job: ScheduleJob; sourceTechId: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  // Schedule-block drag: "move" relocates the whole block (new tech/day, same
  // duration and time-of-day); "resize" drags the right-edge handle onto a day
  // to become the block's new end day (stretching or shrinking it).
  const dragBlockRef = useRef<{ block: ScheduleBlock; mode: "move" | "resize" } | null>(null);
  const [draggingBlockId, setDraggingBlockId] = useState<number | null>(null);

  // Placeholder-job drag: same "move"/"resize" semantics as schedule blocks.
  const dragPlaceholderRef = useRef<{ job: PlaceholderJob; mode: "move" | "resize" } | null>(null);
  const [draggingPlaceholderId, setDraggingPlaceholderId] = useState<number | null>(null);

  const startDrag = (job: ScheduleJob, sourceTechId: string) => {
    dragJobRef.current = { job, sourceTechId };
    setDraggingId(job.booking_id);
  };

  const startPlaceholderDrag = (job: PlaceholderJob, mode: "move" | "resize") => {
    dragPlaceholderRef.current = { job, mode };
    setDraggingPlaceholderId(job.id);
  };

  const startBlockDrag = (block: ScheduleBlock, mode: "move" | "resize") => {
    dragBlockRef.current = { block, mode };
    setDraggingBlockId(block.id);
  };

  // ── Visual-only chip reordering within a cell ──────────────────────────────
  // Users can drag a job/block chip above or below another chip in the SAME
  // tech+day cell to rearrange the stack. This is purely cosmetic: the order is
  // kept client-side in localStorage (keyed `${techId}|${dayIso}`) and never
  // touches the underlying data.
  const [chipOrder, setChipOrder] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem(CHIP_ORDER_LS_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  });
  // `${orderKey}` of the cell the current drag started from (set on dragstart
  // capture at the chip wrapper, cleared in endDrag). Reordering only applies
  // when the drag stays within its source cell.
  const dragSourceCellRef = useRef<string | null>(null);
  const [reorderTarget, setReorderTarget] = useState<{
    orderKey: string;
    chipKey: string;
    pos: "above" | "below";
  } | null>(null);

  // Default type tier within a cell: Scheduled Jobs first, Potential Jobs
  // second, blocks (Travel Time / PTO / Custom) last — regardless of creation
  // order. Chip keys are prefixed by type ("job:", "ph:", "block:").
  const chipTypeTier = (key: string): number => {
    if (key.startsWith("job:")) return 0;
    if (key.startsWith("ph:")) return 1;
    return 2; // block:*
  };

  const applyChipOrder = <T extends { key: string }>(orderKey: string, items: T[]): T[] => {
    const order = chipOrder[orderKey];
    if (!order) {
      // No manual order saved: stable sort by type tier so chips keep their
      // default relative order within each tier.
      return [...items].sort((a, b) => chipTypeTier(a.key) - chipTypeTier(b.key));
    }
    const idx = new Map(order.map((k, i) => [k, i]));
    // Manually ordered chips come first in their saved positions. Chips
    // without a saved position go after them, ordered by type tier (jobs →
    // potential jobs → blocks) and otherwise keeping their default relative
    // order.
    return [...items].sort((a, b) => {
      const ai = idx.get(a.key);
      const bi = idx.get(b.key);
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return chipTypeTier(a.key) - chipTypeTier(b.key);
    });
  };

  const draggedChipKey = (): string | null => {
    if (dragBlockRef.current) {
      if (dragBlockRef.current.mode === "resize") return null;
      return `block:${dragBlockRef.current.block.id}`;
    }
    if (dragPlaceholderRef.current) {
      if (dragPlaceholderRef.current.mode === "resize") return null;
      return `ph:${dragPlaceholderRef.current.job.id}`;
    }
    if (dragJobRef.current) return `job:${dragJobRef.current.job.booking_id}`;
    return null;
  };

  const chipReorderDragOver = (
    e: React.DragEvent,
    orderKey: string,
    chipKey: string,
  ) => {
    if (dragSourceCellRef.current !== orderKey) return; // cross-cell drag → cell handles it
    const dragged = draggedChipKey();
    if (!dragged || dragged === chipKey) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
    setReorderTarget((prev) =>
      prev?.orderKey === orderKey && prev.chipKey === chipKey && prev.pos === pos
        ? prev
        : { orderKey, chipKey, pos },
    );
    setDragOverCell(null);
  };

  const chipReorderDrop = (
    e: React.DragEvent,
    orderKey: string,
    chipKey: string,
    orderedKeys: string[],
  ) => {
    if (dragSourceCellRef.current !== orderKey) return;
    const dragged = draggedChipKey();
    if (!dragged || dragged === chipKey) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
    // Dedupe defensively — duplicate logical keys from data anomalies would make
    // key-based insertion ambiguous.
    const list = [...new Set(orderedKeys)].filter((k) => k !== dragged);
    let ti = list.indexOf(chipKey);
    if (ti !== -1) {
      if (pos === "below") ti += 1;
      list.splice(ti, 0, dragged);
      setChipOrder((prev) => {
        const next = { ...prev, [orderKey]: list };
        try {
          localStorage.setItem(CHIP_ORDER_LS_KEY, JSON.stringify(next));
        } catch {
          // localStorage unavailable — order still applies for this session
        }
        return next;
      });
    }
    setReorderTarget(null);
    endDrag();
  };

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const moveMutation = useSaveWbBooking({
    mutation: {
      onError: (err) => {
        toast({
          title: "Failed to reschedule",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  const endDrag = () => {
    dragJobRef.current = null;
    dragBlockRef.current = null;
    dragPlaceholderRef.current = null;
    dragSourceCellRef.current = null;
    setDraggingId(null);
    setDraggingBlockId(null);
    setDraggingPlaceholderId(null);
    setDragOverCell(null);
    setReorderTarget(null);
  };

  // Stage a booking write-back when a tile is dropped onto a different
  // technician row and/or day column. The booking keeps its time-of-day and
  // duration; only the date (shifted by the column delta) and technician change.
  const handleDropOnCell = (
    targetTechId: string,
    targetDayIndex: number,
    targetTechName?: string | null,
  ) => {
    const dragged = dragJobRef.current;
    // Compute the conflict cue before endDrag() clears the drag ref.
    const conflict = dropWouldConflict(targetTechId, targetDayIndex);
    endDrag();
    if (!dragged) return;
    const { job, sourceTechId } = dragged;

    // Pure decision: delta computation, no-op detection, conflict gating, and
    // the write-back payload all live in planDrop so they can be unit-tested.
    const decision = planDrop(job, sourceTechId, targetTechId, targetDayIndex, conflict);
    if (decision.action === "noop") return;

    // Dropping onto a slot that already has an overlapping booking would
    // double-book the technician — confirm before staging the write-back.
    if (decision.requiresConfirmation) {
      const who = targetTechName?.trim() || "this technician";
      const what = job.work_order_number ?? "this booking";
      const ok = window.confirm(
        `Scheduling ${what} here overlaps an existing booking for ${who} on this day. This will double-book the technician.\n\nReschedule anyway?`,
      );
      if (!ok) return;
    }

    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: getListWbWorkOrdersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetWbScheduleBoardQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetWbResourceUtilizationQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetWbUnscheduledJobsQueryKey() });
    };
    moveMutation.mutate(
      {
        bookingId: decision.bookingId,
        data: decision.update,
      },
      {
        onSuccess: () => {
          handleSaveSuccess(decision.bookingId);
          invalidateAll();
          [5_000, 12_000, 20_000].forEach((ms) => setTimeout(invalidateAll, ms));
          toast({
            title: "Saved to CRM",
            description: `${job.work_order_number ?? "Booking"} rescheduled in Dynamics.`,
          });
        },
      },
    );
  };

  // True whenever the board is showing a single-tech focused stacked view —
  // either via explicit click-to-focus or checkbox narrowed to exactly 1 tech.
  // Declared here (before apiView and dayCount) because both depend on it.
  const isSingleTechFocused =
    focusedTechId !== null ||
    (view === "tech" && selectedTechIds !== null && selectedTechIds.size === 1);

  // Tech view uses "stacked" (12 weeks) when focused on a single tech, "month" otherwise.
  const apiView: "week" | "month" | "stacked" =
    view === "week" ? "week" : isSingleTechFocused ? "stacked" : "month";
  const { data, isLoading, error } = useGetWbScheduleBoard({
    start,
    view: apiView,
    ...(groupBy === "service-location" ? { groupBy: "service-location" } : {}),
  });

  const { data: unscheduledData } = useGetWbUnscheduledJobs();
  const unscheduledJobs = unscheduledData?.jobs ?? [];

  // Collect all CRM booking IDs visible on the board, then batch-fetch local notes.
  const allBoardBookingIds = useMemo(() => {
    if (!data) return [];
    const ids: string[] = [];
    for (const rg of data.regions ?? []) {
      for (const tech of rg.technicians ?? []) {
        for (const job of tech.jobs ?? []) {
          if (job.booking_id) ids.push(job.booking_id);
        }
      }
    }
    return ids;
  }, [data]);

  const notesQueryParams = useMemo(
    () => ({ bookingIds: allBoardBookingIds.join(",") }),
    [allBoardBookingIds],
  );
  const { data: notesData } = useListWbBookingNotes(notesQueryParams, {
    query: {
      queryKey: getListWbBookingNotesQueryKey(notesQueryParams),
      enabled: allBoardBookingIds.length > 0,
      staleTime: 30_000,
    },
  });
  const notesByBookingId = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notesData ?? []) {
      if (n.booking_id && n.note) map.set(n.booking_id, n.note);
    }
    return map;
  }, [notesData]);

  const rangeStartForBlocks = data?.range_start ?? start;
  const endDateForBlocks = useMemo(
    () => addDaysISO(rangeStartForBlocks, data?.day_count ?? 7),
    [rangeStartForBlocks, data?.day_count],
  );
  const { data: blocksData, refetch: refetchBlocks } = useListWbScheduleBlocks({
    start_date: rangeStartForBlocks,
    end_date: endDateForBlocks,
  });
  const blocks: ScheduleBlock[] = blocksData ?? [];

  const deleteBlockMutation = useDeleteWbScheduleBlock({
    mutation: {
      onSuccess: () => {
        void refetchBlocks();
        toast({ title: "Block removed" });
      },
      onError: () => {
        toast({ title: "Failed to remove block", variant: "destructive" });
      },
    },
  });

  const dragBlockMutation = useUpdateWbScheduleBlock({
    mutation: {
      onSuccess: () => {
        void refetchBlocks();
      },
      onError: (err) => {
        toast({
          title: "Failed to update block",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  // Whole days between two YYYY-MM-DD dates (b − a), sign included.
  const dayDelta = (a: string, b: string) =>
    Math.round(
      (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
    );

  const shiftIsoByDays = (iso: string, days: number) =>
    new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

  // Handle a block-chip drop on a day cell. "move" keeps the block's length and
  // time-of-day, shifting its dates by the day delta and reassigning the tech;
  // "resize" makes the target day the block's new end day (same end time-of-day).
  const handleBlockDropOnCell = (targetTechId: string, targetDateIso: string) => {
    const dragged = dragBlockRef.current;
    endDrag();
    if (!dragged) return;
    const { block, mode } = dragged;

    if (mode === "move") {
      const delta = dayDelta(block.start_time.slice(0, 10), targetDateIso);
      const techChanged = targetTechId !== block.technician_id;
      if (delta === 0 && !techChanged) return;
      dragBlockMutation.mutate(
        {
          id: block.id,
          data: {
            ...(techChanged ? { technician_id: targetTechId } : {}),
            ...(delta !== 0
              ? {
                  start_time: shiftIsoByDays(block.start_time, delta),
                  end_time: shiftIsoByDays(block.end_time, delta),
                }
              : {}),
          },
        },
        { onSuccess: () => toast({ title: "Block moved" }) },
      );
    } else {
      const delta = dayDelta(effectiveEndDay(block.end_time), targetDateIso);
      if (delta === 0) return;
      const newEnd = shiftIsoByDays(block.end_time, delta);
      if (newEnd <= block.start_time) {
        toast({
          title: "Can't shrink block",
          description: "The end of the block must stay after its start.",
          variant: "destructive",
        });
        return;
      }
      dragBlockMutation.mutate(
        { id: block.id, data: { end_time: newEnd } },
        { onSuccess: () => toast({ title: "Block resized" }) },
      );
    }
  };

  const blocksByTechAndDate = useMemo(() => {
    const map = new Map<string, ScheduleBlock[]>();
    for (const block of blocks) {
      const startDate = block.start_time.slice(0, 10);
      const endDate = effectiveEndDay(block.end_time);
      // Expand multi-day blocks onto every day they span (capped at 62 days as a guard).
      let date = startDate;
      let guard = 0;
      do {
        const key = `${block.technician_id}::${date}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(block);
        date = addDaysISO(date, 1);
        guard += 1;
      } while (date <= endDate && guard < 62);
    }
    return map;
  }, [blocks]);

  const blocksForCell = (techId: string, iso: string) =>
    blocksByTechAndDate.get(`${techId}::${iso}`) ?? [];

  const { data: placeholderJobsData, refetch: refetchPlaceholderJobs } = useListWbPlaceholderJobs({
    start_date: rangeStartForBlocks,
    end_date: endDateForBlocks,
  });
  const placeholderJobs: PlaceholderJob[] = placeholderJobsData ?? [];

  const deletePlaceholderMutation = useDeleteWbPlaceholderJob({
    mutation: {
      onSuccess: () => {
        void refetchPlaceholderJobs();
        toast({ title: "Placeholder job removed" });
      },
      onError: () => {
        toast({ title: "Failed to remove placeholder job", variant: "destructive" });
      },
    },
  });

  const dragPlaceholderMutation = useUpdateWbPlaceholderJob({
    mutation: {
      onSuccess: () => {
        void refetchPlaceholderJobs();
      },
      onError: (err) => {
        toast({
          title: "Failed to update placeholder job",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      },
    },
  });

  // Handle a placeholder-job-chip drop on a day cell. Mirrors
  // handleBlockDropOnCell: "move" keeps the job's length and time-of-day,
  // shifting its dates by the day delta and reassigning the tech; "resize"
  // makes the target day the job's new end day (same end time-of-day).
  const handlePlaceholderDropOnCell = (targetTechId: string, targetDateIso: string) => {
    const dragged = dragPlaceholderRef.current;
    endDrag();
    if (!dragged) return;
    const { job, mode } = dragged;

    if (mode === "move") {
      const delta = dayDelta(job.start_time.slice(0, 10), targetDateIso);
      const techChanged = targetTechId !== job.technician_id;
      if (delta === 0 && !techChanged) return;
      dragPlaceholderMutation.mutate(
        {
          id: job.id,
          data: {
            ...(techChanged ? { technician_id: targetTechId } : {}),
            ...(delta !== 0
              ? {
                  start_time: shiftIsoByDays(job.start_time, delta),
                  end_time: shiftIsoByDays(job.end_time, delta),
                }
              : {}),
          },
        },
        { onSuccess: () => toast({ title: "Placeholder job moved" }) },
      );
    } else {
      const delta = dayDelta(effectiveEndDay(job.end_time), targetDateIso);
      if (delta === 0) return;
      const newEnd = shiftIsoByDays(job.end_time, delta);
      if (newEnd <= job.start_time) {
        toast({
          title: "Can't shrink placeholder job",
          description: "The end of the job must stay after its start.",
          variant: "destructive",
        });
        return;
      }
      dragPlaceholderMutation.mutate(
        { id: job.id, data: { end_time: newEnd } },
        { onSuccess: () => toast({ title: "Placeholder job resized" }) },
      );
    }
  };

  const placeholderJobsByTechAndDate = useMemo(() => {
    const map = new Map<string, PlaceholderJob[]>();
    for (const job of placeholderJobs) {
      const startDate = job.start_time.slice(0, 10);
      const endDate = effectiveEndDay(job.end_time);
      // Expand multi-day placeholder jobs onto every day they span (capped at 62 days).
      let date = startDate;
      let guard = 0;
      do {
        const key = `${job.technician_id}::${date}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(job);
        date = addDaysISO(date, 1);
        guard += 1;
      } while (date <= endDate && guard < 62);
    }
    return map;
  }, [placeholderJobs]);

  const placeholderJobsForCell = (techId: string, iso: string) =>
    placeholderJobsByTechAndDate.get(`${techId}::${iso}`) ?? [];

  // Resource utilization — shares start date + view with the board
  const utilView = view === "week" ? "week" : "month";
  const { data: utilData, isLoading: utilLoading } = useGetWbResourceUtilization({
    start,
    view: utilView,
  });

  const dayCount = data?.day_count ?? (view === "week" ? 7 : isSingleTechFocused ? 84 : 30);
  const rangeStart = data?.range_start ?? start;

  const dayHeaders = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const iso = addDaysISO(rangeStart, i);
        return { iso, ...fmtDayHeader(iso, view) };
      }),
    [rangeStart, dayCount, view],
  );

  // The board always shows the full technician roster, including idle
  // technicians with no jobs in the current range, so coordinators can see
  // capacity at a glance without an extra toggle.
  const allRegions = useMemo(() => data?.regions ?? [], [data]);
  const regionDefaultAppliedFor = useRef<string | null>(null);

  // Apply CRM territory-manager defaults once after authentication and the
  // matching user's board response are both available. `null` means all
  // regions, so users who are not managers of R1-R5 retain the existing
  // all-regions default. The ref prevents background refetches from overriding
  // a user's manual filter changes.
  useEffect(() => {
    const authUser = user;
    const email = authUser?.email?.trim().toLocaleLowerCase();
    if (!authUser || !email) {
      regionDefaultAppliedFor.current = null;
      return;
    }
    if (allRegions.length === 0) return;
    const responseViewerEmail = data?.viewer_email?.trim().toLocaleLowerCase();
    if (responseViewerEmail !== email) return;

    const userKey = `${authUser.entraOid}:${email}`;
    if (regionDefaultAppliedFor.current === userKey) return;
    regionDefaultAppliedFor.current = userKey;

    const defaultRegionNames = new Set(
      (data?.coordinator_default?.region_names ?? []).map((region) =>
        region.trim().toLocaleUpperCase(),
      ),
    );
    if (defaultRegionNames.size === 0) {
      setSelectedRegions(null);
      return;
    }

    const defaultRegionIds = allRegions
      .filter((region) => defaultRegionNames.has(region.region.trim().toLocaleUpperCase()))
      .map((region) => region.regionid_id);

    setSelectedRegions(defaultRegionIds.length > 0 ? new Set(defaultRegionIds) : null);
  }, [allRegions, data?.coordinator_default, data?.viewer_email, user]);

  const regions = useMemo(
    () => {
      const sortTechnicians = (region: (typeof allRegions)[number]) => {
        const regionOrder = REGION_TECHNICIAN_ORDER[region.region.toLocaleUpperCase()];
        if (!regionOrder) return region;
        const technicianOrder = new Map(
          regionOrder.map((name, index) => [name.toLocaleLowerCase(), index]),
        );

        return {
          ...region,
          technicians: [...region.technicians].sort((a, b) => {
            const aName = (a.resource_name ?? "").toLocaleLowerCase();
            const bName = (b.resource_name ?? "").toLocaleLowerCase();
            const aOrder = technicianOrder.get(aName);
            const bOrder = technicianOrder.get(bName);

            if (aOrder !== undefined && bOrder !== undefined) {
              return aOrder - bOrder;
            }
            if (aOrder !== undefined) return -1;
            if (bOrder !== undefined) return 1;
            return 0;
          }),
        };
      };

      const visibleRegions =
        selectedRegions === null
          ? allRegions
          : allRegions.filter((r) => selectedRegions.has(r.regionid_id));

      return visibleRegions.map(sortTechnicians);
    },
    [allRegions, selectedRegions],
  );

  const technicianHomeRegionById = useMemo(() => {
    const map = new Map<string, string>();
    for (const region of utilData?.regions ?? []) {
      for (const technician of region.technicians ?? []) {
        map.set(technician.technician_id, region.region);
      }
    }
    return map;
  }, [utilData]);

  // Service Location rows contain only jobs performed in that location. Keep a
  // cross-location lookup so each day cell can still show when the technician
  // has a CRM booking in another location group.
  const serviceLocationBookingsByTechAndDay = useMemo(() => {
    const map = new Map<string, CrossLocationBooking[]>();
    if (groupBy !== "service-location" || !data) return map;

    for (const region of data.regions ?? []) {
      for (const technician of region.technicians ?? []) {
        for (const job of technician.jobs as ScheduleJob[]) {
          if (!Number.isInteger(job.day_index) || !job.booking_id) continue;
          const key = `${technician.technician_id}:${job.day_index}`;
          const bookings = map.get(key) ?? [];
          bookings.push({
            locationId: region.regionid_id,
            locationName: region.region,
            homeRegionName: technicianHomeRegionById.get(technician.technician_id) ?? null,
            job,
          });
          map.set(key, bookings);
        }
      }
    }

    return map;
  }, [data, groupBy, technicianHomeRegionById]);

  const totalJobs = regions.reduce(
    (s, r) => s + r.technicians.reduce((ts, t) => ts + distinctJobCount(t.jobs), 0),
    0,
  );

  // Per-technician capacity (minutes) for the active range, sourced from the
  // resource-utilization endpoint. Used to surface an idle tech's available
  // capacity at a glance when capacity planning ("show idle techs") is on.
  const techCapMinutesById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of utilData?.regions ?? []) {
      for (const t of r.technicians ?? []) {
        m.set(t.technician_id, t.capacity_minutes ?? 0);
      }
    }
    return m;
  }, [utilData]);

  // Per-technician minutes already booked in the active range, sourced from the
  // same resource-utilization endpoint. Used to surface remaining capacity on
  // busy technician rows ("24 of 40h booked"), not just idle ones.
  const techUtilMinutesById = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of utilData?.regions ?? []) {
      for (const t of r.technicians ?? []) {
        m.set(t.technician_id, t.utilized_minutes ?? 0);
      }
    }
    return m;
  }, [utilData]);

  // Fallback capacity when a tech isn't present in the utilization payload.
  const defaultCapMinutes = useMemo(() => {
    const weeklyHours = utilData?.default_weekly_capacity_hours ?? 40;
    const periodWeeks = utilData?.period_weeks ?? (view === "week" ? 1 : 4);
    return Math.round(weeklyHours * periodWeeks * 60);
  }, [utilData, view]);

  const idleCapMinutes = (technicianId: string) =>
    techCapMinutesById.get(technicianId) ?? defaultCapMinutes;

  const activeSearch = searchQuery.trim().toLowerCase();

  // technician_id → resource_name map, built from board data for client-side matching.
  const techNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.regions ?? []) {
      for (const t of r.technicians ?? []) {
        if (t.technician_id && t.resource_name) m.set(t.technician_id, t.resource_name);
      }
    }
    return m;
  }, [data]);

  // Count of distinct jobs visible on the board that match the current search.
  const searchMatchCount = useMemo(() => {
    if (!activeSearch) return 0;
    const scheduledCount = (data?.regions ?? [])
      .flatMap((r) => r.technicians ?? [])
      .flatMap((t) => t.jobs ?? [])
      .filter((j) => jobMatchesSearch(j as ScheduleJob, activeSearch)).length;
    const placeholderCount = placeholderJobs.filter((j) =>
      placeholderJobMatchesSearch(
        j,
        activeSearch,
        j.technician_id ? techNameById.get(j.technician_id) : null,
      ),
    ).length;
    return scheduledCount + placeholderCount;
  }, [activeSearch, data, placeholderJobs, techNameById]);

  // Debounced query for the server-side all-future-dates search (400 ms delay,
  // min 2 chars so we don't hammer the server on every keystroke).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // Whether the results panel is open. Set false on result click so the panel
  // closes while keeping the search query (and board highlighting) active.
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  useEffect(() => {
    const raw = searchQuery.trim();
    if (raw.length < 2) {
      setDebouncedSearch("");
      setSearchPanelOpen(false);
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(raw);
      setSearchPanelOpen(true);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data: globalSearchResults, isFetching: globalSearchFetching } = useSearchWbJobs(
    { q: debouncedSearch },
    {
      query: {
        queryKey: getSearchWbJobsQueryKey({ q: debouncedSearch }),
        enabled: debouncedSearch.length >= 2,
        staleTime: 30_000,
      },
    },
  );

  // Scroll highlighted unscheduled card into view whenever the ID changes.
  // The 200 ms delay gives React time to re-render visibleUnscheduledJobs (which
  // now always includes the highlighted job) before the DOM query runs.
  useEffect(() => {
    if (!highlightedUnscheduledId) return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-testid="unscheduled-card-${highlightedUnscheduledId}"]`,
      );
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 200);
    return () => clearTimeout(timer);
  }, [highlightedUnscheduledId]);

  // Minutes from the CRM (work orders only).
  const techUtilMinutes = (technicianId: string) =>
    techUtilMinutesById.get(technicianId) ?? 0;

  // Per-technician Travel Time + PTO block minutes, summed across the whole range.
  // Split block minutes by explicit type so Custom blocks can be excluded
  // from utilization (they are visual annotations, not booked time).
  const blockMinutesByTech = useMemo(() => {
    const m = new Map<string, { driveTime: number; pto: number; custom: number }>();
    for (const block of blocks) {
      const dur = Math.max(
        0,
        Math.round(
          (new Date(block.end_time).getTime() - new Date(block.start_time).getTime()) / 60000,
        ),
      );
      const cur = m.get(block.technician_id) ?? { driveTime: 0, pto: 0, custom: 0 };
      if (block.block_type === "drive_time") cur.driveTime += dur;
      else if (block.block_type === "pto") cur.pto += dur;
      else cur.custom += dur;
      m.set(block.technician_id, { ...cur });
    }
    return m;
  }, [blocks]);

  const techBlockMinutes = (technicianId: string) =>
    blockMinutesByTech.get(technicianId) ?? { driveTime: 0, pto: 0, custom: 0 };

  // Potential (placeholder) job minutes per technician, as reported by the
  // utilization endpoint. The endpoint already folds these into
  // utilized_minutes, so they must NOT be re-added client-side — this value is
  // only used to break the total down (Jobs vs Potential) in the UI.
  const placeholderMinutesByTech = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of utilData?.regions ?? []) {
      for (const t of r.technicians ?? []) {
        m.set(t.technician_id, t.placeholder_minutes ?? 0);
      }
    }
    return m;
  }, [utilData]);

  const techPlaceholderMinutes = (technicianId: string) =>
    placeholderMinutesByTech.get(technicianId) ?? 0;

  // Total utilization = utilized_minutes (CRM jobs + Potential Jobs, summed
  // server-side) + Travel Time + PTO. Custom blocks are deliberately excluded.
  const techTotalUtilMinutes = (technicianId: string) => {
    const { driveTime, pto } = techBlockMinutes(technicianId);
    return techUtilMinutes(technicianId) + driveTime + pto;
  };

  // Map selected regionid_ids → region name strings for unscheduled job filtering
  const activeRegionNames = useMemo(() => {
    if (selectedRegions === null) return null;
    return new Set(
      allRegions.filter((r) => selectedRegions.has(r.regionid_id)).map((r) => r.region),
    );
  }, [allRegions, selectedRegions]);

  // Unscheduled jobs are filtered by the active region only. Date-based grouping
  // remains visible below, but managers should be able to see every unscheduled
  // job in a selected region regardless of its due date.
  // Exception: the currently highlighted job (from a search result click) is always
  // included regardless of region so the target card is in the DOM to scroll to.
  const visibleUnscheduledJobs = useMemo(() => {
    return unscheduledJobs.filter((j) => {
      // Always include the search-highlighted job so its card is scrollable.
      if (
        highlightedUnscheduledId !== null &&
        (j.work_order_id === highlightedUnscheduledId ||
          j.work_order_number === highlightedUnscheduledId)
      )
        return true;
      if (activeRegionNames !== null && (j.region == null || !activeRegionNames.has(j.region)))
        return false;
      return true;
    });
  }, [unscheduledJobs, activeRegionNames, highlightedUnscheduledId]);

  // Detect double-booked jobs: same tech, same day, overlapping time windows.
  const conflictedBookingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of allRegions) {
      for (const t of r.technicians) {
        const jobs = (t.jobs ?? []) as ScheduleJob[];
        for (const id of conflictedIdsForTech(jobs)) ids.add(id);
      }
    }
    return ids;
  }, [allRegions]);

  // Lookup of every technician's bookings, keyed by technician id, for fast
  // conflict checks while dragging a tile over candidate drop cells.
  const jobsByTechId = useMemo(() => {
    const m = new Map<string, ScheduleJob[]>();
    for (const r of allRegions) {
      for (const t of r.technicians) {
        const existing = m.get(t.technician_id) ?? [];
        existing.push(...((t.jobs ?? []) as ScheduleJob[]));
        m.set(t.technician_id, existing);
      }
    }
    return m;
  }, [allRegions]);

  // Would dropping the currently dragged tile onto this cell overlap an existing
  // booking for the target technician on that day? The move preserves the
  // booking's time-of-day, so we compare its time window against the target
  // cell's bookings. Returns false for no-op drops and when nothing is dragging.
  const dropWouldConflict = (targetTechId: string, targetDayIndex: number): boolean => {
    const dragged = dragJobRef.current;
    if (!dragged) return false;
    const { job, sourceTechId } = dragged;
    return wouldDropConflict(
      job,
      sourceTechId,
      targetTechId,
      targetDayIndex,
      jobsByTechId.get(targetTechId) ?? [],
    );
  };

  const toggleRegion = (id: string) => {
    setSelectedRegions((prev) => {
      const current = prev ?? new Set(allRegions.map((r) => r.regionid_id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === allRegions.length) return null;
      return next;
    });
  };
  const selectAllRegions = () => {
    setSelectedRegions(null);
    setSelectedTechIds(null);
    setFocusedTechId(null);
  };
  const clearRegions = () => setSelectedRegions(new Set());
  const isRegionSelected = (id: string) => selectedRegions === null || selectedRegions.has(id);

  // Stacked view pages 13 weeks (91 days) at a time — half the 26-week window —
  // so paging always shows some overlap with the previous period.
  const goPrev = () =>
    setStart(
      view === "week" ? addDaysISO(start, -7) :
      isSingleTechFocused ? addDaysISO(start, -91) :
      addMonthsISO(start, -1),
    );
  const goNext = () =>
    setStart(
      view === "week" ? addDaysISO(start, 7) :
      isSingleTechFocused ? addDaysISO(start, 91) :
      addMonthsISO(start, 1),
    );
  // In stacked mode: reset the view to the first week of the current month and
  // clear the scroll flag so the auto-scroll fires again to bring today into view.
  const goToday = () => {
    if (isSingleTechFocused) {
      setStart(startOfWeekISO(new Date(startOfMonthISO(new Date()))));
      hasScrolledToTodayRef.current = false;
    } else {
      setStart(
        view === "week" ? startOfWeekISO(new Date()) : startOfMonthISO(new Date()),
      );
    }
  };

  const jumpToNextQuarter = () => {
    const quarterStart = nextQuarterStartISO(start);
    setStart(
      view === "week" || isSingleTechFocused
        ? startOfWeekISO(new Date(`${quarterStart}T00:00:00Z`))
        : startOfMonthISO(new Date(`${quarterStart}T00:00:00Z`)),
    );
  };

  const jumpToNextYear = () => {
    const nextYearDate = addYearsISO(start, 1);
    setStart(
      view === "week" || isSingleTechFocused
        ? startOfWeekISO(new Date(`${nextYearDate}T00:00:00Z`))
        : startOfMonthISO(new Date(`${nextYearDate}T00:00:00Z`)),
    );
  };

  const onChangeView = (next: ViewMode) => {
    if (next === view) return;
    const seed = new Date(start + "T00:00:00Z");
    setStart(next === "week" ? startOfWeekISO(seed) : startOfMonthISO(seed));
    setView(next);
    setFocusedTechId(null);
  };

  // Enter the single-tech stacked-weeks view for a specific technician.
  const focusTech = (techId: string) => {
    setFocusedTechId(techId);
    if (view !== "tech") {
      // Always anchor to the Monday of the first week of the current month so
      // the stacked grid includes any prior-month boundary days (e.g. June 29-30
      // when July starts on Wednesday). Today's week is reached via auto-scroll.
      setStart(startOfWeekISO(new Date(startOfMonthISO(new Date()))));
      hasScrolledToTodayRef.current = false;
      setView("tech");
    }
  };

  // Exit focused mode and return to the week swimlane.
  const unfocusTech = () => {
    setFocusedTechId(null);
    const seed = new Date(start + "T00:00:00Z");
    setStart(startOfWeekISO(seed));
    setView("week");
  };

  // ---- Calendar Report tech list (includes user_email for email delivery) ----
  const calendarReportTechs = useMemo<CalendarReportTech[]>(() => {
    const m = new Map<string, CalendarReportTech>();
    // Use the same filtered regions and technician selection as the board.
    // `regions` already applies the Region Filters; apply the Technician
    // Filters here as well so the report opens with exactly the visible roster.
    for (const r of regions) {
      for (const t of r.technicians as Array<{ technician_id: string; resource_name?: string | null; user_email?: string | null }>) {
        if (selectedTechIds !== null && !selectedTechIds.has(t.technician_id)) {
          continue;
        }
        if (t.technician_id && !m.has(t.technician_id)) {
          m.set(t.technician_id, {
            id: t.technician_id,
            name: t.resource_name ?? "Unassigned",
            email: t.user_email ?? null,
          });
        }
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [regions, selectedTechIds]);

  // ---- Per-Tech (printable) view derivations ----
  const allTechs = useMemo(() => {
    const m = new Map<string, { id: string; name: string; region: string; jobs: ScheduleJob[] }>();
    for (const r of regions) {
      for (const t of r.technicians) {
        if (!m.has(t.technician_id)) {
          m.set(t.technician_id, {
            id: t.technician_id,
            name: t.resource_name ?? "Unassigned",
            region: r.region,
            jobs: (t.jobs ?? []) as ScheduleJob[],
          });
        }
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [regions]);

  const techsToPrint = useMemo(
    () =>
      selectedTechIds === null ? allTechs : allTechs.filter((t) => selectedTechIds.has(t.id)),
    [allTechs, selectedTechIds],
  );

  const toggleTech = (id: string) => {
    setSelectedTechIds((prev) => {
      const current = prev ?? new Set(allTechs.map((t) => t.id));
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === allTechs.length) return null;
      return next;
    });
  };
  const selectAllTechs = () => setSelectedTechIds(null);
  const clearTechs = () => setSelectedTechIds(new Set());
  const isTechSelected = (id: string) => selectedTechIds === null || selectedTechIds.has(id);

  // Show the stacked-weeks layout when exactly 1 tech is focused explicitly (clicking their
  // name in the swimlane) OR when in tech view with exactly 1 tech checked in the picker.
  const effectiveFocusedTechId: string | null =
    focusedTechId ??
    (view === "tech" && selectedTechIds !== null && selectedTechIds.size === 1
      ? [...selectedTechIds][0]
      : null);

  const focusedTechData = useMemo(() => {
    if (!effectiveFocusedTechId) return null;
    for (const rg of regions) {
      const t = rg.technicians.find((t) => t.technician_id === effectiveFocusedTechId);
      if (t) return { tech: t, region: rg.region };
    }
    return null;
  }, [effectiveFocusedTechId, regions]);

  // Stacked-weeks grid: group dayHeaders into Mon–Sun blocks for the focused single-tech view.
  const stackedWeeks = useMemo(() => {
    if (!effectiveFocusedTechId) return [];
    const groups: Array<{ mondayISO: string; days: typeof dayHeaders }> = [];
    let current: typeof dayHeaders = [];
    let mondayISO = "";
    for (const dh of dayHeaders) {
      const dow = new Date(dh.iso + "T00:00:00Z").getUTCDay();
      if (dow === 1 && current.length > 0) {
        groups.push({ mondayISO, days: current });
        current = [];
      }
      if (current.length === 0) mondayISO = dh.iso;
      current.push(dh);
    }
    if (current.length > 0) groups.push({ mondayISO, days: current });
    return groups;
  }, [effectiveFocusedTechId, dayHeaders]);

  const stackedColUTCDays = showWeekends ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5];
  const stackedColNames = showWeekends
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const stackedColMinWidth = 160 + stackedColNames.length * 160;
  const stackedColTemplate = `160px repeat(${stackedColNames.length}, minmax(160px, 1fr))`;

  // Drop selected tech ids that no longer exist after region/month change.
  // Guard allTechs.length === 0: data is transiently empty while a new week/month
  // fetch is in flight (no placeholderData on the query), so we must not treat a
  // temporarily empty roster as "all IDs are invalid" and wipe the filter.
  useEffect(() => {
    if (selectedTechIds === null || allTechs.length === 0) return;
    const validIds = new Set(allTechs.map((t) => t.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of selectedTechIds) {
      if (validIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) {
      setSelectedTechIds(next.size === allTechs.length ? null : next);
    }
  }, [allTechs, selectedTechIds]);

  // Exit explicit focused mode when the picker is used to select 2+ technicians.
  // selectedTechIds === null means "All" which is the default/reset state and
  // must NOT clear an explicit row-click focus (that stays until the back button).
  useEffect(() => {
    if (focusedTechId === null) return;
    if (selectedTechIds !== null && selectedTechIds.size !== 1) {
      setFocusedTechId(null);
    }
  }, [focusedTechId, selectedTechIds]);

  // Monday ISO of the current calendar week — used to identify today's row.
  const todayWeekMonday = startOfWeekISO(new Date());

  // Refs for the scrollable stacked calendar.
  // hasScrolledToTodayRef is reset to false in focusTech (on stacked entry) and
  // in goToday (stacked mode) so the auto-scroll useEffect below fires each time.
  const hasScrolledToTodayRef = useRef(false);
  const todayStackedRowRef = useRef<HTMLDivElement | null>(null);

  // Scroll to today's week row the first time the stacked grid is populated.
  // Uses a short delay so the DOM is fully painted before scrollIntoView fires.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (
      effectiveFocusedTechId !== null &&
      stackedWeeks.length > 0 &&
      !hasScrolledToTodayRef.current
    ) {
      hasScrolledToTodayRef.current = true;
      timer = setTimeout(() => {
        todayStackedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [effectiveFocusedTechId, stackedWeeks.length]);

  // Headers for Week and Calendar views — Mon–Fri by default, all 7 days when
  // showWeekends is on. Keep dayIdx tied to the full API range so drag/drop
  // continues to address the correct underlying day when weekends are hidden.
  const weekdayHeaders = useMemo(
    () =>
      dayHeaders
        .map((dh, i) => ({ ...dh, dayIdx: i }))
        .filter(({ iso }) => {
          if (showWeekends) return true;
          const dow = new Date(iso + "T00:00:00Z").getUTCDay();
          return dow >= 1 && dow <= 5;
        })
        .map((dh) => ({
          ...dh,
          isMonday: new Date(dh.iso + "T00:00:00Z").getUTCDay() === 1,
        })),
    [dayHeaders, showWeekends],
  );
  const weekDayHeaders = weekdayHeaders;

  const dayColTemplate =
    view === "week"
      ? `180px repeat(${weekDayHeaders.length}, minmax(0, 1fr))`
      : `180px repeat(${dayCount}, minmax(80px, 1fr))`;
  const minBoardWidth = view === "week" ? 1000 : 180 + dayCount * 80;

  const techCalColTemplate = `160px repeat(${weekdayHeaders.length}, minmax(140px, 1fr))`;
  const minTechCalWidth = 160 + weekdayHeaders.length * 140;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule Board</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Live from the d365crm database, grouped by region and technician. Click a job tile to edit, or drag it to another day or technician to reschedule.
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={goPrev}
            data-testid="btn-prev"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <DateJumpPicker
            value={rangeStart}
            mode={effectiveFocusedTechId !== null ? "week" : view === "week" ? "week" : "month"}
            onSelect={(iso) => setStart(iso)}
          >
            <div
              className="text-base font-semibold tabular-nums px-2 min-w-[200px] text-center hover:bg-accent rounded transition-colors"
              data-testid="text-range"
              title="Click to jump to a date"
            >
              {effectiveFocusedTechId !== null && focusedTechData ? (
                <>
                  <span className="text-sm font-normal text-muted-foreground">
                    {focusedTechData.tech.resource_name}
                    {" · "}
                  </span>
                  {fmtRangeLabel(rangeStart, dayCount, "week")}
                </>
              ) : (
                fmtRangeLabel(rangeStart, dayCount, view)
              )}
            </div>
          </DateJumpPicker>
          <Button
            variant="outline"
            size="icon"
            onClick={goNext}
            data-testid="btn-next"
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent"
            onClick={goToday}
            data-testid="btn-today"
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent"
            onClick={jumpToNextQuarter}
            data-testid="btn-next-quarter"
            aria-label="Jump to next quarter"
          >
            Next quarter
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent"
            onClick={jumpToNextYear}
            data-testid="btn-next-year"
            aria-label="Jump to next year"
          >
            Next year
          </Button>
        </div>

        {/* View toggle + grouping toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="inline-flex rounded-md border-2 border-foreground/30 bg-card overflow-hidden shadow-sm"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "week"}
              onClick={() => onChangeView("week")}
              data-testid="btn-view-week"
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "week"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              Week
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "tech"}
              onClick={() => onChangeView("tech")}
              data-testid="btn-view-tech"
              className={`px-3 py-1.5 text-sm font-medium border-l-2 border-foreground/30 transition-colors ${
                view === "tech"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              Calendar
            </button>
          </div>

          {/* Grouping mode toggle */}
          <div
            className="inline-flex rounded-md border-2 border-foreground/30 bg-card overflow-hidden shadow-sm"
            role="group"
            aria-label="Group by"
            data-testid="group-by-toggle"
          >
            <button
              type="button"
              aria-pressed={groupBy === "tech-region"}
              onClick={() => setGroupBy("tech-region")}
              data-testid="btn-group-tech-region"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                groupBy === "tech-region"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              By Tech Region
            </button>
            <button
              type="button"
              aria-pressed={groupBy === "service-location"}
              onClick={() => setGroupBy("service-location")}
              data-testid="btn-group-service-location"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border-l-2 border-foreground/30 transition-colors ${
                groupBy === "service-location"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              <MapPin className="h-3.5 w-3.5" />
              By Service Location
            </button>
          </div>
          {isEditor && !isLoading && data && calendarReportTechs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCalendarReport(true)}
              data-testid="btn-calendar-report"
              className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              Calendar Report
            </Button>
          )}
        </div>
      </div>

      {/* Region filter + capacity-planning toggle */}
      {!isLoading && data && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="region-filter">
          {allRegions.length > 0 && (
            <>
          <span className="text-xs font-bold uppercase tracking-wide text-foreground mr-1">
            Filter regions:
          </span>
          {allRegions.map((rg) => {
            const active = isRegionSelected(rg.regionid_id);
            return (
              <button
                key={rg.regionid_id}
                type="button"
                onClick={() => toggleRegion(rg.regionid_id)}
                aria-pressed={active}
                data-testid={`filter-region-${rg.region}`}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                {rg.region}
                {rg.company && <span className="ml-1 opacity-70">({rg.company})</span>}
              </button>
            );
          })}
          <div className="ml-1 flex gap-1">
            <button
              type="button"
              onClick={selectAllRegions}
              data-testid="filter-all"
              className="text-xs font-bold px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              All
            </button>
            <span className="text-muted-foreground text-xs font-bold">|</span>
            <button
              type="button"
              onClick={clearRegions}
              data-testid="filter-none"
              className="text-xs font-bold px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              None
            </button>
          </div>
            </>
          )}
          {(view === "tech" || view === "week") && (
            <button
              type="button"
              role="switch"
              aria-checked={showWeekends}
              onClick={() => setShowWeekends((v) => !v)}
              data-testid="toggle-show-weekends"
              title="Show Saturday and Sunday columns"
              className={`ml-auto inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
                showWeekends
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-accent"
              }`}
            >
              <span
                className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${
                  showWeekends ? "bg-primary-foreground/40" : "bg-muted-foreground/30"
                }`}
                aria-hidden
              >
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
                    showWeekends ? "translate-x-3" : "translate-x-0.5"
                  }`}
                />
              </span>
              Show weekends
            </button>
          )}
        </div>
      )}

      {/* Tech filter (multi-select) — available in both Week and Calendar views */}
      {!isLoading && allTechs.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap print:hidden" data-testid="tech-filter">
          <span className="text-xs font-bold uppercase tracking-wide text-foreground mr-1 pt-1.5">
            Technicians:
          </span>
          {allTechs.map((t) => {
            const active = isTechSelected(t.id);
            const palette = regionPaletteEntry(t.region);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTech(t.id)}
                aria-pressed={active}
                data-testid={`filter-tech-${t.id}`}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors inline-flex items-center gap-1.5 ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${palette.dot}`} aria-hidden />
                {t.name}
              </button>
            );
          })}
          <div className="ml-1 flex gap-1 pt-0.5">
            <button
              type="button"
              onClick={selectAllTechs}
              data-testid="filter-tech-all"
              className="text-xs font-bold px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              All
            </button>
            <span className="text-muted-foreground text-xs font-bold">|</span>
            <button
              type="button"
              onClick={clearTechs}
              data-testid="filter-tech-none"
              className="text-xs font-bold px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              None
            </button>
          </div>
        </div>
      )}

      {/* Work Order Search */}
      {!isLoading && data && (
        <div className="flex items-center gap-2 print:hidden">
          <span className="text-xs font-bold uppercase tracking-wide text-foreground mr-1 shrink-0">
            Search:
          </span>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              placeholder="WO#, customer, city, technician…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-8 pr-7 text-xs rounded-full border-border"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); setSearchPanelOpen(false); setHighlightedUnscheduledId(null); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {/* All-future-dates results panel — visible until user clicks a result or clears the query */}
            {searchPanelOpen && (
              <div className="absolute top-full left-0 mt-1 w-full z-50 bg-background border border-border rounded-lg shadow-lg max-h-72 overflow-y-auto">
                {globalSearchFetching && (
                  <div className="p-3 text-xs text-muted-foreground">Searching all future dates…</div>
                )}
                {!globalSearchFetching && (!globalSearchResults || globalSearchResults.length === 0) && (
                  <div className="p-3 text-xs text-muted-foreground">No future jobs matched.</div>
                )}
                {!globalSearchFetching && globalSearchResults && globalSearchResults.length > 0 && (
                  <ul>
                    {globalSearchResults.map((result) => {
                      const weekStart = startOfWeekISO(new Date(result.start_date + "T00:00:00"));
                      const isUnscheduled = result.type === "unscheduled";
                      return (
                        <li key={`${result.type}:${result.id}`}>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center gap-2 text-xs border-b border-border/50 last:border-b-0"
                            onClick={() => {
                              if (isUnscheduled) {
                                setHighlightedUnscheduledId(result.id);
                                setSearchPanelOpen(false);
                              } else {
                                setStart(weekStart);
                                if (view !== "week") setView("week");
                                setSearchPanelOpen(false);
                              }
                            }}
                          >
                            <Badge
                              variant="outline"
                              className={`shrink-0 text-[10px] px-1 py-0 ${
                                result.type === "potential"
                                  ? "border-dashed text-amber-700 border-amber-400"
                                  : isUnscheduled
                                    ? "border-dashed text-rose-700 border-rose-400"
                                    : ""
                              }`}
                            >
                              {result.type === "potential"
                                ? "Potential"
                                : isUnscheduled
                                  ? "Unscheduled"
                                  : "Scheduled"}
                            </Badge>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">
                                {result.customer_name ?? result.work_order_number ?? "Unknown"}
                                {result.work_order_number && result.customer_name
                                  ? ` · ${result.work_order_number}`
                                  : ""}
                              </div>
                              <div className="text-muted-foreground truncate">
                                {[result.city, result.state].filter(Boolean).join(", ")}
                                {result.technician_name ? ` · ${result.technician_name}` : ""}
                                {isUnscheduled ? " · Unscheduled" : ""}
                              </div>
                            </div>
                            <div className="shrink-0 text-muted-foreground tabular-nums whitespace-nowrap">
                              {isUnscheduled ? `due ${result.start_date}` : result.start_date}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
          {activeSearch && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {(() => {
                const globalCount = globalSearchResults?.length ?? null;
                const hasGlobal = globalCount !== null && !globalSearchFetching && debouncedSearch.length >= 2;
                if (hasGlobal && globalCount !== null) {
                  if (searchMatchCount === 0 && globalCount === 0) return "No matches";
                  if (searchMatchCount !== globalCount) {
                    return `${searchMatchCount} in view · ${globalCount} total`;
                  }
                  return `${globalCount} job${globalCount !== 1 ? "s" : ""} matched`;
                }
                if (searchMatchCount === 0) return "No matches";
                return `${searchMatchCount} job${searchMatchCount !== 1 ? "s" : ""} matched`;
              })()}
            </span>
          )}
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      )}

      {error && (
        <div className="text-center py-20 text-destructive" data-testid="error-schedule-board">
          <AlertTriangle className="mx-auto h-10 w-10 mb-3" />
          <p className="font-medium">Failed to load schedule board.</p>
        </div>
      )}

      {view !== "tech" && !isLoading && !error && regions.length === 0 && (
        <div className="text-center py-20 text-muted-foreground" data-testid="empty-schedule">
          <CalendarClock className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">No regions configured.</p>
        </div>
      )}

      {/* Single-tech stacked-weeks calendar */}
      {view === "tech" && !isLoading && !error && effectiveFocusedTechId !== null && focusedTechData && (
        <div data-testid="focused-tech-view" className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={unfocusTech}
              data-testid="btn-all-technicians"
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              All technicians
            </Button>
            <div className="flex items-center gap-2">
              <span
                className={`h-3 w-3 rounded-full ${regionPaletteEntry(focusedTechData.region).dot}`}
                aria-hidden
              />
              <span className="text-lg font-semibold">
                {focusedTechData.tech.resource_name ?? "Technician"}
              </span>
              <Badge variant="outline" className="text-xs font-normal">
                {focusedTechData.region}
              </Badge>
            </div>
            {/* Inline date navigation — keeps controls visible while scrolling the 12-week grid */}
            <div className="flex items-center gap-1 ml-auto">
              <Button variant="outline" size="icon" onClick={goPrev} aria-label="Previous 12 weeks">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <DateJumpPicker
                value={rangeStart}
                mode="week"
                onSelect={(iso) => setStart(iso)}
              >
                <div
                  className="text-sm font-semibold tabular-nums px-2 py-1 min-w-[160px] text-center hover:bg-accent rounded transition-colors"
                  title="Click to jump to a date"
                  data-testid="text-range-focused"
                >
                  {fmtRangeLabel(rangeStart, dayCount, "week")}
                </div>
              </DateJumpPicker>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent"
                onClick={goToday}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent"
                onClick={jumpToNextQuarter}
                data-testid="btn-focused-next-quarter"
                aria-label="Jump to next quarter"
              >
                Next quarter
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-sm border-2 border-foreground/30 bg-background shadow-sm hover:bg-accent"
                onClick={jumpToNextYear}
                data-testid="btn-focused-next-year"
                aria-label="Jump to next year"
              >
                Next year
              </Button>
              <Button variant="outline" size="icon" onClick={goNext} aria-label="Next 12 weeks">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Stacked weeks grid — CardContent is the scroll container (overflow-y: auto +
              max-height) so mouse-wheel scrolls through the 26 weeks. The Card must NOT
              carry overflow-hidden or it clips the CardContent scrollbar. */}
          <Card className="border-2 border-foreground/80 shadow-sm print:shadow-none bg-white">
            <CardContent
              className="p-0 overflow-x-auto overflow-y-auto"
              style={{ maxHeight: "75vh" }}
            >
              <div style={{ minWidth: `${stackedColMinWidth}px` }}>
                {/* Column headers: "Week" + day names — sticky within CardContent scroll container */}
                <div
                  className="grid bg-white border-b-2 border-foreground/80 sticky top-0 z-10"
                  style={{ gridTemplateColumns: stackedColTemplate }}
                >
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/60 border-r border-foreground/40">
                    Week
                  </div>
                  {stackedColNames.map((name) => (
                    <div
                      key={name}
                      className="px-1.5 py-2 text-xs font-bold text-center border-r border-foreground/20 last:border-r-0"
                    >
                      {name}
                    </div>
                  ))}
                </div>

                {/* One row per week */}
                {stackedWeeks.map(({ mondayISO, days }) => {
                  const weekDayCells = stackedColUTCDays.map((targetDow) =>
                    days.find(
                      (dh) => new Date(dh.iso + "T00:00:00Z").getUTCDay() === targetDow,
                    ) ?? null,
                  );
                  const palette = regionPaletteEntry(focusedTechData.region);
                  const tech = focusedTechData.tech;
                  const lastDay = days[days.length - 1];
                  const weekStart = new Date(mondayISO + "T00:00:00Z").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  });
                  const weekEnd = new Date(lastDay.iso + "T00:00:00Z").toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: "UTC",
                  });

                  // Per-week job/block/capacity stats (mirrors the swimlane tech row header)
                  const weekIsos = new Set(days.map((d) => d.iso));
                  const weekDayIdxSet = new Set(
                    days
                      .map((d) => dayHeaders.findIndex((h) => h.iso === d.iso))
                      .filter((i) => i >= 0),
                  );
                  const weekJobs = (tech.jobs as ScheduleJob[]).filter((j) =>
                    weekDayIdxSet.has(j.day_index),
                  );
                  // Deduplicate multi-day jobs (one ScheduleJob per spanned day)
                  // before summing durations so each booking is counted once.
                  const weekJobMins = Array.from(
                    new Map(weekJobs.map((j) => [j.booking_id, j])).values(),
                  ).reduce((s, j) => {
                    if (!j.start_time || !j.end_time) return s;
                    return (
                      s +
                      Math.max(
                        0,
                        Math.round(
                          (new Date(j.end_time).getTime() -
                            new Date(j.start_time).getTime()) /
                            60000,
                        ),
                      )
                    );
                  }, 0);
                  const weekBlkMins = blocks
                    .filter(
                      (b) =>
                        b.technician_id === tech.technician_id &&
                        weekIsos.has(b.start_time.slice(0, 10)),
                    )
                    .reduce(
                      (acc, b) => {
                        const dur = Math.max(
                          0,
                          Math.round(
                            (new Date(b.end_time).getTime() -
                              new Date(b.start_time).getTime()) /
                              60000,
                          ),
                        );
                        if (b.block_type === "drive_time")
                          return { ...acc, driveTime: acc.driveTime + dur };
                        if (b.block_type === "pto") return { ...acc, pto: acc.pto + dur };
                        return { ...acc, custom: acc.custom + dur };
                      },
                      { driveTime: 0, pto: 0, custom: 0 },
                    );
                  // Potential (placeholder) job minutes for this week — count
                  // toward utilization; Custom blocks are excluded.
                  const weekPhMins = placeholderJobs
                    .filter(
                      (j) =>
                        j.technician_id === tech.technician_id &&
                        weekIsos.has(j.start_time.slice(0, 10)),
                    )
                    .reduce(
                      (s2, j) =>
                        s2 +
                        Math.max(
                          0,
                          Math.round(
                            (new Date(j.end_time).getTime() -
                              new Date(j.start_time).getTime()) /
                              60000,
                          ),
                        ),
                      0,
                    );
                  const weekCapMinutes = Math.round(
                    idleCapMinutes(tech.technician_id) /
                      Math.max(1, stackedWeeks.length),
                  );
                  const weekTotalMins =
                    weekJobMins + weekPhMins + weekBlkMins.driveTime + weekBlkMins.pto;
                  const weekHasAnyBooking =
                    weekJobs.length > 0 ||
                    weekPhMins > 0 ||
                    weekBlkMins.driveTime > 0 ||
                    weekBlkMins.pto > 0;

                  return (
                    <div
                      key={mondayISO}
                      ref={mondayISO === todayWeekMonday ? todayStackedRowRef : undefined}
                      className="grid border-b border-foreground/20 last:border-b-0"
                      style={{ gridTemplateColumns: stackedColTemplate }}
                      data-testid={`stacked-week-${mondayISO}`}
                    >
                      {/* Week label — styled like the swimlane tech row header */}
                      <div className="px-2 py-2 border-r border-foreground/40 flex flex-col justify-start bg-muted/20 gap-0.5">
                        <div className="text-xs font-semibold text-foreground leading-tight">
                          {weekStart}
                        </div>
                        <div className="text-[10px] text-foreground/60 mb-1">– {weekEnd}</div>
                        <div className="text-[10px] text-foreground/50">
                          {distinctJobCount(weekJobs)} job
                          {distinctJobCount(weekJobs) !== 1 ? "s" : ""}
                          {weekJobMins > 0 && ` · ${fmtMins(weekJobMins)}`}
                        </div>
                        {(weekBlkMins.driveTime > 0 || weekBlkMins.pto > 0) && (
                          <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                            {weekBlkMins.driveTime > 0 && (
                              <span className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
                                <Car className="h-2.5 w-2.5 shrink-0" />
                                {fmtMins(weekBlkMins.driveTime)}
                              </span>
                            )}
                            {weekBlkMins.pto > 0 && (
                              <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                                <Sun className="h-2.5 w-2.5 shrink-0" />
                                {fmtMins(weekBlkMins.pto)}
                              </span>
                            )}
                          </div>
                        )}
                        {weekHasAnyBooking ? (
                          <CapacityBadge
                            utilizedMinutes={weekTotalMins}
                            capacityMinutes={weekCapMinutes}
                            colorClass={palette.chip}
                            jobMinutes={weekJobMins > 0 ? weekJobMins : undefined}
                            potentialMinutes={weekPhMins > 0 ? weekPhMins : undefined}
                            driveTimeMinutes={
                              weekBlkMins.driveTime > 0
                                ? weekBlkMins.driveTime
                                : undefined
                            }
                            ptoMinutes={
                              weekBlkMins.pto > 0 ? weekBlkMins.pto : undefined
                            }
                          />
                        ) : (
                          <IdleCapacityBadge
                            capacityMinutes={weekCapMinutes}
                            colorClass={palette.chip}
                          />
                        )}
                      </div>

                      {/* Day cells */}
                      {weekDayCells.map((dh, ci) => {
                        if (!dh) {
                          return (
                            <div
                              key={ci}
                              className="border-r border-foreground/20 last:border-r-0 p-1 min-h-[60px] bg-muted/30"
                            />
                          );
                        }
                        const dayIdx = dayHeaders.findIndex((h) => h.iso === dh.iso);
                        const jobs = (tech.jobs as ScheduleJob[])
                          .filter((j) => j.day_index === dayIdx)
                          .sort((a, b) => {
                            const am = timeToMins(a.crmstarttime);
                            const bm = timeToMins(b.crmstarttime);
                            if (am == null && bm == null) return 0;
                            if (am == null) return 1;
                            if (bm == null) return -1;
                            return am - bm;
                          });
                        const cellBlocks = blocksForCell(tech.technician_id, dh.iso);
                        const cellPlaceholders = placeholderJobsForCell(tech.technician_id, dh.iso);
                        const orderKey = `${tech.technician_id}|${dh.iso}`;
                        const cellItems = applyChipOrder(orderKey, [
                          ...jobs.map((j) => ({
                            key: `job:${j.booking_id}`,
                            node: (
                              <JobChip
                                job={j}
                                compact={false}
                                colorClass={palette.chip}
                                isConflict={conflictedBookingIds.has(j.booking_id)}
                                syncPending={pendingSyncIds.has(j.booking_id)}
                                onOpen={isEditor ? () => setEditing(buildEditRow(j, tech.technician_id)) : undefined}
                                onDragStart={isEditor ? () => startDrag(j, tech.technician_id) : undefined}
                                onDragEnd={endDrag}
                                isDragging={draggingId === j.booking_id}
                                showEquipment
                                showDuration={false}
                                dimmed={
                                  !!activeSearch && !jobMatchesSearch(j, activeSearch)
                                }
                                localNote={notesByBookingId.get(j.booking_id) ?? null}
                              />
                            ),
                          })),
                          ...cellBlocks.map((blk) => ({
                            key: `block:${blk.id}`,
                            node: (
                              <BlockChip
                                block={blk}
                                dayIso={dh.iso}
                                onEdit={isEditor ? () =>
                                  setEditingBlock({
                                    block: blk,
                                    technicianName: tech.resource_name ?? "Unknown",
                                    regionName: focusedTechData.region,
                                  }) : undefined
                                }
                                onDelete={isEditor ? () => deleteBlockMutation.mutate({ id: blk.id }) : undefined}
                                onDragStart={isEditor ? () => startBlockDrag(blk, "move") : undefined}
                                onResizeStart={isEditor ? () => startBlockDrag(blk, "resize") : undefined}
                                onDragEnd={endDrag}
                                isDragging={draggingBlockId === blk.id}
                                regionName={focusedTechData.region}
                              />
                            ),
                          })),
                          ...cellPlaceholders.map((phj) => ({
                            key: `ph:${phj.id}`,
                            node: (
                              <PlaceholderJobChip
                                job={phj}
                                dayIso={dh.iso}
                                technicianId={tech.technician_id}
                                onEdit={isEditor ? () =>
                                  setEditingPlaceholder({
                                    job: phj,
                                    technicianName: tech.resource_name ?? "Unknown",
                                    regionName: focusedTechData.region,
                                  }) : undefined
                                }
                                onDelete={isEditor ? () =>
                                  deletePlaceholderMutation.mutate({ id: phj.id })
                                : undefined}
                                onDragStart={isEditor ? () => startPlaceholderDrag(phj, "move") : undefined}
                                onResizeStart={isEditor ? () => startPlaceholderDrag(phj, "resize") : undefined}
                                onDragEnd={endDrag}
                                isDragging={draggingPlaceholderId === phj.id}
                                regionName={focusedTechData.region}
                                dimmed={
                                  !!activeSearch &&
                                  !placeholderJobMatchesSearch(
                                    phj,
                                    activeSearch,
                                    tech.resource_name,
                                  )
                                }
                              />
                            ),
                          })),
                        ]);
                        const orderedKeys = cellItems.map((it) => it.key);
                        const isEmptyCell = cellItems.length === 0;
                        const cellKey = `${tech.technician_id}:${dayIdx}`;
                        const isDropTarget =
                          (draggingId !== null ||
                            draggingBlockId !== null ||
                            draggingPlaceholderId !== null) &&
                          dragOverCell === cellKey;
                        const conflictDrop =
                          draggingId !== null &&
                          dropWouldConflict(tech.technician_id, dayIdx);
                        const dropCue = conflictDrop
                          ? isDropTarget
                            ? "bg-amber-100 ring-2 ring-inset ring-amber-500"
                            : "bg-amber-50 ring-1 ring-inset ring-amber-300"
                          : isDropTarget
                            ? "bg-primary/10 ring-2 ring-inset ring-primary"
                            : "";
                        return (
                          <div
                            key={dh.iso}
                            className={`group relative border-r border-foreground/20 last:border-r-0 p-1 space-y-1 min-h-[60px] transition-colors ${dropCue} ${isEmptyCell ? "cursor-pointer" : ""}`}
                            data-testid={`stacked-cell-${tech.technician_id}-${dh.iso}`}
                            onClick={
                              isEditor && isEmptyCell
                                ? () =>
                                    setAddingBlock({
                                      technicianId: tech.technician_id,
                                      technicianName: tech.resource_name ?? "Unknown",
                                      date: dh.iso,
                                      regionName: focusedTechData.region,
                                    })
                                : undefined
                            }
                            onDragOver={(e) => {
                              if (
                                !dragJobRef.current &&
                                !dragBlockRef.current &&
                                !dragPlaceholderRef.current
                              )
                                return;
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                              if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                            }}
                            onDragLeave={() =>
                              setDragOverCell((prev) => (prev === cellKey ? null : prev))
                            }
                            onDrop={(e) => {
                              e.preventDefault();
                              if (!isEditor) return;
                              if (dragBlockRef.current) {
                                handleBlockDropOnCell(tech.technician_id, dh.iso);
                                return;
                              }
                              if (dragPlaceholderRef.current) {
                                handlePlaceholderDropOnCell(tech.technician_id, dh.iso);
                                return;
                              }
                              handleDropOnCell(tech.technician_id, dayIdx, tech.resource_name);
                            }}
                          >
                            {cellItems.map((it) => (
                              <div
                                key={it.key}
                                className="relative"
                                onDragStartCapture={() => {
                                  dragSourceCellRef.current = orderKey;
                                }}
                                onDragOver={(e) => chipReorderDragOver(e, orderKey, it.key)}
                                onDrop={(e) =>
                                  chipReorderDrop(e, orderKey, it.key, orderedKeys)
                                }
                              >
                                {reorderTarget?.orderKey === orderKey &&
                                  reorderTarget.chipKey === it.key && (
                                    <div
                                      className={`pointer-events-none absolute left-0 right-0 z-10 h-0.5 rounded bg-primary ${reorderTarget.pos === "above" ? "-top-[3px]" : "-bottom-[3px]"}`}
                                    />
                                  )}
                                {it.node}
                              </div>
                            ))}
                            {isEditor && (isEmptyCell ? (
                              <div className="absolute inset-0 flex items-center justify-center gap-1 text-xs font-bold text-muted-foreground/40 hover:text-foreground hover:bg-accent/70 rounded transition-colors opacity-0 group-hover:opacity-100">
                                <Plus className="h-3 w-3" /> Block
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="w-full flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/60 rounded px-1 py-0.5 transition-colors opacity-0 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddingBlock({
                                    technicianId: tech.technician_id,
                                    technicianName: tech.resource_name ?? "Unknown",
                                    date: dh.iso,
                                    regionName: focusedTechData.region,
                                  });
                                }}
                              >
                                <Plus className="h-2.5 w-2.5" /> Block
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {stackedWeeks.length === 0 && (
                  <div className="px-4 py-8 text-sm text-muted-foreground italic text-center">
                    No data for this period.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Calendar view — one row per technician, weekday columns (weekends optional), grouped by region */}
      {view === "tech" && !isLoading && !error && techsToPrint.length > 0 && effectiveFocusedTechId === null && (
        <div data-testid="tech-view" className="space-y-6">
          {regions.map((rg) => {
            const techsInRegion = rg.technicians.filter(
              (t) => selectedTechIds === null || selectedTechIds.has(t.technician_id),
            );
            if (techsInRegion.length === 0) return null;
            const regionJobCount = techsInRegion.reduce((s, t) => s + distinctJobCount(t.jobs), 0);
            const regionUtilMinutes = techsInRegion.reduce(
              (s, t) => s + techTotalUtilMinutes(t.technician_id),
              0,
            );
            const regionCapMinutes = techsInRegion.reduce(
              (s, t) => s + idleCapMinutes(t.technician_id),
              0,
            );
            return (
              <Card
                key={rg.regionid_id}
                className="overflow-hidden border-2 border-foreground/80 shadow-sm print:shadow-none bg-white"
                data-testid={`tech-region-${rg.regionid_id}`}
              >
                {/* Region header */}
                <div className="px-4 py-3 border-b-2 border-foreground/80 flex items-center gap-3 bg-white flex-wrap">
                  {groupBy === "service-location"
                    ? <MapPin className="h-4 w-4 text-foreground/70" />
                    : <Globe className="h-4 w-4 text-foreground/70" />}
                  <span className="text-base font-bold text-foreground">{rg.region}</span>
                  {groupBy === "service-location" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 font-semibold uppercase tracking-wide">
                      Service Location
                    </span>
                  )}
                  {rg.company && (
                    <span className="text-xs px-2 py-0.5 rounded border border-foreground/30 font-mono font-semibold text-foreground/70">
                      {rg.company}
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {techsInRegion.length} tech{techsInRegion.length !== 1 ? "s" : ""} · {regionJobCount} job
                    {regionJobCount !== 1 ? "s" : ""}
                  </Badge>
                  {groupBy !== "service-location" && (
                    <div className="ml-auto">
                      <RegionCapacityBadge
                        utilizedMinutes={regionUtilMinutes}
                        capacityMinutes={regionCapMinutes}
                        techCount={techsInRegion.length}
                        colorClass={regionPaletteEntry(rg.region).chip}
                      />
                    </div>
                  )}
                </div>

                <CardContent className="p-0 overflow-x-auto">
                  <div style={{ minWidth: `${minTechCalWidth}px` }}>
                    {/* Day-of-week headers */}
                    <div
                      className="grid bg-white border-b-2 border-foreground/80"
                      style={{ gridTemplateColumns: techCalColTemplate }}
                    >
                      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/60 border-r border-foreground/40">
                        Technician
                      </div>
                      {weekdayHeaders.map((dh) => (
                        <div
                          key={dh.iso}
                          className={`px-1.5 py-2 text-xs font-bold text-center border-r border-foreground/20 last:border-r-0 ${dh.isMonday ? "border-l-2 border-l-foreground/40" : ""}`}
                        >
                          <div className="text-foreground">{dh.dow}</div>
                          <div className="text-foreground/60 font-normal">{dh.date}</div>
                        </div>
                      ))}
                    </div>

                    {/* One row per technician */}
                    {techsInRegion.map((tech) => {
                      const palette = regionPaletteEntry(rg.region);
                      const jobsByWeekday = weekdayHeaders.map(({ dayIdx }) => {
                        const jobs = (tech.jobs as ScheduleJob[]).filter(
                          (j) => j.day_index === dayIdx,
                        );
                        return jobs.sort((a, b) => {
                          const am = timeToMins(a.crmstarttime);
                          const bm = timeToMins(b.crmstarttime);
                          if (am == null && bm == null) return 0;
                          if (am == null) return 1;
                          if (bm == null) return -1;
                          return am - bm;
                        });
                      });
                      return (
                        <div
                          key={tech.technician_id}
                          className="grid border-b border-foreground/20 last:border-b-0 hover:bg-accent/10"
                          style={{ gridTemplateColumns: techCalColTemplate }}
                          data-testid={`row-tech-${tech.technician_id}`}
                        >
                          <div className="px-2 py-2 border-r border-foreground/40 flex items-start gap-1.5">
                            <span
                              className={`mt-1 h-2 w-2 rounded-full shrink-0 ${palette.dot}`}
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-foreground leading-tight truncate">
                                {tech.resource_name ?? "Unassigned"}
                              </div>
                              {(() => {
                                const blkMins = techBlockMinutes(tech.technician_id);
                                // utilized_minutes from the API already includes potential-job
                                // minutes; split them out for display only.
                                const utilMins = techUtilMinutes(tech.technician_id);
                                const phMins = Math.min(utilMins, techPlaceholderMinutes(tech.technician_id));
                                const jobMins = utilMins - phMins;
                                const totalMins = utilMins + blkMins.driveTime + blkMins.pto;
                                const hasAnyBooking =
                                  tech.jobs.length > 0 || phMins > 0 || blkMins.driveTime > 0 || blkMins.pto > 0;
                                return (
                                  <>
                                    <div className="text-[10px] text-foreground/50">
                                      {distinctJobCount(tech.jobs)} job{distinctJobCount(tech.jobs) !== 1 ? "s" : ""}
                                      {jobMins > 0 && ` · ${fmtMins(jobMins)}`}
                                    </div>
                                    {(blkMins.driveTime > 0 || blkMins.pto > 0) && (
                                      <div className="flex items-center gap-1.5 text-[10px] mt-0.5 flex-wrap">
                                        {blkMins.driveTime > 0 && (
                                          <span className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
                                            <Car className="h-2.5 w-2.5 shrink-0" />
                                            {fmtMins(blkMins.driveTime)}
                                          </span>
                                        )}
                                        {blkMins.pto > 0 && (
                                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                                            <Sun className="h-2.5 w-2.5 shrink-0" />
                                            {fmtMins(blkMins.pto)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {hasAnyBooking ? (
                                      <CapacityBadge
                                        utilizedMinutes={totalMins}
                                        capacityMinutes={idleCapMinutes(tech.technician_id)}
                                        colorClass={palette.chip}
                                        jobMinutes={jobMins > 0 ? jobMins : undefined}
                                        potentialMinutes={phMins > 0 ? phMins : undefined}
                                        driveTimeMinutes={blkMins.driveTime > 0 ? blkMins.driveTime : undefined}
                                        ptoMinutes={blkMins.pto > 0 ? blkMins.pto : undefined}
                                      />
                                    ) : (
                                      <IdleCapacityBadge
                                        capacityMinutes={idleCapMinutes(tech.technician_id)}
                                        colorClass={palette.chip}
                                      />
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          {jobsByWeekday.map((jobs, i) => {
                            const dh = weekdayHeaders[i];
                            const cellKey = `${tech.technician_id}:${dh.dayIdx}`;
                            const isDropTarget =
                              (draggingId !== null ||
                                draggingBlockId !== null ||
                                draggingPlaceholderId !== null) &&
                              dragOverCell === cellKey;
                            const conflictDrop =
                              draggingId !== null &&
                              dropWouldConflict(tech.technician_id, dh.dayIdx);
                            const dropCue = conflictDrop
                              ? isDropTarget
                                ? "bg-amber-100 ring-2 ring-inset ring-amber-500"
                                : "bg-amber-50 ring-1 ring-inset ring-amber-300"
                              : isDropTarget
                                ? "bg-primary/10 ring-2 ring-inset ring-primary"
                                : "";
                            const isEmptyCell =
                              jobs.length === 0 &&
                              blocksForCell(tech.technician_id, dh.iso).length === 0 &&
                              placeholderJobsForCell(tech.technician_id, dh.iso).length === 0;
                            const orderKey = `${tech.technician_id}|${dh.iso}`;
                            const cellItems = applyChipOrder(orderKey, [
                              ...jobs.map((j) => ({
                                key: `job:${j.booking_id}`,
                                node: (
                                  <JobChip
                                    job={j}
                                    compact={false}
                                    colorClass={palette.chip}
                                    isConflict={conflictedBookingIds.has(j.booking_id)}
                                    syncPending={pendingSyncIds.has(j.booking_id)}
                                    onOpen={isEditor ? () => setEditing(buildEditRow(j, tech.technician_id)) : undefined}
                                    onDragStart={isEditor ? () => startDrag(j, tech.technician_id) : undefined}
                                    onDragEnd={endDrag}
                                    isDragging={draggingId === j.booking_id}
                                    showEquipment
                                    showDuration={false}
                                    dimmed={!!activeSearch && !jobMatchesSearch(j, activeSearch)}
                                    localNote={notesByBookingId.get(j.booking_id) ?? null}
                                  />
                                ),
                              })),
                              ...blocksForCell(tech.technician_id, dh.iso).map((blk) => ({
                                key: `block:${blk.id}`,
                                node: (
                                  <BlockChip
                                    block={blk}
                                    dayIso={dh.iso}
                                    onEdit={isEditor ? () => setEditingBlock({ block: blk, technicianName: tech.resource_name ?? "Unknown", regionName: rg.region }) : undefined}
                                    onDelete={isEditor ? () => deleteBlockMutation.mutate({ id: blk.id }) : undefined}
                                    onDragStart={isEditor ? () => startBlockDrag(blk, "move") : undefined}
                                    onResizeStart={isEditor ? () => startBlockDrag(blk, "resize") : undefined}
                                    onDragEnd={endDrag}
                                    isDragging={draggingBlockId === blk.id}
                                    regionName={rg.region}
                                  />
                                ),
                              })),
                              ...placeholderJobsForCell(tech.technician_id, dh.iso).map((phj) => ({
                                key: `ph:${phj.id}`,
                                node: (
                                  <PlaceholderJobChip
                                    job={phj}
                                    dayIso={dh.iso}
                                    technicianId={tech.technician_id}
                                    onEdit={isEditor ? () => setEditingPlaceholder({ job: phj, technicianName: tech.resource_name ?? "Unknown", regionName: rg.region }) : undefined}
                                    onDelete={isEditor ? () => deletePlaceholderMutation.mutate({ id: phj.id }) : undefined}
                                    onDragStart={isEditor ? () => startPlaceholderDrag(phj, "move") : undefined}
                                    onResizeStart={isEditor ? () => startPlaceholderDrag(phj, "resize") : undefined}
                                    onDragEnd={endDrag}
                                    isDragging={draggingPlaceholderId === phj.id}
                                    regionName={rg.region}
                                    dimmed={!!activeSearch && !placeholderJobMatchesSearch(phj, activeSearch, tech.resource_name)}
                                  />
                                ),
                              })),
                            ]);
                            const orderedKeys = cellItems.map((it) => it.key);
                            return (
                              <div
                                key={i}
                                className={`group relative border-r border-foreground/20 last:border-r-0 p-1 space-y-1 min-h-[60px] transition-colors ${dh.isMonday ? "border-l-2 border-l-foreground/20" : ""} ${dropCue} ${isEmptyCell ? "cursor-pointer" : ""}`}
                                data-testid={`tech-cell-${tech.technician_id}-${dh.dayIdx}`}
                                aria-label={conflictDrop ? "Conflicting drop slot" : undefined}
                                onClick={
                                  isEditor && isEmptyCell
                                    ? () =>
                                        setAddingBlock({
                                          technicianId: tech.technician_id,
                                          technicianName: tech.resource_name ?? "Unknown",
                                          date: dh.iso,
                                          regionName: rg.region,
                                        })
                                    : undefined
                                }
                                onDragOver={(e) => {
                                  if (!dragJobRef.current && !dragBlockRef.current && !dragPlaceholderRef.current) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                                  setReorderTarget((prev) => (prev ? null : prev));
                                }}
                                onDragLeave={() => {
                                  setDragOverCell((prev) => (prev === cellKey ? null : prev));
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (!isEditor) return;
                                  if (dragBlockRef.current) {
                                    handleBlockDropOnCell(tech.technician_id, dh.iso);
                                    return;
                                  }
                                  if (dragPlaceholderRef.current) {
                                    handlePlaceholderDropOnCell(tech.technician_id, dh.iso);
                                    return;
                                  }
                                  handleDropOnCell(
                                    tech.technician_id,
                                    dh.dayIdx,
                                    tech.resource_name,
                                  );
                                }}
                              >
                                {cellItems.map((it) => (
                                  <div
                                    key={it.key}
                                    className="relative"
                                    onDragStartCapture={() => {
                                      dragSourceCellRef.current = orderKey;
                                    }}
                                    onDragOver={(e) => chipReorderDragOver(e, orderKey, it.key)}
                                    onDrop={(e) => chipReorderDrop(e, orderKey, it.key, orderedKeys)}
                                  >
                                    {reorderTarget?.orderKey === orderKey &&
                                      reorderTarget.chipKey === it.key && (
                                        <div
                                          className={`pointer-events-none absolute left-0 right-0 z-10 h-0.5 rounded bg-primary ${reorderTarget.pos === "above" ? "-top-[3px]" : "-bottom-[3px]"}`}
                                        />
                                      )}
                                    {it.node}
                                  </div>
                                ))}
                                {isEditor && <button
                                  type="button"
                                  className={
                                    isEmptyCell
                                      ? "absolute inset-0 flex items-center justify-center gap-1 text-xs font-bold text-muted-foreground/40 hover:text-foreground hover:bg-accent/70 rounded transition-colors opacity-0 group-hover:opacity-100"
                                      : "w-full flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/60 rounded px-1 py-0.5 transition-colors opacity-0 group-hover:opacity-100"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAddingBlock({
                                      technicianId: tech.technician_id,
                                      technicianName: tech.resource_name ?? "Unknown",
                                      date: dh.iso,
                                      regionName: rg.region,
                                    });
                                  }}
                                >
                                  <Plus className={isEmptyCell ? "h-4 w-4 shrink-0" : "h-2.5 w-2.5 shrink-0"} />
                                  Add
                                </button>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>

                <div className="px-4 py-2.5 border-t-2 border-foreground/80 text-center text-xs font-bold uppercase tracking-widest text-foreground bg-white">
                  {fmtRangeLabel(rangeStart, dayCount, "month")}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {view === "tech" && !isLoading && !error && techsToPrint.length === 0 && (
        <div className="text-center py-20 text-muted-foreground" data-testid="empty-tech">
          <User className="mx-auto h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">No technicians match the current filters.</p>
        </div>
      )}

      {/* Week / Month grid view */}
      {view !== "tech" && !isLoading && !error && regions.length > 0 && (
        <div className="space-y-6">
          {regions.map((rg) => {
            const techsInRegion = rg.technicians.filter(
              (t) => selectedTechIds === null || selectedTechIds.has(t.technician_id),
            );
            if (techsInRegion.length === 0) return null;
            const regionJobCount = techsInRegion.reduce((s, t) => s + distinctJobCount(t.jobs), 0);
            const regionUtilMinutes = techsInRegion.reduce(
              (s, t) => s + techTotalUtilMinutes(t.technician_id),
              0,
            );
            const regionCapMinutes = techsInRegion.reduce(
              (s, t) => s + idleCapMinutes(t.technician_id),
              0,
            );

            return (
              <Card
                key={rg.regionid_id}
                className="overflow-hidden border border-card-border shadow-sm"
                data-testid={`region-${rg.region}`}
              >
                <div className="bg-sidebar text-sidebar-foreground px-4 py-3 flex items-center gap-3 flex-wrap">
                  {groupBy === "service-location"
                    ? <MapPin className="h-5 w-5 text-sidebar-primary" />
                    : <Globe className="h-5 w-5 text-sidebar-primary" />}
                  <span className="text-lg font-bold">{rg.region}</span>
                  {groupBy === "service-location" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 border border-blue-300 text-blue-800 font-semibold uppercase tracking-wide">
                      Service Location
                    </span>
                  )}
                  {rg.company && (
                    <span className="text-xs px-2 py-0.5 rounded bg-sidebar-accent text-sidebar-accent-foreground font-mono font-semibold">
                      {rg.company}
                    </span>
                  )}
                  <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                    {techsInRegion.length} techs
                  </Badge>
                  <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                    {regionJobCount} jobs
                  </Badge>
                  {groupBy !== "service-location" && (
                    <div className="ml-auto">
                      <RegionCapacityBadge
                        utilizedMinutes={regionUtilMinutes}
                        capacityMinutes={regionCapMinutes}
                        techCount={techsInRegion.length}
                        colorClass={regionPaletteEntry(rg.region).chip}
                      />
                    </div>
                  )}
                </div>

                <CardContent className="p-0 overflow-x-auto">
                  <div style={{ minWidth: `${minBoardWidth}px` }}>
                    {/* Day headers */}
                    <div
                      className="grid bg-muted border-b border-border"
                      style={{ gridTemplateColumns: dayColTemplate }}
                    >
                      <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-r border-border">
                        Technician
                      </div>
                      {weekDayHeaders.map((dh) => (
                        <div
                          key={dh.iso}
                          className="px-2 py-2 text-xs font-semibold text-center border-r border-border last:border-r-0"
                        >
                          <div className="text-foreground">{dh.dow}</div>
                          <div className="text-muted-foreground font-normal">{dh.date}</div>
                        </div>
                      ))}
                    </div>

                    {techsInRegion.length === 0 && (
                      <div className="px-4 py-6 text-sm text-muted-foreground italic">
                        No technicians in this region.
                      </div>
                    )}
                    {techsInRegion.map((tech) => {
                      const palette = regionPaletteEntry(rg.region);
                      const jobsByDay: ScheduleJob[][] = Array.from({ length: dayCount }, () => []);
                      for (const j of tech.jobs as ScheduleJob[]) {
                        const idx = Math.max(0, Math.min(dayCount - 1, j.day_index ?? 0));
                        jobsByDay[idx].push(j);
                      }
                      for (const dayJobs of jobsByDay) {
                        dayJobs.sort((a, b) => {
                          const am = timeToMins(a.crmstarttime);
                          const bm = timeToMins(b.crmstarttime);
                          if (am == null && bm == null) return 0;
                          if (am == null) return 1;
                          if (bm == null) return -1;
                          return am - bm;
                        });
                      }
                      return (
                        <div
                          key={tech.technician_id}
                          className="grid border-b border-border last:border-b-0 hover:bg-accent/20"
                          style={{ gridTemplateColumns: dayColTemplate }}
                          data-testid={`row-tech-${tech.technician_id}`}
                        >
                          <div className="px-3 py-2 border-r border-border flex items-start gap-2">
                            <span
                              className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${palette.dot}`}
                              aria-hidden="true"
                            />
                            <div className="min-w-0">
                              <button
                                type="button"
                                onClick={() => focusTech(tech.technician_id)}
                                className="text-sm font-medium text-foreground truncate text-left w-full hover:text-primary hover:underline transition-colors"
                                title="View stacked calendar for this technician"
                              >
                                {tech.resource_name ?? "Unassigned"}
                              </button>
                              {(() => {
                                const blkMins = techBlockMinutes(tech.technician_id);
                                // utilized_minutes from the API already includes potential-job
                                // minutes; split them out for display only.
                                const utilMins = techUtilMinutes(tech.technician_id);
                                const phMins = Math.min(utilMins, techPlaceholderMinutes(tech.technician_id));
                                const jobMins = utilMins - phMins;
                                const totalMins = utilMins + blkMins.driveTime + blkMins.pto;
                                const hasAnyBooking =
                                  tech.jobs.length > 0 || phMins > 0 || blkMins.driveTime > 0 || blkMins.pto > 0;
                                return (
                                  <>
                                    <div className="text-[10px] text-muted-foreground">
                                      {distinctJobCount(tech.jobs)} job{distinctJobCount(tech.jobs) !== 1 ? "s" : ""}
                                      {jobMins > 0 && ` · ${fmtMins(jobMins)}`}
                                    </div>
                                    {(blkMins.driveTime > 0 || blkMins.pto > 0) && (
                                      <div className="flex items-center gap-1.5 text-[10px] mt-0.5 flex-wrap">
                                        {blkMins.driveTime > 0 && (
                                          <span className="flex items-center gap-0.5 text-slate-500 dark:text-slate-400">
                                            <Car className="h-2.5 w-2.5 shrink-0" />
                                            {fmtMins(blkMins.driveTime)}
                                          </span>
                                        )}
                                        {blkMins.pto > 0 && (
                                          <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400">
                                            <Sun className="h-2.5 w-2.5 shrink-0" />
                                            {fmtMins(blkMins.pto)}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {hasAnyBooking ? (
                                      <CapacityBadge
                                        utilizedMinutes={totalMins}
                                        capacityMinutes={idleCapMinutes(tech.technician_id)}
                                        colorClass={palette.chip}
                                        jobMinutes={jobMins > 0 ? jobMins : undefined}
                                        potentialMinutes={phMins > 0 ? phMins : undefined}
                                        driveTimeMinutes={blkMins.driveTime > 0 ? blkMins.driveTime : undefined}
                                        ptoMinutes={blkMins.pto > 0 ? blkMins.pto : undefined}
                                      />
                                    ) : (
                                      <IdleCapacityBadge
                                        capacityMinutes={idleCapMinutes(tech.technician_id)}
                                        colorClass={palette.chip}
                                      />
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          {weekDayHeaders.map(({ iso, dayIdx }) => {
                            const jobs = jobsByDay[dayIdx] ?? [];
                            const cellKey = `${tech.technician_id}:${dayIdx}`;
                            const otherLocationBookings =
                              groupBy === "service-location"
                                ? (serviceLocationBookingsByTechAndDay.get(cellKey) ?? []).filter(
                                    ({ locationId }) => locationId !== rg.regionid_id,
                                  )
                                : [];
                            const isDropTarget =
                              (draggingId !== null ||
                                draggingBlockId !== null ||
                                draggingPlaceholderId !== null) &&
                              dragOverCell === cellKey;
                            const conflictDrop =
                              draggingId !== null && dropWouldConflict(tech.technician_id, dayIdx);
                            const dropCue = conflictDrop
                              ? isDropTarget
                                ? "bg-amber-100 ring-2 ring-inset ring-amber-500"
                                : "bg-amber-50 ring-1 ring-inset ring-amber-300"
                              : isDropTarget
                                ? "bg-primary/10 ring-2 ring-inset ring-primary"
                                : "";
                            const isEmptyCell =
                              jobs.length === 0 &&
                              blocksForCell(tech.technician_id, iso).length === 0 &&
                              placeholderJobsForCell(tech.technician_id, iso).length === 0;
                            const orderKey = `${tech.technician_id}|${iso}`;
                            const cellItems = applyChipOrder(orderKey, [
                              ...jobs.map((j) => ({
                                key: `job:${j.booking_id}`,
                                node: (
                                  <JobChip
                                    job={j}
                                    compact={view === "month"}
                                    colorClass={palette.chip}
                                    isConflict={conflictedBookingIds.has(j.booking_id)}
                                    syncPending={pendingSyncIds.has(j.booking_id)}
                                    onOpen={isEditor ? () => setEditing(buildEditRow(j, tech.technician_id)) : undefined}
                                    onDragStart={isEditor ? () => startDrag(j, tech.technician_id) : undefined}
                                    onDragEnd={endDrag}
                                    isDragging={draggingId === j.booking_id}
                                    showEquipment={view === "week"}
                                    dimmed={!!activeSearch && !jobMatchesSearch(j, activeSearch)}
                                    localNote={notesByBookingId.get(j.booking_id) ?? null}
                                  />
                                ),
                              })),
                              ...blocksForCell(tech.technician_id, iso).map((blk) => ({
                                key: `block:${blk.id}`,
                                node: (
                                  <BlockChip
                                    block={blk}
                                    dayIso={iso}
                                    onEdit={isEditor ? () => setEditingBlock({ block: blk, technicianName: tech.resource_name ?? "Unknown", regionName: rg.region }) : undefined}
                                    onDelete={isEditor ? () => deleteBlockMutation.mutate({ id: blk.id }) : undefined}
                                    onDragStart={isEditor ? () => startBlockDrag(blk, "move") : undefined}
                                    onResizeStart={isEditor ? () => startBlockDrag(blk, "resize") : undefined}
                                    onDragEnd={endDrag}
                                    isDragging={draggingBlockId === blk.id}
                                    regionName={rg.region}
                                  />
                                ),
                              })),
                              ...placeholderJobsForCell(tech.technician_id, iso).map((phj) => ({
                                key: `ph:${phj.id}`,
                                node: (
                                  <PlaceholderJobChip
                                    job={phj}
                                    dayIso={iso}
                                    technicianId={tech.technician_id}
                                    onEdit={isEditor ? () => setEditingPlaceholder({ job: phj, technicianName: tech.resource_name ?? "Unknown", regionName: rg.region }) : undefined}
                                    onDelete={isEditor ? () => deletePlaceholderMutation.mutate({ id: phj.id }) : undefined}
                                    onDragStart={isEditor ? () => startPlaceholderDrag(phj, "move") : undefined}
                                    onResizeStart={isEditor ? () => startPlaceholderDrag(phj, "resize") : undefined}
                                    onDragEnd={endDrag}
                                    isDragging={draggingPlaceholderId === phj.id}
                                    regionName={rg.region}
                                    dimmed={!!activeSearch && !placeholderJobMatchesSearch(phj, activeSearch, tech.resource_name)}
                                  />
                                ),
                              })),
                            ]);
                            const orderedKeys = cellItems.map((it) => it.key);
                            return (
                              <div
                                key={iso}
                                className={`group relative border-r border-border last:border-r-0 p-1 space-y-1 min-h-[60px] transition-colors ${dropCue} ${otherLocationBookings.length > 0 ? "bg-amber-50/40 dark:bg-amber-950/20" : ""} ${isEmptyCell ? "cursor-pointer" : ""}`}
                                data-testid={`cell-${tech.technician_id}-${dayIdx}`}
                                aria-label={conflictDrop ? "Conflicting drop slot" : undefined}
                                onClick={
                                  isEditor && isEmptyCell
                                    ? () =>
                                        setAddingBlock({
                                          technicianId: tech.technician_id,
                                          technicianName: tech.resource_name ?? "Unknown",
                                          date: iso,
                                          regionName: rg.region,
                                        })
                                    : undefined
                                }
                                onDragOver={(e) => {
                                  if (!dragJobRef.current && !dragBlockRef.current && !dragPlaceholderRef.current) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                                  setReorderTarget((prev) => (prev ? null : prev));
                                }}
                                onDragLeave={() => {
                                  setDragOverCell((prev) => (prev === cellKey ? null : prev));
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  if (!isEditor) return;
                                  if (dragBlockRef.current) {
                                    handleBlockDropOnCell(tech.technician_id, iso);
                                    return;
                                  }
                                  if (dragPlaceholderRef.current) {
                                    handlePlaceholderDropOnCell(tech.technician_id, iso);
                                    return;
                                  }
                                  handleDropOnCell(tech.technician_id, dayIdx, tech.resource_name);
                                }}
                              >
                                {otherLocationBookings.length > 0 && (
                                  <CrossLocationBookingIndicator
                                    bookings={otherLocationBookings}
                                    testId={`cross-location-booking-${tech.technician_id}-${dayIdx}`}
                                  />
                                )}
                                {cellItems.map((it) => (
                                  <div
                                    key={it.key}
                                    className="relative"
                                    onDragStartCapture={() => {
                                      dragSourceCellRef.current = orderKey;
                                    }}
                                    onDragOver={(e) => chipReorderDragOver(e, orderKey, it.key)}
                                    onDrop={(e) => chipReorderDrop(e, orderKey, it.key, orderedKeys)}
                                  >
                                    {reorderTarget?.orderKey === orderKey &&
                                      reorderTarget.chipKey === it.key && (
                                        <div
                                          className={`pointer-events-none absolute left-0 right-0 z-10 h-0.5 rounded bg-primary ${reorderTarget.pos === "above" ? "-top-[3px]" : "-bottom-[3px]"}`}
                                        />
                                      )}
                                    {it.node}
                                  </div>
                                ))}
                                {isEditor && <button
                                  type="button"
                                  className={
                                    isEmptyCell
                                      ? "absolute inset-0 flex items-center justify-center gap-1 text-xs font-bold text-muted-foreground/40 hover:text-foreground hover:bg-accent/70 rounded transition-colors opacity-0 group-hover:opacity-100"
                                      : "w-full flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent/60 rounded px-1 py-0.5 transition-colors opacity-0 group-hover:opacity-100"
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setAddingBlock({
                                      technicianId: tech.technician_id,
                                      technicianName: tech.resource_name ?? "Unknown",
                                      date: iso,
                                      regionName: rg.region,
                                    });
                                  }}
                                >
                                  <Plus className={isEmptyCell ? "h-4 w-4 shrink-0" : "h-2.5 w-2.5 shrink-0"} />
                                  Add
                                </button>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {view !== "tech" &&
        !isLoading &&
        !error &&
        regions.length > 0 &&
        selectedTechIds !== null &&
        regions.every(
          (rg) => rg.technicians.filter((t) => selectedTechIds.has(t.technician_id)).length === 0,
        ) && (
          <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Briefcase className="h-4 w-4" />
            No technicians match the current filter.
          </div>
        )}

      {view !== "tech" && !isLoading && totalJobs === 0 && regions.length > 0 && (
        <div className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Briefcase className="h-4 w-4" />
          No jobs scheduled this {view}. Try a different {view}.
        </div>
      )}

      {/* ── Unscheduled Jobs panel ─────────────────────────────────────── */}
      {!isLoading && (() => {
        const buckets: UnscheduledJob[][] = [[], [], []];
        for (const j of visibleUnscheduledJobs) buckets[getBucketIndex(j.due_date)].push(j);
        buckets.forEach((b) => b.sort(sortByDue));
        return (
          <div className="space-y-3" data-testid="card-unscheduled-jobs">
            {/* Section header */}
            <div className="flex items-center gap-2 flex-wrap">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Unscheduled Jobs</h2>
              <Badge variant="secondary" className="ml-1 text-[10px]">{visibleUnscheduledJobs.length}</Badge>
              <span className="text-xs text-muted-foreground">· all dates</span>
              {activeRegionNames !== null && (
                <span className="text-xs text-muted-foreground">
                  · {activeRegionNames.size} region{activeRegionNames.size !== 1 ? "s" : ""} selected
                </span>
              )}
            </div>

            {visibleUnscheduledJobs.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground italic bg-card border border-card-border rounded-lg">
                No unscheduled jobs match the current filters.
              </div>
            ) : (
              <div className="space-y-3">
                {UNSCHEDULED_BUCKETS.map((bucket, bi) => (
                  <div
                    key={bi}
                    className={`rounded-lg border-2 ${bucket.border} overflow-hidden`}
                    data-testid={`unscheduled-bucket-${bi}`}
                  >
                    {/* Bucket header */}
                    <div className={`px-4 py-2.5 flex items-center gap-2 ${bucket.headerClass}`}>
                      <span className="text-sm font-semibold">{bucket.label}</span>
                      <span className="text-xs opacity-70">{bucket.sublabel}</span>
                      <span className={`ml-auto text-xs font-semibold px-1.5 py-0.5 rounded ${bucket.badgeClass}`}>
                        {buckets[bi].length}
                      </span>
                    </div>

                    {/* Horizontal card strip */}
                    <div className="bg-slate-50/60 px-3 py-3 overflow-x-auto">
                      {buckets[bi].length === 0 ? (
                        <div className="text-center text-xs text-muted-foreground italic py-4 min-h-[60px] flex items-center justify-center">
                          No jobs in this window
                        </div>
                      ) : (
                        <div className="flex gap-3 pb-1">
                          {buckets[bi].map((job) => (
                            <UnscheduledJobCard
                              key={job.work_order_id ?? job.work_order_number}
                              job={job}
                              bucketIdx={bi}
                              onSchedule={isEditor ? handleScheduleUnscheduled : () => {}}
                              highlighted={
                                highlightedUnscheduledId !== null &&
                                (job.work_order_id === highlightedUnscheduledId ||
                                  job.work_order_number === highlightedUnscheduledId)
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Resource Utilization panel ─────────────────────────────────── */}
      {(() => {
        const allUtilRegions = utilData?.regions ?? [];
        const weeklyHours = utilData?.default_weekly_capacity_hours ?? 40;
        const periodWeeks = utilData?.period_weeks ?? 1;
        const capTotal = Math.round(weeklyHours * periodWeeks);
        const capLabel = utilView === "week"
          ? `${weeklyHours}h/wk`
          : `~${capTotal}h/${utilView === "month" ? "mo" : "qtr"}`;

        const toggleUtilRegion = (id: string) => {
          setUtilRegions((prev) => {
            const current = prev ?? new Set(allUtilRegions.map((r) => r.regionid_id));
            const next = new Set(current);
            if (next.has(id)) next.delete(id); else next.add(id);
            if (next.size === allUtilRegions.length) return null;
            return next;
          });
        };
        const utilSelectAll = () => setUtilRegions(null);
        const utilSelectNone = () => setUtilRegions(new Set());
        const isUtilRegionSelected = (id: string) => utilRegions === null || utilRegions.has(id);

        const visibleUtilRegions = (utilRegions === null
          ? allUtilRegions
          : allUtilRegions.filter((r) => utilRegions.has(r.regionid_id)))
          // Show only resources that actually have jobs in the period.
          .map((r) => ({
            ...r,
            technicians: (r.technicians ?? []).filter((t) => (t.job_count ?? 0) > 0),
          }))
          .filter((r) => r.technicians.length > 0);

        const exportUtilizationCsv = () => {
          const header = [
            "Region",
            "Technician",
            "Job Count",
            "Utilized Hours",
            "Capacity Hours",
            "Utilization %",
          ];
          const rows: string[][] = [];
          for (const rg of visibleUtilRegions) {
            for (const t of rg.technicians ?? []) {
              const utilizedHours = (t.utilized_minutes ?? 0) / 60;
              const capacityHours = (t.capacity_minutes ?? 0) / 60;
              rows.push([
                rg.region,
                t.resource_name ?? "—",
                String(t.job_count ?? 0),
                utilizedHours.toFixed(2),
                capacityHours.toFixed(2),
                (t.utilization_pct ?? 0).toFixed(1),
              ]);
            }
          }
          const csv = [header, ...rows]
            .map((row) => row.map(csvCell).join(","))
            .join("\r\n");
          const periodEnd = utilView === "week" ? addDaysISO(start, 6) : addDaysISO(addMonthsISO(start, 1), -1);
          downloadCsv(`resource-utilization_${start}_to_${periodEnd}.csv`, csv);
        };

        return (
          <div className="space-y-3" data-testid="panel-resource-utilization">
            {/* Section header */}
            <div className="flex items-center gap-2 flex-wrap">
              <User className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Resource Utilization</h2>
              <span className="text-xs text-muted-foreground">· {capLabel} capacity</span>
              <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={exportUtilizationCsv}
                  disabled={visibleUtilRegions.length === 0}
                  data-testid="button-export-utilization-csv"
                >
                  <Download className="h-3 w-3" />
                  Export CSV
                </Button>
                <span className="text-muted-foreground/40 text-xs">|</span>
                <span className="text-xs text-muted-foreground shrink-0">Regions:</span>
                <button
                  onClick={utilSelectAll}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${utilRegions === null ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >All</button>
                <button
                  onClick={utilSelectNone}
                  className={`px-2 py-0.5 text-xs rounded border transition-colors ${utilRegions !== null && utilRegions.size === 0 ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >None</button>
                <span className="text-muted-foreground/40 text-xs">|</span>
                {allUtilRegions.map((r) => (
                  <button
                    key={r.regionid_id}
                    onClick={() => toggleUtilRegion(r.regionid_id)}
                    className={`px-2 py-0.5 text-xs rounded border transition-colors ${isUtilRegionSelected(r.regionid_id) ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                  >
                    {r.region}
                  </button>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500 inline-block" /> Healthy (&lt;80%)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500 inline-block" /> High (80–100%)</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500 inline-block" /> Over (&gt;100%)</span>
            </div>

            {utilLoading && (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
              </div>
            )}

            {!utilLoading && visibleUtilRegions.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-6 italic">No regions selected.</div>
            )}

            <div className="space-y-3">
              {visibleUtilRegions.map((rg) => {
                const techs = rg.technicians ?? [];
                const totalUtil = techs.reduce((s, t) => s + (t.utilized_minutes ?? 0), 0);
                const totalCap = techs.reduce((s, t) => s + (t.capacity_minutes ?? 0), 0);
                const regionPct = totalCap ? Math.round((totalUtil / totalCap) * 1000) / 10 : 0;
                const rc = utilColors(regionPct);
                return (
                  <Card key={rg.regionid_id} className="border border-card-border shadow-sm" data-testid={`util-region-${rg.regionid_id}`}>
                    <CardContent className="p-0">
                      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3">
                        <h3 className="text-sm font-semibold flex-1">{rg.region}</h3>
                        <RegionCapacityBadge
                          utilizedMinutes={totalUtil}
                          capacityMinutes={totalCap}
                          techCount={techs.length}
                          colorClass={regionPaletteEntry(rg.region).chip}
                        />
                        <span className={`text-sm font-bold tabular-nums ${rc.text}`}>{regionPct}% avg</span>
                      </div>
                      {techs.length === 0 ? (
                        <div className="px-4 py-4 text-center text-xs text-muted-foreground italic">No technicians.</div>
                      ) : (
                        <div className="divide-y divide-border">
                          {techs.map((t) => {
                            const pct = t.utilization_pct ?? 0;
                            const colors = utilColors(pct);
                            const capH = Math.round((t.capacity_minutes ?? 0) / 60);
                            return (
                              <div key={t.technician_id} className="px-4 py-2 grid grid-cols-12 gap-3 items-center" data-testid={`util-tech-${t.technician_id}`}>
                                <div className="col-span-3 min-w-0">
                                  <div className="text-xs font-medium truncate">{t.resource_name ?? "—"}</div>
                                  <div className="text-[10px] text-muted-foreground">{t.job_count} job{t.job_count !== 1 ? "s" : ""}</div>
                                </div>
                                <div className="col-span-6">
                                  <div className={`relative h-4 w-full rounded ${colors.bg}`}>
                                    <div className={`absolute top-0 left-0 h-4 rounded ${colors.bar} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                                    {pct > 100 && <div className="absolute top-0 right-0 h-4 w-1 bg-red-700 rounded-r" />}
                                  </div>
                                </div>
                                <div className={`col-span-2 text-xs font-semibold tabular-nums ${colors.text}`}>{pct.toFixed(1)}%</div>
                                <div className="col-span-1 text-[10px] text-muted-foreground text-right tabular-nums whitespace-nowrap">
                                  {fmtUtilHours(t.utilized_minutes ?? 0)} / {capH}h
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
      })()}

      {editing && (
        <EditBookingDialog
          row={editing}
          durationMinutes={editingDuration}
          onClose={() => {
            setEditing(null);
            setEditingDuration(null);
          }}
          onSaveSuccess={handleSaveSuccess}
        />
      )}
      {addingBlock && (
        <AddBlockDialog
          technicianId={addingBlock.technicianId}
          technicianName={addingBlock.technicianName}
          date={addingBlock.date}
          defaultColorIndex={regionColorIndex(addingBlock.regionName, "potential")}
          customDefaultColorIndex={regionColorIndex(addingBlock.regionName, "custom")}
          onClose={() => setAddingBlock(null)}
        />
      )}
      {editingBlock && (
        <EditBlockDialog
          block={editingBlock.block}
          technicianName={editingBlock.technicianName}
          defaultColorIndex={regionColorIndex(
            editingBlock.regionName,
            editingBlock.block.block_type === "custom" ? "custom" : "standard",
          )}
          onClose={() => setEditingBlock(null)}
        />
      )}
      {editingPlaceholder && (
        <EditPlaceholderJobDialog
          job={editingPlaceholder.job}
          technicianName={editingPlaceholder.technicianName}
          defaultColorIndex={regionColorIndex(editingPlaceholder.regionName, "potential")}
          onClose={() => setEditingPlaceholder(null)}
        />
      )}
      {showCalendarReport && (
        <CalendarReportDialog
          technicians={calendarReportTechs}
          onClose={() => setShowCalendarReport(false)}
        />
      )}

      {/* Floating scroll-to-top / scroll-to-bottom */}
      <div className="fixed bottom-5 right-5 flex flex-col gap-1.5 z-50">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="h-9 w-9 rounded-full bg-background border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:shadow-lg transition-all"
          aria-label="Scroll to top"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}
          className="h-9 w-9 rounded-full bg-background border shadow-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:shadow-lg transition-all"
          aria-label="Scroll to bottom"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
