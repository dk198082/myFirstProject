/**
 * API client helpers for the Calendar Report feature.
 * Uses direct fetch (not the generated react-query client) since this is a
 * standalone feature with its own endpoint not in the shared OpenAPI spec.
 */

// ── Event type ────────────────────────────────────────────────────────────────

/**
 * A single calendar event: a scheduled job, a potential (placeholder) job,
 * or a schedule block (Travel Time, PTO, Custom).
 */
export type CalEvent = {
  kind: "job" | "potential" | "drive" | "pto" | "custom";
  start_time: string;       // ISO timestamp
  end_time: string | null;  // ISO timestamp
  // Job-specific (kind === "job")
  booking_id?: string;
  work_order_number?: string | null;
  customer_name?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  title?: string | null;         // WO type label
  booking_status?: string | null;
  notes?: string | null;         // Potential-job notes
  dispatcher_notes?: string | null; // Scheduled-job dispatcher notes
  equipment_names?: string[];
};

export type ReportTechnician = {
  technician_id: string;
  resource_name: string | null;
  user_email: string | null;
  events: CalEvent[];
};

export type CalendarReportData = {
  range_start: string;
  range_end: string;
  technicians: ReportTechnician[];
};

// ── Style configuration ───────────────────────────────────────────────────────

export type EventStyleConfig = {
  label: string;
  pdfBg: string;       // hex with #
  pdfBorder: string;   // hex with #
  pdfText: string;     // hex with #
  docxBg: string;      // 6-char hex, no #
  docxBorder: string;  // 6-char hex, no #
  dialogColor: string; // hex for the dialog badge dot
};

export const EVENT_STYLE_MAP: Record<CalEvent["kind"], EventStyleConfig> = {
  job:       { label: "Job",           pdfBg: "#eef4fa", pdfBorder: "#1e3a5f", pdfText: "#1a202c", docxBg: "EEF4FA", docxBorder: "1E3A5F", dialogColor: "#1e3a5f" },
  potential: { label: "Potential Job", pdfBg: "#fff7ed", pdfBorder: "#c2410c", pdfText: "#431407", docxBg: "FFF7ED", docxBorder: "C2410C", dialogColor: "#c2410c" },
  drive:     { label: "Travel Time",   pdfBg: "#f0fdf4", pdfBorder: "#15803d", pdfText: "#14532d", docxBg: "F0FDF4", docxBorder: "15803D", dialogColor: "#15803d" },
  pto:       { label: "PTO",           pdfBg: "#fdf4ff", pdfBorder: "#7e22ce", pdfText: "#3b0764", docxBg: "FDF4FF", docxBorder: "7E22CE", dialogColor: "#7e22ce" },
  custom:    { label: "Custom",        pdfBg: "#fefce8", pdfBorder: "#a16207", pdfText: "#713f12", docxBg: "FEFCE8", docxBorder: "A16207", dialogColor: "#a16207" },
};

export const EVENT_KINDS: ReadonlyArray<CalEvent["kind"]> = [
  "job", "potential", "drive", "pto", "custom",
];

/** Event kinds included in downloadable PDF and Word reports by default. */
export const EXPORT_EVENT_KINDS: ReadonlyArray<Exclude<CalEvent["kind"], "custom">> = [
  "job", "potential", "drive", "pto",
];

export function eventKindsForExport(includeCustomBlocks = false): ReadonlyArray<CalEvent["kind"]> {
  return includeCustomBlocks
    ? [...EXPORT_EVENT_KINDS, "custom"]
    : EXPORT_EVENT_KINDS;
}

export function eventsForExport(events: CalEvent[], includeCustomBlocks = false): CalEvent[] {
  return includeCustomBlocks
    ? events
    : events.filter((event) => event.kind !== "custom");
}

// ── API calls ─────────────────────────────────────────────────────────────────

