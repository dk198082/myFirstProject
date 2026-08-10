/**
 * PDF generation for the technician calendar report.
 * Renders a stacked-weeks calendar grid (one row per week, Mon–Fri columns)
 * matching the board's single-technician Calendar View.
 * Includes all event types: Jobs, Potential Jobs, Drive Time, PTO, Custom.
 */
import { Document, Page, View, Text, StyleSheet, pdf } from "@react-pdf/renderer";
import type { ReportTechnician, CalEvent } from "./calendarReportApi";
import {
  buildReportWeeks,
  eventsForDay,
  eventDisplayName,
  eventSubline,
  EVENT_STYLE_MAP,
  EVENT_KINDS,
  fmtTime,
} from "./calendarReportApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(value: string, max: number): string {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function timeLine(e: CalEvent): string {
  const s = fmtTime(e.start_time);
  const end = fmtTime(e.end_time);
  return s && end ? `${s} – ${end}` : s || end || "";
}

// ── Styles ────────────────────────────────────────────────────────────────────

const COL_BLUE   = "#1e3a5f";
const COL_LIGHT  = "#e8f0f7";
const COL_BORDER = "#cbd5e1";
const COL_MUTED  = "#64748b";

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 34,
    paddingLeft: 26,
    paddingRight: 26,
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#1a202c",
  },
  // ── Page header ──────────────────────────────────────────────────────────
  pageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: `2pt solid ${COL_BLUE}`,
  },
  techName:    { fontSize: 15, fontFamily: "Helvetica-Bold", color: COL_BLUE },
  dateRange:   { fontSize: 9,  color: COL_MUTED, marginTop: 2 },
  generatedAt: { fontSize: 8,  color: COL_MUTED, textAlign: "right" },
  // ── Legend ───────────────────────────────────────────────────────────────
  legendRow:   { flexDirection: "row", gap: 10, marginBottom: 8, flexWrap: "wrap" },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 3 },
  legendSwatch: { width: 8, height: 8, borderRadius: 1 },
  legendLabel:  { fontSize: 7, color: COL_MUTED },
  // ── Month heading ─────────────────────────────────────────────────────────
  monthHeader:     { backgroundColor: COL_BLUE, paddingVertical: 4, paddingHorizontal: 8, marginTop: 10 },
  monthHeaderText: { color: "white", fontSize: 10, fontFamily: "Helvetica-Bold" },
  // ── Day-name header row ───────────────────────────────────────────────────
  headRow: {
    flexDirection: "row",
    backgroundColor: COL_LIGHT,
    borderBottom: `1pt solid ${COL_BORDER}`,
    borderLeft: `1pt solid ${COL_BORDER}`,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  headWeekCell: {
    width: 74,
    paddingVertical: 4,
    paddingLeft: 5,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  headDayCell: {
    flex: 1,
    paddingVertical: 4,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  headDayCellLast: { borderRight: "0" },
  headText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COL_BLUE, textAlign: "center" },
  headWeekText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COL_BLUE },
  // ── Week row ─────────────────────────────────────────────────────────────
  weekRow: {
    flexDirection: "row",
    borderBottom: `1pt solid ${COL_BORDER}`,
    borderLeft: `1pt solid ${COL_BORDER}`,
    borderRight: `1pt solid ${COL_BORDER}`,
    minHeight: 52,
  },
  weekLabelCell: {
    width: 74,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRight: `1pt solid ${COL_BORDER}`,
    backgroundColor: "#f8fafc",
  },
  weekLabel: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#334155" },
  dayCell: {
    flex: 1,
    paddingVertical: 3,
    paddingHorizontal: 3,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  dayCellLast: { borderRight: "0" },
  dayNum: { fontSize: 6.5, color: COL_MUTED, marginBottom: 2 },
  // ── Event chip ────────────────────────────────────────────────────────────
  chip: { paddingVertical: 2, paddingHorizontal: 3, marginBottom: 2, borderRadius: 1 },
  chipKind:     { fontSize: 5.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.2, marginBottom: 1 },
  chipTime:     { fontSize: 6.5, fontFamily: "Helvetica-Bold" },
  chipName:     { fontSize: 7 },
  chipSubline:  { fontSize: 6, color: COL_MUTED },
  // ── Page number ───────────────────────────────────────────────────────────
  pageNumber: { position: "absolute", bottom: 16, right: 26, fontSize: 8, color: COL_MUTED },
});

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function EventChip({ event }: { event: CalEvent }) {
  const s = EVENT_STYLE_MAP[event.kind];
  const sub = eventSubline(event);
  const name = truncate(eventDisplayName(event), 26);
  const time = timeLine(event);
  return (
    <View style={[styles.chip, { backgroundColor: s.pdfBg, borderLeft: `2pt solid ${s.pdfBorder}` }]}>
      <Text style={[styles.chipKind, { color: s.pdfBorder }]} wrap={false}>
        {s.label.toUpperCase()}
      </Text>
      {time ? (
        <Text style={[styles.chipTime, { color: s.pdfBorder }]} wrap={false}>{time}</Text>
      ) : null}
      <Text style={[styles.chipName, { color: s.pdfText }]} wrap={false}>{name}</Text>
      {sub ? (
        <Text style={styles.chipSubline} wrap={false}>{truncate(sub, 30)}</Text>
      ) : null}
    </View>
  );
}

