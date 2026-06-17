import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetWbScheduleBoard,
  useGetWbUnscheduledJobs,
  useGetWbResourceUtilization,
  useUpdateWbBooking,
  getListWbWorkOrdersQueryKey,
  getListWbWritebacksQueryKey,
  getGetWbScheduleBoardQueryKey,
  getGetWbResourceUtilizationQueryKey,
  type WbWorkOrder,
  type UnscheduledJob,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
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
  Globe,
  Phone,
  Briefcase,
  AlertTriangle,
  Printer,
  User,
  MapPin,
  Clock,
} from "lucide-react";
import { EditBookingDialog } from "@/components/EditBookingDialog";
import {
  timeToMins,
  conflictedIdsForTech,
  wouldDropConflict,
} from "@/lib/conflicts";

type ViewMode = "week" | "month" | "tech";

function statusCode(s: string | null | undefined): string {
  switch ((s ?? "").toLowerCase()) {
    case "scheduled":
      return "SCH";
    case "completed":
      return "CMP";
    case "in progress":
      return "IP";
    case "cancelled":
      return "CAN";
    case "invoiced":
      return "INV";
    default:
      return (s ?? "").slice(0, 3).toUpperCase() || "—";
  }
}

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

// Shift an ISO timestamp by whole UTC days, preserving time-of-day. The board
// assigns jobs to day columns by UTC date, so shifting by the column delta both
// preserves the booking's time/duration and lands it in the dropped-on column.
function shiftIsoDays(iso: string | null | undefined, days: number): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
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
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function techColor(technicianId: string | null | undefined) {
  if (!technicianId) return TECH_PALETTE[0];
  return TECH_PALETTE[hashStr(technicianId) % TECH_PALETTE.length];
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
};

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