export async function fetchCalendarReport(
  technicianIds: string[],
  startDate: string,
  endDate: string,
): Promise<CalendarReportData> {
  const params = new URLSearchParams({
    technician_ids: technicianIds.join(","),
    start_date: startDate,
    end_date: endDate,
  });
  const res = await fetch(`/api/wb/calendar-report?${params}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<CalendarReportData>;
}

/**
 * Payload for a single-technician email send.
 * The server resolves name and email from CRM using technician_id — never
 * trust client-supplied recipient addresses.
 */
export type EmailRecipient = {
  technician_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD (exclusive)
  pdf_base64: string;
};

export type EmailSendResult = {
  technician_id: string;
  technician_name: string;
  technician_email: string;
  success: boolean;
  error?: string;
};

/**
 * Send one email per call. The server resolves the recipient address from CRM
 * using `technician_id`. One PDF per HTTP call keeps each request under the
 * 5 MB limit.
 */
export async function sendCalendarReportEmail(
  recipient: EmailRecipient,
): Promise<EmailSendResult> {
  const res = await fetch("/api/wb/calendar-report/email", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipient),
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return body as EmailSendResult;
}

// ── Week / day helpers ────────────────────────────────────────────────────────

export type WeekDay = { iso: string; dayNum: number };

export type ReportWeek = {
  mondayISO: string;
  label: string;      // "Aug 3 – Aug 7"
  monthKey: string;   // "2026-08"
  monthLabel: string; // "August 2026"
  days: WeekDay[];    // exactly 5 (Mon–Fri)
};

function fmtShortISO(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Build Monday-based weeks (Mon–Fri only) spanning the given ISO date range. */
export function buildReportWeeks(startISO: string, endISO: string): ReportWeek[] {
  const weeks: ReportWeek[] = [];
  const start = new Date(startISO + "T00:00:00Z");
  // Snap back to the Monday of the week that contains startISO.
  const dow = start.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat
  start.setUTCDate(start.getUTCDate() - ((dow + 6) % 7));
  const end = new Date(endISO + "T00:00:00Z");

  for (
    let monday = new Date(start);
    monday < end;
    monday.setUTCDate(monday.getUTCDate() + 7)
  ) {
    const days: WeekDay[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + i);
      days.push({ iso: d.toISOString().slice(0, 10), dayNum: d.getUTCDate() });
    }
    const mondayISO = days[0].iso;
    const monthDate = new Date(mondayISO + "T00:00:00Z");
    weeks.push({
      mondayISO,
      label: `${fmtShortISO(mondayISO)} – ${fmtShortISO(days[4].iso)}`,
      monthKey: mondayISO.slice(0, 7),
      monthLabel: monthDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
      days,
    });
  }
  return weeks;
}

/** Return a technician's events that cover the given ISO date (multi-day events
 *  appear on every day they span, Mon–Fri), sorted by start_time.
 *
 *  Uses a half-open interval [start, end): an event covers `iso` when
 *  its start date ≤ iso AND its end instant is strictly after midnight UTC
 *  of `iso`.  This correctly handles both intra-day events (end same day)
 *  and exclusive-midnight end boundaries (e.g. PTO stored as Wed 00:00 UTC
 *  covers Mon–Tue only). */
export function eventsForDay(events: CalEvent[], iso: string): CalEvent[] {
  // Midnight UTC of the target date as milliseconds — the lower bound for end_time.
  const dayStartMs = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );

  return events
    .filter((e) => {
      if (!e.start_time) return false;
      const startDate = e.start_time.slice(0, 10);
      if (startDate > iso) return false; // event hasn't started on this day
      if (!e.end_time) return startDate === iso; // no end: only on start date
      // Half-open [start, end): end_time must be strictly after midnight of iso.
      return new Date(e.end_time).getTime() > dayStartMs;
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

// ── Month grouping (for dialog preview) ──────────────────────────────────────

export type MonthGroup = {
  key: string;   // "2026-08"
  label: string; // "August 2026"
  events: CalEvent[];
};

/** Group a technician's events by ISO month (YYYY-MM), preserving start_time order. */
export function groupEventsByMonth(events: CalEvent[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>();
  for (const ev of events) {
    if (!ev.start_time) continue;
    const key = ev.start_time.slice(0, 7);
    if (!map.has(key)) {
      const d = new Date(key + "-01T00:00:00Z");
      map.set(key, {
        key,
        label: d.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }),
        events: [],
      });
    }
    map.get(key)!.events.push(ev);
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// ── Event display helpers ─────────────────────────────────────────────────────

/** Primary display name for an event (customer, block title, or kind label). */
export function eventDisplayName(e: CalEvent): string {
  if (e.kind === "job") return e.customer_name ?? "—";
  if (e.kind === "potential") return e.customer_name ?? e.title ?? "Potential Job";
  return e.title ?? EVENT_STYLE_MAP[e.kind].label;
}

/**
 * Secondary info line for an event, or null if none.
 * Jobs → "WO-12345 · Springfield, IL, 62701"
 * Potential → "Springfield, IL, 62701"
 * Blocks → null
 */
export function eventSubline(e: CalEvent): string | null {
  if (e.kind === "job") {
    const loc = [e.city, e.state, e.postal_code].filter(Boolean).join(", ");
    const parts = [e.work_order_number, loc].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (e.kind === "potential") {
    return [e.city, e.state, e.postal_code].filter(Boolean).join(", ") || null;
  }
  return null;
}

/**
 * Lines shown inside downloadable report chips.
 * Scheduled jobs show customer, location, job number, and dispatcher notes.
 */
export function eventLines(e: CalEvent): string[] {
  if (e.kind === "job") {
    const lines = [
      e.customer_name ?? "—",
      [e.city, e.state, e.postal_code].filter(Boolean).join(", ") || "—",
      e.work_order_number ?? "—",
    ];
    if (e.dispatcher_notes?.trim()) {
      lines.push(`Dispatcher Notes: ${e.dispatcher_notes.trim()}`);
    }
    return lines;
  }

  const lines = [eventDisplayName(e)];
  const sub = eventSubline(e);
  if (sub) lines.push(sub);
  if (e.kind === "potential" && e.booking_status) lines.push(e.booking_status);
  if ((e.kind === "potential" || e.kind === "custom") && e.notes?.trim()) {
    lines.push(`Notes: ${e.notes.trim()}`);
  }
  return lines;
}

// ── Date / time formatters ────────────────────────────────────────────────────

/** Format an ISO timestamp to "10:30 AM". */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Format an ISO timestamp to "Mon Aug 15". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** YYYY-MM-DD → first day of that month as ISO string. */
export function monthStart(yearMonth: string): string {
  return `${yearMonth}-01`;
}

/** Add N calendar months to a YYYY-MM-DD string; returns YYYY-MM-DD. */
export function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
    .toISOString()
    .slice(0, 10);
}

/** Build a human-readable range label e.g. "Aug 2026 – Jan 2027".
 *  endIso is exclusive — displayed month is the one before it. */
export function buildDateRangeLabel(startIso: string, endIso: string): string {
  const s = new Date(startIso + "T00:00:00Z");
  const e = new Date(endIso + "T00:00:00Z");
  e.setUTCDate(e.getUTCDate() - 1);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return `${fmt(s)} – ${fmt(e)}`;
}