// ── Document component ────────────────────────────────────────────────────────

type TechPdfDocProps = {
  tech: ReportTechnician;
  dateRangeLabel: string;
  startDate: string;
  endDate: string;
};

function TechPdfDoc({ tech, dateRangeLabel, startDate, endDate }: TechPdfDocProps) {
  const generatedAt = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const weeks = buildReportWeeks(startDate, endDate);

  let lastMonth = "";

  return (
    <Document
      title={`Schedule – ${tech.resource_name ?? "Technician"}`}
      author="Field Service Coordination"
    >
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        {/* Page header */}
        <View style={styles.pageHeader} fixed>
          <View>
            <Text style={styles.techName}>{tech.resource_name ?? "Technician"}</Text>
            <Text style={styles.dateRange}>Field Service Schedule — {dateRangeLabel}</Text>
          </View>
          <Text style={styles.generatedAt}>Generated {generatedAt}</Text>
        </View>

        {/* Legend */}
        <View style={styles.legendRow}>
          {EVENT_KINDS.map((k) => {
            const s = EVENT_STYLE_MAP[k];
            return (
              <View key={k} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendSwatch,
                    { backgroundColor: s.pdfBg, border: `1pt solid ${s.pdfBorder}` },
                  ]}
                />
                <Text style={styles.legendLabel}>{s.label}</Text>
              </View>
            );
          })}
        </View>

        {/* Calendar grid — one block per week, kept whole across page breaks */}
        {weeks.map((week) => {
          const isNewMonth = week.monthKey !== lastMonth;
          lastMonth = week.monthKey;
          return (
            <View key={week.mondayISO} wrap={false}>
              {isNewMonth && (
                <>
                  <View style={styles.monthHeader}>
                    <Text style={styles.monthHeaderText}>{week.monthLabel}</Text>
                  </View>
                  {/* Column headers — repeated for each month section */}
                  <View style={styles.headRow}>
                    <View style={styles.headWeekCell}>
                      <Text style={styles.headWeekText}>WEEK</Text>
                    </View>
                    {DAY_NAMES.map((d, i) => (
                      <View
                        key={d}
                        style={[styles.headDayCell, i === 4 ? styles.headDayCellLast : {}]}
                      >
                        <Text style={styles.headText}>{d.toUpperCase()}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}

              {/* Week row */}
              <View style={styles.weekRow}>
                <View style={styles.weekLabelCell}>
                  <Text style={styles.weekLabel}>{week.label}</Text>
                </View>
                {week.days.map((day, i) => {
                  const dayEvents = eventsForDay(tech.events, day.iso);
                  return (
                    <View
                      key={day.iso}
                      style={[styles.dayCell, i === 4 ? styles.dayCellLast : {}]}
                    >
                      <Text style={styles.dayNum}>{day.dayNum}</Text>
                      {dayEvents.map((ev, ei) => (
                        <EventChip key={ei} event={ev} />
                      ))}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        {tech.events.length === 0 && (
          <Text style={{ fontSize: 9, color: COL_MUTED, fontStyle: "italic", marginTop: 16 }}>
            No scheduled activity in this period.
          </Text>
        )}

        {/* Page number */}
        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate a PDF Blob for a single technician. */
export async function generateTechPdf(
  tech: ReportTechnician,
  dateRangeLabel: string,
  startDate: string,
  endDate: string,
): Promise<Blob> {
  return pdf(
    <TechPdfDoc
      tech={tech}
      dateRangeLabel={dateRangeLabel}
      startDate={startDate}
      endDate={endDate}
    />,
  ).toBlob();
}

/** Convert a Blob to a base64 string (for email attachment). */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // result is "data:application/pdf;base64,<content>" — strip the prefix
      resolve(result.split(",")[1] ?? result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
