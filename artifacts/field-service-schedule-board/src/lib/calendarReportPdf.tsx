/**
 * PDF generation for the technician calendar report.
 * Renders a stacked-weeks calendar grid (one row per week, Mon–Fri columns)
 * matching the board's single-technician Calendar View.
 * Includes scheduled jobs, potential jobs, Travel Time, and PTO by default;
 * Custom blocks can be included per report.
 */
import React from "react";
import { Document, Page, View, Text, StyleSheet, pdf } from "@react-pdf/renderer";
import type { ReportTechnician, CalEvent } from "./calendarReportApi";
import {
  buildReportWeeks,
  eventsForDay,
  eventLines,
  EVENT_STYLE_MAP,
  eventKindsForExport,
  eventsForExport,
} from "./calendarReportApi";

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(value: string, max: number): string {
  const s = (value ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

function isNoteLine(line: string): boolean {
  return line.startsWith("Dispatcher Notes:") || line.startsWith("Notes:");
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
    // Keep the exported report readable when printed or viewed as an email attachment.
    fontSize: 10,
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
  techName:    { fontSize: 17, fontFamily: "Helvetica-Bold", color: COL_BLUE },
  dateRange:   { fontSize: 10, color: COL_MUTED, marginTop: 2 },
  generatedAt: { fontSize: 10, color: COL_MUTED, textAlign: "right" },
  // ── Legend ───────────────────────────────────────────────────────────────
  legendRow:   { flexDirection: "row", gap: 12, marginBottom: 10, flexWrap: "wrap" },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 3 },
  legendSwatch: { width: 9, height: 9, borderRadius: 1 },
  legendLabel:  { fontSize: 9.5, color: COL_MUTED },
  // ── Month heading ─────────────────────────────────────────────────────────
  monthHeader:     { backgroundColor: COL_BLUE, paddingVertical: 5, paddingHorizontal: 8, marginTop: 12 },
  monthHeaderText: { color: "white", fontSize: 12, fontFamily: "Helvetica-Bold" },
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
    paddingVertical: 5,
    paddingLeft: 5,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  headDayCell: {
    flex: 1,
    paddingVertical: 5,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  headDayCellLast: { borderRight: "0" },
  headText: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: COL_BLUE, textAlign: "center" },
  headWeekText: { fontSize: 11.5, fontFamily: "Helvetica-Bold", color: COL_BLUE },
  // ── Week row ─────────────────────────────────────────────────────────────
  weekRow: {
    flexDirection: "row",
    borderBottom: `1pt solid ${COL_BORDER}`,
    borderLeft: `1pt solid ${COL_BORDER}`,
    borderRight: `1pt solid ${COL_BORDER}`,
    minHeight: 72,
  },
  weekLabelCell: {
    width: 74,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRight: `1pt solid ${COL_BORDER}`,
    backgroundColor: "#f8fafc",
  },
  weekLabel: { fontSize: 10, fontFamily: "Helvetica-Bold", color: "#334155" },
  dayCell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRight: `1pt solid ${COL_BORDER}`,
  },
  dayCellLast: { borderRight: "0" },
  dayNum: { fontSize: 9.5, color: COL_MUTED, marginBottom: 4 },
  // ── Event chip ────────────────────────────────────────────────────────────
  chip: { paddingVertical: 4, paddingHorizontal: 4, marginBottom: 4, borderRadius: 1 },
  chipName:     { fontSize: 11.5 },
  chipSubline:  { fontSize: 10.5, color: COL_MUTED },
  chipNote:     { fontSize: 8.5, color: COL_MUTED, lineHeight: 1.2 },
  // ── Page number ───────────────────────────────────────────────────────────
  pageNumber: { position: "absolute", bottom: 16, right: 26, fontSize: 9, color: COL_MUTED },
});

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

// ── Sub-components ────────────────────────────────────────────────────────────

function EventChip({ event }: { event: CalEvent }) {
  const s = EVENT_STYLE_MAP[event.kind];
  const lines = eventLines(event);
  return (
    <View style={[styles.chip, { backgroundColor: s.pdfBg, borderLeft: `2pt solid ${s.pdfBorder}` }]}>
      {lines.map((line, index) => (
        <Text
          key={index}
          style={
            isNoteLine(line)
              ? styles.chipNote
              : index === 0
                ? [styles.chipName, { color: s.pdfText }]
                : styles.chipSubline
          }
          wrap
        >
          {isNoteLine(line) ? line : truncate(line, index === 0 ? 26 : 30)}
        </Text>
      ))}
    </View>
  );
}

// ── Document component ────────────────────────────────────────────────────────

type TechPdfDocProps = {
  tech: ReportTechnician;
  dateRangeLabel: string;
  startDate: string;
  endDate: string;
  includeCustomBlocks: boolean;
};

function TechPdfDoc({
  tech,
  dateRangeLabel,
  startDate,
  endDate,
  includeCustomBlocks,
}: TechPdfDocProps) {
  const generatedAt = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const weeks = buildReportWeeks(startDate, endDate);
  const exportEvents = eventsForExport(tech.events, includeCustomBlocks);
  const exportKinds = eventKindsForExport(includeCustomBlocks);

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
          {exportKinds.map((k) => {
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
                   const dayEvents = eventsForDay(exportEvents, day.iso);
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

        {exportEvents.length === 0 && (
          <Text style={{ fontSize: 10, color: COL_MUTED, fontStyle: "italic", marginTop: 16 }}>
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
  includeCustomBlocks = false,
): Promise<Blob> {
  return pdf(
    <TechPdfDoc
      tech={tech}
      dateRangeLabel={dateRangeLabel}
      startDate={startDate}
      endDate={endDate}
      includeCustomBlocks={includeCustomBlocks}
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