function JobChip({
  job,
  compact,
  colorClass,
  isConflict,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  job: ScheduleJob;
  compact: boolean;
  colorClass: string;
  isConflict?: boolean;
  onOpen: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const isCancelled = (job.system_status ?? "").toLowerCase() === "cancelled";
  const chip = (
    <button
      type="button"
      draggable
      onClick={onOpen}
      onDragStart={(e) => {
        onDragStart?.();
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", job.booking_id);
        }
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`w-full text-left text-[11px] leading-tight rounded border ${compact ? "px-1 py-0.5" : "px-1.5 py-1"} cursor-grab active:cursor-grabbing transition-colors ${isCancelled ? cancelledChipColor() : colorClass} ${isConflict ? "ring-2 ring-amber-400 ring-offset-0" : ""} ${isDragging ? "opacity-40" : ""}`}
      data-testid={`chip-job-${job.booking_id}`}
    >
      <div className="flex items-center gap-1">
        <span className="font-semibold truncate">{job.work_order_number ?? "WO"}</span>
        {isConflict && (
          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label="Double-booked" />
        )}
      </div>
      {!compact && (job.crmstarttime || job.crmendtime) && (
        <div className="opacity-80 truncate">
          {fmtTime(job.crmstarttime)}
          {job.crmendtime ? `–${fmtTime(job.crmendtime)}` : ""}
        </div>
      )}
      {!compact && <div className="opacity-90 truncate">{job.customer_name ?? "—"}</div>}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs p-3 space-y-1.5 text-xs">
        <div className="font-bold text-sm">{job.work_order_number ?? "Work Order"}</div>
        {job.title && <div className="text-muted-foreground -mt-1">{job.title}</div>}
        <div className="border-t border-border pt-1.5 space-y-1">
          <div>
            <span className="font-medium text-muted-foreground">Customer:</span>{" "}
            {job.customer_name ?? "—"}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">Technician:</span>{" "}
            {job.technician_name ?? "—"}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">CRM Start:</span>{" "}
            {job.crmstart_time ?? "—"} {fmtTime(job.crmstarttime)}
          </div>
          <div>
            <span className="font-medium text-muted-foreground">CRM End:</span>{" "}
            {job.crmend_time ?? "—"} {fmtTime(job.crmendtime)}
          </div>
          {job.system_status && (
            <div className="pt-0.5">
              <Badge variant="outline" className="text-[10px]">
                {job.system_status}
              </Badge>
            </div>
          )}
          {isConflict && (
            <div className="flex items-center gap-1 pt-1 text-amber-600 font-semibold">
              <AlertTriangle className="h-3 w-3" />
              Double-booked — time conflict
            </div>
          )}
          <div className="pt-1 text-[10px] text-muted-foreground italic">Click tile to edit booking</div>
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
}: {
  job: UnscheduledJob;
  bucketIdx: number;
  onSchedule: (job: UnscheduledJob, technicianId: string | null) => void;
}) {
  const t1 = job.best_fit_techs?.[0];
  const t2 = job.best_fit_techs?.[1];
  const duration = fmtMins(job.duration_minutes);
  const loc = [job.city, job.state].filter(Boolean).join(", ");
  const dateClass = UNSCHEDULED_BUCKETS[bucketIdx].dateClass;
  const canSchedule = !!job.work_order_id;

  return (
    <div
      className={`group bg-white rounded-lg border border-card-border shadow-sm hover:shadow-md hover:border-primary/50 transition-all p-4 flex flex-col gap-3 min-w-[260px] max-w-[300px] w-[280px] shrink-0 ${canSchedule ? "cursor-pointer" : ""}`}
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
  const [view, setView] = useState<ViewMode>("week");
  const [start, setStart] = useState<string>(() => startOfWeekISO(new Date()));
  const [selectedRegions, setSelectedRegions] = useState<Set<string> | null>(null);
  const [selectedTechIds, setSelectedTechIds] = useState<Set<string> | null>(null);
  const [editing, setEditing] = useState<WbWorkOrder | null>(null);
  // Estimated duration carried into the dialog when scheduling a new booking for
  // an unscheduled job, so the dialog can auto-fill the end time.
  const [editingDuration, setEditingDuration] = useState<number | null>(null);
  const [utilRegions, setUtilRegions] = useState<Set<string> | null>(null); // null = all
  // Capacity-planning toggle. When false (default) the board hides technicians
  // with no jobs in the current range to keep the view focused on scheduled
  // work. When true, idle technicians are shown across all views and counts.
  const [showIdleTechs, setShowIdleTechs] = useState(false);

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

  const startDrag = (job: ScheduleJob, sourceTechId: string) => {
    dragJobRef.current = { job, sourceTechId };
    setDraggingId(job.booking_id);
  };

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const moveMutation = useUpdateWbBooking({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWbWorkOrdersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListWbWritebacksQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWbScheduleBoardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetWbResourceUtilizationQueryKey() });
      },
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
    setDraggingId(null);
    setDragOverCell(null);
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
    const deltaDays = targetDayIndex - (job.day_index ?? 0);
    if (targetTechId === sourceTechId && deltaDays === 0) return; // no-op drop
    if (!job.booking_id) return;

    // Dropping onto a slot that already has an overlapping booking would
    // double-book the technician — confirm before staging the write-back.
    if (conflict) {
      const who = targetTechName?.trim() || "this technician";
      const what = job.work_order_number ?? "this booking";
      const ok = window.confirm(
        `Scheduling ${what} here overlaps an existing booking for ${who} on this day. This will double-book the technician.\n\nReschedule anyway?`,
      );
      if (!ok) return;
    }

    const newStart = shiftIsoDays(job.start_time, deltaDays);
    const newEnd = shiftIsoDays(job.end_time, deltaDays);

    moveMutation.mutate(
      {
        bookingId: job.booking_id,
        data: {
          start_time: newStart,
          end_time: newEnd,
          technician_id: targetTechId,
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "Reschedule queued",
            description: `${job.work_order_number ?? "Booking"} staged for write-back.`,
          });
        },
      },
    );
  };

  // Tech view reuses month data from the API.
  const apiView: "week" | "month" = view === "week" ? "week" : "month";
  const { data, isLoading, error } = useGetWbScheduleBoard({ start, view: apiView });

  const { data: unscheduledData } = useGetWbUnscheduledJobs();
  const unscheduledJobs = unscheduledData?.jobs ?? [];

  // Resource utilization — shares start date + view with the board
  const utilView = view === "week" ? "week" : "month";
  const { data: utilData, isLoading: utilLoading } = useGetWbResourceUtilization({
    start,
    view: utilView,
  });

  const dayCount = data?.day_count ?? (view === "week" ? 7 : 30);
  const rangeStart = data?.range_start ?? start;

  const dayHeaders = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const iso = addDaysISO(rangeStart, i);
        return { iso, ...fmtDayHeader(iso, view) };
      }),
    [rangeStart, dayCount, view],
  );

  // Display-only filter: by default only show technicians that have at least one
  // job in the current range, and drop regions that end up with no such
  // technicians. When `showIdleTechs` is on (capacity planning), show the full
  // roster including idle technicians. The API response is left untouched for
  // other consumers.
  const allRegions = useMemo(
    () =>
      showIdleTechs
        ? (data?.regions ?? [])
        : (data?.regions ?? [])
            .map((r) => ({
              ...r,
              technicians: r.technicians.filter((t) => (t.jobs?.length ?? 0) > 0),
            }))
            .filter((r) => r.technicians.length > 0),
    [data, showIdleTechs],
  );
  const regions = useMemo(
    () =>
      selectedRegions === null
        ? allRegions
        : allRegions.filter((r) => selectedRegions.has(r.regionid_id)),
    [allRegions, selectedRegions],
  );

  const totalJobs = regions.reduce(
    (s, r) => s + r.technicians.reduce((ts, t) => ts + t.jobs.length, 0),
    0,
  );

  // Time horizon for unscheduled jobs driven by the active view (no separate toggle)
  const unscheduledHorizonDays = view === "week" ? 7 : 30;

  // Map selected regionid_ids → region name strings for unscheduled job filtering
  const activeRegionNames = useMemo(() => {
    if (selectedRegions === null) return null;
    return new Set(
      allRegions.filter((r) => selectedRegions.has(r.regionid_id)).map((r) => r.region),
    );
  }, [allRegions, selectedRegions]);

  // Unscheduled jobs filtered by active region + view-derived horizon
  const visibleUnscheduledJobs = useMemo(() => {
    return unscheduledJobs.filter((j) => {
      if (activeRegionNames !== null && (j.region == null || !activeRegionNames.has(j.region)))
        return false;
      if (!j.due_date) return unscheduledHorizonDays >= 30;
      const diffDays =
        (new Date(j.due_date + "T00:00:00Z").getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      return diffDays <= unscheduledHorizonDays;
    });
  }, [unscheduledJobs, activeRegionNames, unscheduledHorizonDays]);

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
  const selectAllRegions = () => setSelectedRegions(null);
  const clearRegions = () => setSelectedRegions(new Set());
  const isRegionSelected = (id: string) => selectedRegions === null || selectedRegions.has(id);

  const goPrev = () => setStart(view === "week" ? addDaysISO(start, -7) : addMonthsISO(start, -1));
  const goNext = () => setStart(view === "week" ? addDaysISO(start, 7) : addMonthsISO(start, 1));
  const goToday = () =>
    setStart(view === "week" ? startOfWeekISO(new Date()) : startOfMonthISO(new Date()));

  const onChangeView = (next: ViewMode) => {
    if (next === view) return;
    const seed = new Date(start + "T00:00:00Z");
    setStart(next === "week" ? startOfWeekISO(seed) : startOfMonthISO(seed));
    setView(next);
  };

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

  // Drop selected tech ids that no longer exist after region/month change
  useEffect(() => {
    if (selectedTechIds === null) return;
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

  // Weekday-only headers (Mon–Fri) for the Calendar view
  const weekdayHeaders = useMemo(
    () =>
      dayHeaders
        .map((dh, i) => ({ ...dh, dayIdx: i }))
        .filter(({ iso }) => {
          const dow = new Date(iso + "T00:00:00Z").getUTCDay();
          return dow >= 1 && dow <= 5;
        })
        .map((dh) => ({
          ...dh,
          isMonday: new Date(dh.iso + "T00:00:00Z").getUTCDay() === 1,
        })),
    [dayHeaders],
  );

  const dayColTemplate =
    view === "week"
      ? `180px repeat(${dayCount}, minmax(0, 1fr))`
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
          <div
            className="text-base font-semibold tabular-nums px-2 min-w-[200px] text-center"
            data-testid="text-range"
          >
            {fmtRangeLabel(rangeStart, dayCount, view)}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={goNext}
            data-testid="btn-next"
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={goToday} data-testid="btn-today">
            Today
          </Button>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="inline-flex rounded-md border border-border bg-card overflow-hidden"
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
              aria-selected={view === "month"}
              onClick={() => onChangeView("month")}
              data-testid="btn-view-month"
              className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
                view === "month"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              Month
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "tech"}
              onClick={() => onChangeView("tech")}
              data-testid="btn-view-tech"
              className={`px-3 py-1.5 text-sm font-medium border-l border-border transition-colors ${
                view === "tech"
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground hover:bg-accent"
              }`}
            >
              Calendar
            </button>
          </div>
          {view === "tech" && allTechs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              data-testid="btn-print"
              className="gap-1.5"
            >
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
          )}
          {!isLoading && data && (
            <div className="text-sm text-muted-foreground flex gap-3">
              <span>
                <span className="font-semibold text-foreground">{regions.length}</span>
                {selectedRegions !== null && (
                  <span className="text-muted-foreground">/{allRegions.length}</span>
                )}{" "}
                regions
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-foreground">
                  {regions.reduce((s, r) => s + r.technicians.length, 0)}
                </span>{" "}
                techs
              </span>
              <span>·</span>
              <span>
                <span className="font-semibold text-foreground">{totalJobs}</span> jobs
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Region filter + capacity-planning toggle */}
      {!isLoading && data && (
        <div className="flex items-center gap-2 flex-wrap" data-testid="region-filter">
          {allRegions.length > 0 && (
            <>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1">
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
              className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              All
            </button>
            <span className="text-muted-foreground text-xs">|</span>
            <button
              type="button"
              onClick={clearRegions}
              data-testid="filter-none"
              className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              None
            </button>
          </div>
            </>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={showIdleTechs}
            onClick={() => setShowIdleTechs((v) => !v)}
            data-testid="toggle-show-idle-techs"
            title="Show technicians with no jobs in the current range"
            className={`ml-auto inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${
              showIdleTechs
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-accent"
            }`}
          >
            <span
              className={`relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${
                showIdleTechs ? "bg-primary-foreground/40" : "bg-muted-foreground/30"
              }`}
              aria-hidden
            >
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform ${
                  showIdleTechs ? "translate-x-3" : "translate-x-0.5"
                }`}
              />
            </span>
            Show idle techs
          </button>
        </div>
      )}

      {/* Tech filter (multi-select) — only in Calendar view */}
      {view === "tech" && !isLoading && allTechs.length > 0 && (
        <div className="flex items-start gap-2 flex-wrap print:hidden" data-testid="tech-filter">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mr-1 pt-1.5">
            Technicians:
          </span>
          {allTechs.map((t) => {
            const active = isTechSelected(t.id);
            const palette = techColor(t.id);
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
              className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              All
            </button>
            <span className="text-muted-foreground text-xs">|</span>
            <button
              type="button"
              onClick={clearTechs}
              data-testid="filter-tech-none"
              className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              None
            </button>
          </div>
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

      {/* Calendar view — one row per technician, weekday columns (Mon–Fri), grouped by region */}
      {view === "tech" && !isLoading && !error && techsToPrint.length > 0 && (
        <div data-testid="tech-view" className="space-y-6">
          {regions.map((rg) => {
            const techsInRegion = rg.technicians.filter(
              (t) => selectedTechIds === null || selectedTechIds.has(t.technician_id),
            );
            if (techsInRegion.length === 0) return null;
            const regionJobCount = techsInRegion.reduce((s, t) => s + t.jobs.length, 0);
            return (
              <Card
                key={rg.regionid_id}
                className="overflow-hidden border-2 border-foreground/80 shadow-sm print:shadow-none bg-white"
                data-testid={`tech-region-${rg.regionid_id}`}
              >
                {/* Region header */}
                <div className="px-4 py-3 border-b-2 border-foreground/80 flex items-center gap-3 bg-white flex-wrap">
                  <Globe className="h-4 w-4 text-foreground/70" />
                  <span className="text-base font-bold text-foreground">{rg.region}</span>
                  {rg.company && (
                    <span className="text-xs px-2 py-0.5 rounded border border-foreground/30 font-mono font-semibold text-foreground/70">
                      {rg.company}
                    </span>
                  )}
                  <Badge variant="outline" className="text-xs">
                    {techsInRegion.length} tech{techsInRegion.length !== 1 ? "s" : ""} · {regionJobCount} job
                    {regionJobCount !== 1 ? "s" : ""}
                  </Badge>
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
                      const palette = techColor(tech.technician_id);
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
                              <div className="text-[10px] text-foreground/50">
                                {tech.jobs.length} job{tech.jobs.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                          </div>
                          {jobsByWeekday.map((jobs, i) => {
                            const dh = weekdayHeaders[i];
                            const cellKey = `${tech.technician_id}:${dh.dayIdx}`;
                            const isDropTarget = draggingId !== null && dragOverCell === cellKey;
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
                            return (
                              <div
                                key={i}
                                className={`border-r border-foreground/20 last:border-r-0 p-1 space-y-1 min-h-[60px] transition-colors ${dh.isMonday ? "border-l-2 border-l-foreground/20" : ""} ${dropCue}`}
                                data-testid={`tech-cell-${tech.technician_id}-${dh.dayIdx}`}
                                aria-label={conflictDrop ? "Conflicting drop slot" : undefined}
                                onDragOver={(e) => {
                                  if (!dragJobRef.current) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                                }}
                                onDragLeave={() => {
                                  setDragOverCell((prev) => (prev === cellKey ? null : prev));
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  handleDropOnCell(
                                    tech.technician_id,
                                    dh.dayIdx,
                                    tech.resource_name,
                                  );
                                }}
                              >
                                {jobs.map((j) => {
                                  const isCancelled =
                                    (j.system_status ?? "").toLowerCase() === "cancelled";
                                  const isConflict = conflictedBookingIds.has(j.booking_id);
                                  const isDragging = draggingId === j.booking_id;
                                  return (
                                    <button
                                      type="button"
                                      key={j.booking_id}
                                      draggable
                                      onClick={() => setEditing(buildEditRow(j, tech.technician_id))}
                                      onDragStart={(e) => {
                                        startDrag(j, tech.technician_id);
                                        if (e.dataTransfer) {
                                          e.dataTransfer.effectAllowed = "move";
                                          e.dataTransfer.setData("text/plain", j.booking_id);
                                        }
                                      }}
                                      onDragEnd={endDrag}
                                      className={`block w-full text-left text-[11px] leading-tight rounded border-l-4 pl-1.5 py-1 pr-1 cursor-grab active:cursor-grabbing ${palette.chip.replace(/hover:bg-\S+/g, "").trim()} ${isCancelled ? "opacity-50 line-through" : ""} ${isConflict ? "ring-2 ring-amber-400 ring-offset-0" : ""} ${isDragging ? "opacity-40" : ""}`}
                                      style={{ borderLeftColor: "currentColor" }}
                                      data-testid={`tech-job-${j.booking_id}`}
                                    >
                                      {isConflict && (
                                        <div className="flex items-center gap-0.5 text-amber-600 font-semibold mb-0.5">
                                          <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                                          <span>Conflict</span>
                                        </div>
                                      )}
                                      <div className="font-bold truncate">{j.customer_name ?? "—"}</div>
                                      {(j.city || j.state) && (
                                        <div className="opacity-70 truncate">
                                          {[j.city, j.state].filter(Boolean).join(", ")}
                                        </div>
                                      )}
                                      {(j.crmstarttime || j.crmendtime) && (
                                        <div className="opacity-70 tabular-nums">
                                          {fmtTime(j.crmstarttime)}
                                          {j.crmendtime ? `–${fmtTime(j.crmendtime)}` : ""}
                                          {fmtDuration(j.crmstarttime, j.crmendtime) && (
                                            <span className="ml-1 opacity-80">
                                              · {fmtDuration(j.crmstarttime, j.crmendtime)}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div className="font-mono font-semibold tabular-nums">
                                        {j.work_order_number ?? "—"}
                                      </div>
                                      <div className="opacity-60 font-semibold">
                                        ({statusCode(j.system_status)})
                                      </div>
                                    </button>
                                  );
                                })}
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
            const regionJobCount = rg.technicians.reduce((s, t) => s + t.jobs.length, 0);

            return (
              <Card
                key={rg.regionid_id}
                className="overflow-hidden border border-card-border shadow-sm"
                data-testid={`region-${rg.region}`}
              >
                <div className="bg-sidebar text-sidebar-foreground px-4 py-3 flex items-center gap-3 flex-wrap">
                  <Globe className="h-5 w-5 text-sidebar-primary" />
                  <span className="text-lg font-bold">{rg.region}</span>
                  {rg.company && (
                    <span className="text-xs px-2 py-0.5 rounded bg-sidebar-accent text-sidebar-accent-foreground font-mono font-semibold">
                      {rg.company}
                    </span>
                  )}
                  <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                    {rg.technicians.length} techs
                  </Badge>
                  <Badge className="bg-sidebar-primary/20 text-sidebar-primary-foreground hover:bg-sidebar-primary/20 text-xs border-0">
                    {regionJobCount} jobs
                  </Badge>
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
                      {dayHeaders.map((dh) => (
                        <div
                          key={dh.iso}
                          className="px-2 py-2 text-xs font-semibold text-center border-r border-border last:border-r-0"
                        >
                          <div className="text-foreground">{dh.dow}</div>
                          <div className="text-muted-foreground font-normal">{dh.date}</div>
                        </div>
                      ))}
                    </div>

                    {rg.technicians.length === 0 && (
                      <div className="px-4 py-6 text-sm text-muted-foreground italic">
                        No technicians in this region.
                      </div>
                    )}
                    {rg.technicians.map((tech) => {
                      const palette = techColor(tech.technician_id);
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
                              <div className="text-sm font-medium text-foreground truncate">
                                {tech.resource_name ?? "Unassigned"}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {tech.jobs.length} job{tech.jobs.length !== 1 ? "s" : ""}
                              </div>
                            </div>
                          </div>
                          {jobsByDay.map((jobs, i) => {
                            const cellKey = `${tech.technician_id}:${i}`;
                            const isDropTarget = draggingId !== null && dragOverCell === cellKey;
                            const conflictDrop =
                              draggingId !== null && dropWouldConflict(tech.technician_id, i);
                            const dropCue = conflictDrop
                              ? isDropTarget
                                ? "bg-amber-100 ring-2 ring-inset ring-amber-500"
                                : "bg-amber-50 ring-1 ring-inset ring-amber-300"
                              : isDropTarget
                                ? "bg-primary/10 ring-2 ring-inset ring-primary"
                                : "";
                            return (
                              <div
                                key={i}
                                className={`border-r border-border last:border-r-0 p-1 space-y-1 min-h-[60px] transition-colors ${dropCue}`}
                                data-testid={`cell-${tech.technician_id}-${i}`}
                                aria-label={conflictDrop ? "Conflicting drop slot" : undefined}
                                onDragOver={(e) => {
                                  if (!dragJobRef.current) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                  if (dragOverCell !== cellKey) setDragOverCell(cellKey);
                                }}
                                onDragLeave={() => {
                                  setDragOverCell((prev) => (prev === cellKey ? null : prev));
                                }}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  handleDropOnCell(tech.technician_id, i, tech.resource_name);
                                }}
                              >
                                {jobs.map((j) => (
                                  <JobChip
                                    key={j.booking_id}
                                    job={j}
                                    compact={view === "month"}
                                    colorClass={palette.chip}
                                    isConflict={conflictedBookingIds.has(j.booking_id)}
                                    onOpen={() => setEditing(buildEditRow(j, tech.technician_id))}
                                    onDragStart={() => startDrag(j, tech.technician_id)}
                                    onDragEnd={endDrag}
                                    isDragging={draggingId === j.booking_id}
                                  />
                                ))}
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
        const horizonLabel = view === "week" ? "next 7 days" : "next 30 days";
        return (
          <div className="space-y-3" data-testid="card-unscheduled-jobs">
            {/* Section header */}
            <div className="flex items-center gap-2 flex-wrap">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Unscheduled Jobs</h2>
              <Badge variant="secondary" className="ml-1 text-[10px]">{visibleUnscheduledJobs.length}</Badge>
              <span className="text-xs text-muted-foreground">· due within {horizonLabel}</span>
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
                              onSchedule={handleScheduleUnscheduled}
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

        return (
          <div className="space-y-3" data-testid="panel-resource-utilization">
            {/* Section header */}
            <div className="flex items-center gap-2 flex-wrap">
              <User className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Resource Utilization</h2>
              <span className="text-xs text-muted-foreground">· {capLabel} capacity</span>
              <div className="ml-auto flex items-center gap-1.5 flex-wrap">
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
                        <Badge variant="outline" className="text-xs">{techs.length} tech{techs.length !== 1 ? "s" : ""}</Badge>
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
        />
      )}
    </div>
  );
}
