/**
 * One-off generator for SAMPLE Calendar Report files in the proposed
 * stacked-weeks layout (mirrors the board's single-technician Calendar View).
 * Produces a PDF and a Word doc with mock data for coordinator review.
 * Includes all event types: Scheduled Jobs, Potential Jobs, Drive Time, PTO,
 * and Custom blocks.
 *
 * Run: pnpm exec tsx scripts/sampleCalendarReport.tsx
 */
import React from "react";
import path from "path";
import fs from "fs";
import { Document, Page, View, Text, StyleSheet, renderToFile } from "@react-pdf/renderer";
import {
  Document as DocxDocument,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
  AlignmentType,
  WidthType,
  BorderStyle,
  ShadingType,
  TableLayoutType,
  VerticalAlign,
  PageOrientation,
} from "docx";

// ── Event types ───────────────────────────────────────────────────────────────

type EventKind = "job" | "potential" | "drive" | "pto" | "custom";

type CalEvent = {
  dateISO: string;
  start: string;
  end: string;
  kind: EventKind;
  // jobs / potential jobs
  customer?: string;
  wo?: string;
  city?: string;
  // blocks
  title?: string;
};

// ── Mock data ─────────────────────────────────────────────────────────────────

const TECH_NAME = "Alex Carter";
const RANGE_LABEL = "August – September 2026";
const RANGE_START = "2026-08-03";
const RANGE_END   = "2026-09-27";

const MOCK_EVENTS: CalEvent[] = [
  // ── August week 1 (Aug 3–7) ──────────────────────────────────────────────
  { dateISO: "2026-08-03", start: "8:00 AM",  end: "12:00 PM", kind: "job",       customer: "Northside Medical Center",              wo: "WO-10412", city: "Springfield, IL" },
  { dateISO: "2026-08-03", start: "1:30 PM",  end: "4:30 PM",  kind: "job",       customer: "Lakeview Dental Group",                 wo: "WO-10418", city: "Springfield, IL" },
  { dateISO: "2026-08-04", start: "7:00 AM",  end: "8:00 AM",  kind: "drive",     title: "Drive Time" },
  { dateISO: "2026-08-04", start: "9:00 AM",  end: "3:00 PM",  kind: "job",       customer: "Prairie Foods Processing",              wo: "WO-10395", city: "Decatur, IL" },
  { dateISO: "2026-08-05", start: "8:00 AM",  end: "5:00 PM",  kind: "potential", customer: "Summit Ridge Warehousing",              city: "Peoria, IL" },
  { dateISO: "2026-08-06", start: "7:30 AM",  end: "11:30 AM", kind: "job",       customer: "Heartland Community College",           wo: "WO-10422", city: "Normal, IL" },
  { dateISO: "2026-08-06", start: "1:00 PM",  end: "5:00 PM",  kind: "job",       customer: "Vista Ridge Apartments",               wo: "WO-10430", city: "Bloomington, IL" },
  { dateISO: "2026-08-07", start: "8:00 AM",  end: "10:00 AM", kind: "job",       customer: "Grand Prairie Bank & Trust Ops Center", wo: "WO-10433", city: "Champaign, IL" },
  { dateISO: "2026-08-07", start: "11:00 AM", end: "12:00 PM", kind: "drive",     title: "Drive Time" },

  // ── August week 2 (Aug 10–14) ────────────────────────────────────────────
  { dateISO: "2026-08-11", start: "8:30 AM",  end: "12:30 PM", kind: "job",       customer: "Midwest Logistics Hub",               wo: "WO-10440", city: "Peoria, IL" },
  { dateISO: "2026-08-12", start: "10:00 AM", end: "2:00 PM",  kind: "job",       customer: "Cedar Creek Assisted Living",         wo: "WO-10444", city: "Morton, IL" },
  { dateISO: "2026-08-13", start: "8:00 AM",  end: "4:00 PM",  kind: "job",       customer: "Illini Steel Fabricators",            wo: "WO-10390", city: "Urbana, IL" },
  { dateISO: "2026-08-14", start: "9:00 AM",  end: "11:00 AM", kind: "job",       customer: "Northside Medical Center",            wo: "WO-10451", city: "Springfield, IL" },
  { dateISO: "2026-08-14", start: "1:00 PM",  end: "4:00 PM",  kind: "potential", customer: "Bluegrass Industrial Supply",         city: "Bloomington, IL" },

  // ── August week 3 (Aug 17–21) ────────────────────────────────────────────
  { dateISO: "2026-08-18", start: "7:00 AM",  end: "3:00 PM",  kind: "job",       customer: "Prairie Foods Processing",            wo: "WO-10455", city: "Decatur, IL" },
  { dateISO: "2026-08-19", start: "8:00 AM",  end: "5:00 PM",  kind: "pto",       title: "PTO" },
  { dateISO: "2026-08-20", start: "8:00 AM",  end: "12:00 PM", kind: "job",       customer: "River Bend Utilities",               wo: "WO-10457", city: "Pekin, IL" },
  { dateISO: "2026-08-21", start: "1:00 PM",  end: "4:00 PM",  kind: "job",       customer: "Lakeview Dental Group",              wo: "WO-10460", city: "Springfield, IL" },

  // ── August week 4 (Aug 24–28) ────────────────────────────────────────────
  { dateISO: "2026-08-25", start: "8:00 AM",  end: "5:00 PM",  kind: "job",       customer: "Heartland Community College",         wo: "WO-10465", city: "Normal, IL" },
  { dateISO: "2026-08-26", start: "8:00 AM",  end: "5:00 PM",  kind: "custom",    title: "Safety Training" },
  { dateISO: "2026-08-27", start: "9:30 AM",  end: "12:30 PM", kind: "job",       customer: "Vista Ridge Apartments",             wo: "WO-10470", city: "Bloomington, IL" },
  { dateISO: "2026-08-27", start: "2:00 PM",  end: "4:30 PM",  kind: "potential", customer: "Clearwater Data Center",             city: "Normal, IL" },

  // ── Aug 31 – Sep 4 ───────────────────────────────────────────────────────
  { dateISO: "2026-09-01", start: "8:00 AM",  end: "12:00 PM", kind: "job",       customer: "Midwest Logistics Hub",              wo: "WO-10488", city: "Peoria, IL" },
  { dateISO: "2026-09-02", start: "1:00 PM",  end: "5:00 PM",  kind: "job",       customer: "Cedar Creek Assisted Living",        wo: "WO-10491", city: "Morton, IL" },
  { dateISO: "2026-09-04", start: "8:00 AM",  end: "10:30 AM", kind: "job",       customer: "Grand Prairie Bank & Trust",         wo: "WO-10495", city: "Champaign, IL" },

  // ── September week 2 (Sep 7–11) ──────────────────────────────────────────
  { dateISO: "2026-09-08", start: "7:30 AM",  end: "3:30 PM",  kind: "job",       customer: "Illini Steel Fabricators",           wo: "WO-10500", city: "Urbana, IL" },
  { dateISO: "2026-09-09", start: "8:00 AM",  end: "5:00 PM",  kind: "pto",       title: "PTO" },
  { dateISO: "2026-09-10", start: "9:00 AM",  end: "1:00 PM",  kind: "job",       customer: "Northside Medical Center",           wo: "WO-10505", city: "Springfield, IL" },
  { dateISO: "2026-09-11", start: "2:00 PM",  end: "4:00 PM",  kind: "job",       customer: "River Bend Utilities",              wo: "WO-10508", city: "Pekin, IL" },

  // ── September week 3 (Sep 14–18) ─────────────────────────────────────────
  { dateISO: "2026-09-15", start: "8:00 AM",  end: "12:00 PM", kind: "job",       customer: "Prairie Foods Processing",           wo: "WO-10512", city: "Decatur, IL" },
  { dateISO: "2026-09-16", start: "8:00 AM",  end: "12:00 PM", kind: "drive",     title: "Drive Time" },
  { dateISO: "2026-09-16", start: "1:00 PM",  end: "4:00 PM",  kind: "potential", customer: "Ironwood Packaging Co.",             city: "Peoria, IL" },
  { dateISO: "2026-09-17", start: "8:00 AM",  end: "4:00 PM",  kind: "job",       customer: "Heartland Community College",        wo: "WO-10515", city: "Normal, IL" },

  // ── September week 4 (Sep 21–25) ─────────────────────────────────────────
  { dateISO: "2026-09-22", start: "9:00 AM",  end: "11:00 AM", kind: "job",       customer: "Lakeview Dental Group",             wo: "WO-10520", city: "Springfield, IL" },
  { dateISO: "2026-09-23", start: "8:00 AM",  end: "5:00 PM",  kind: "custom",    title: "Equipment Recertification" },
  { dateISO: "2026-09-24", start: "1:00 PM",  end: "5:00 PM",  kind: "job",       customer: "Vista Ridge Apartments",            wo: "WO-10524", city: "Bloomington, IL" },
];

// ── Event styling config ──────────────────────────────────────────────────────

type EventStyle = {
  label: string;
  bg: string;       // hex for PDF
  border: string;   // hex for PDF
  textColor: string;
  docxBg: string;   // 6-char hex for docx
  docxBorder: string;
};

const EVENT_STYLES: Record<EventKind, EventStyle> = {
  job:       { label: "Job",           bg: "#eef4fa", border: "#1e3a5f", textColor: "#1a202c", docxBg: "EEF4FA", docxBorder: "1E3A5F" },
  potential: { label: "Potential Job", bg: "#fff7ed", border: "#c2410c", textColor: "#431407", docxBg: "FFF7ED", docxBorder: "C2410C" },
  drive:     { label: "Drive Time",    bg: "#f0fdf4", border: "#15803d", textColor: "#14532d", docxBg: "F0FDF4", docxBorder: "15803D" },
  pto:       { label: "PTO",           bg: "#fdf4ff", border: "#7e22ce", textColor: "#3b0764", docxBg: "FDF4FF", docxBorder: "7E22CE" },
  custom:    { label: "Custom",        bg: "#fefce8", border: "#a16207", textColor: "#713f12", docxBg: "FEFCE8", docxBorder: "A16207" },
};

// ── Week grouping (Mon–Fri) ───────────────────────────────────────────────────

type WeekDay = { iso: string; dayNum: number };
type Week = {
  mondayISO: string;
  label: string;
  monthKey: string;
  monthLabel: string;
  days: WeekDay[];
};

function fmtShort(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

function buildWeeks(startISO: string, endISO: string): Week[] {
  const weeks: Week[] = [];
  const start = new Date(startISO + "T00:00:00Z");
  const dow = start.getUTCDay();
  start.setUTCDate(start.getUTCDate() - ((dow + 6) % 7));
  const end = new Date(endISO + "T00:00:00Z");
  for (let monday = new Date(start); monday < end; monday.setUTCDate(monday.getUTCDate() + 7)) {
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
      label: `${fmtShort(mondayISO)} – ${fmtShort(days[4].iso)}`,
      monthKey: mondayISO.slice(0, 7),
      monthLabel: monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      days,
    });
  }
  return weeks;
}

function eventsFor(iso: string): CalEvent[] {
  return MOCK_EVENTS
    .filter((e) => e.dateISO === iso)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function truncate(v: string, max: number): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function eventLabel(e: CalEvent): string {
  if (e.kind === "job" || e.kind === "potential") {
    return e.customer ?? e.title ?? EVENT_STYLES[e.kind].label;
  }
  return e.title ?? EVENT_STYLES[e.kind].label;
}

function eventSubline(e: CalEvent): string | null {
  if (e.kind === "job" && e.wo) {
    return `${e.wo}${e.city ? " · " + e.city : ""}`;
  }
  if (e.kind === "potential" && e.city) return e.city;
  return null;
}

const WEEKS = buildWeeks(RANGE_START, RANGE_END);
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

// ── PDF ───────────────────────────────────────────────────────────────────────

const COL_BLUE   = "#1e3a5f";
const COL_LIGHT  = "#e8f0f7";
const COL_BORDER = "#cbd5e1";
const COL_MUTED  = "#64748b";

const styles = StyleSheet.create({
  page: {
    paddingTop: 32, paddingBottom: 34, paddingLeft: 26, paddingRight: 26,
    fontSize: 8, fontFamily: "Helvetica", color: "#1a202c",
  },
  pageHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end",
    marginBottom: 12, paddingBottom: 8, borderBottom: `2pt solid ${COL_BLUE}`,
  },
  techName:    { fontSize: 15, fontFamily: "Helvetica-Bold", color: COL_BLUE },
  dateRange:   { fontSize: 9,  color: COL_MUTED, marginTop: 2 },
  generatedAt: { fontSize: 8,  color: COL_MUTED, textAlign: "right" },
  sampleBadge: { fontSize: 8,  color: "#b45309", fontFamily: "Helvetica-Bold", marginTop: 2, textAlign: "right" },
  // Legend
  legendRow:   { flexDirection: "row", gap: 10, marginBottom: 10, flexWrap: "wrap" },
  legendItem:  { flexDirection: "row", alignItems: "center", gap: 3 },
  legendSwatch: { width: 8, height: 8, borderRadius: 1 },
  legendLabel: { fontSize: 7, color: COL_MUTED },
  // Month
  monthHeader:     { backgroundColor: COL_BLUE, paddingVertical: 4, paddingHorizontal: 8, marginTop: 10 },
  monthHeaderText: { color: "white", fontSize: 10, fontFamily: "Helvetica-Bold" },
  // Grid
  headRow:  { flexDirection: "row", backgroundColor: COL_LIGHT, borderBottom: `1pt solid ${COL_BORDER}`, borderLeft: `1pt solid ${COL_BORDER}`, borderRight: `1pt solid ${COL_BORDER}` },
  weekRow:  { flexDirection: "row", borderBottom: `1pt solid ${COL_BORDER}`, borderLeft: `1pt solid ${COL_BORDER}`, borderRight: `1pt solid ${COL_BORDER}`, minHeight: 52 },
  weekCol:  { width: 74, paddingVertical: 3, paddingHorizontal: 4, borderRight: `1pt solid ${COL_BORDER}`, backgroundColor: "#f8fafc", justifyContent: "flex-start" },
  dayCol:   { flex: 1, paddingVertical: 3, paddingHorizontal: 3, borderRight: `1pt solid ${COL_BORDER}` },
  dayColLast: { borderRight: "0" },
  headCellText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COL_BLUE, textAlign: "center", paddingVertical: 4 },
  headWeekText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: COL_BLUE, paddingVertical: 4, paddingLeft: 4 },
  weekLabel:    { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#334155" },
  dayNum:       { fontSize: 6.5, color: COL_MUTED, marginBottom: 2 },
  eventEntry:   { paddingVertical: 2, paddingHorizontal: 3, marginBottom: 2, borderRadius: 1 },
  eventKind:    { fontSize: 5.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 1 },
  eventTime:    { fontSize: 6.5, fontFamily: "Helvetica-Bold" },
  eventName:    { fontSize: 7 },
  eventMeta:    { fontSize: 6, color: COL_MUTED },
  pageNumber:   { position: "absolute", bottom: 16, right: 26, fontSize: 8, color: COL_MUTED },
});

function LegendItem({ kind }: { kind: EventKind }) {
  const s = EVENT_STYLES[kind];
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: s.bg, border: `1pt solid ${s.border}` }]} />
      <Text style={styles.legendLabel}>{s.label}</Text>
    </View>
  );
}

function EventChip({ event }: { event: CalEvent }) {
  const s = EVENT_STYLES[event.kind];
  const sub = eventSubline(event);
  return (
    <View style={[styles.eventEntry, { backgroundColor: s.bg, borderLeft: `2pt solid ${s.border}` }]}>
      <Text style={[styles.eventKind, { color: s.border }]} wrap={false}>{s.label}</Text>
      <Text style={[styles.eventTime, { color: s.border }]} wrap={false}>{event.start} – {event.end}</Text>
      <Text style={[styles.eventName, { color: s.textColor }]} wrap={false}>{truncate(eventLabel(event), 26)}</Text>
      {sub && <Text style={styles.eventMeta} wrap={false}>{truncate(sub, 30)}</Text>}
    </View>
  );
}

function SamplePdf() {
  const generatedAt = new Date("2026-08-07T12:00:00Z").toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
  let lastMonth = "";
  return (
    <Document title={`Schedule – ${TECH_NAME} (SAMPLE)`} author="Field Service Coordination">
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        {/* Page header */}
        <View style={styles.pageHeader} fixed>
          <View>
            <Text style={styles.techName}>{TECH_NAME}</Text>
            <Text style={styles.dateRange}>Field Service Schedule — {RANGE_LABEL}</Text>
          </View>
          <View>
            <Text style={styles.generatedAt}>Generated {generatedAt}</Text>
            <Text style={styles.sampleBadge}>SAMPLE — mock data for review</Text>
          </View>
        </View>

        {/* Legend */}
        <View style={styles.legendRow}>
          {(["job", "potential", "drive", "pto", "custom"] as EventKind[]).map((k) => (
            <LegendItem key={k} kind={k} />
          ))}
        </View>

        {/* Calendar grid */}
        {WEEKS.map((week) => {
          const isNewMonth = week.monthKey !== lastMonth;
          lastMonth = week.monthKey;
          return (
            <View key={week.mondayISO} wrap={false}>
              {isNewMonth && (
                <>
                  <View style={styles.monthHeader}>
                    <Text style={styles.monthHeaderText}>{week.monthLabel}</Text>
                  </View>
                  <View style={styles.headRow}>
                    <View style={styles.weekCol}>
                      <Text style={styles.headWeekText}>WEEK</Text>
                    </View>
                    {DAY_NAMES.map((d, i) => (
                      <View key={d} style={[styles.dayCol, i === 4 ? styles.dayColLast : {}]}>
                        <Text style={styles.headCellText}>{d.toUpperCase()}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
              <View style={styles.weekRow}>
                <View style={styles.weekCol}>
                  <Text style={styles.weekLabel}>{week.label}</Text>
                </View>
                {week.days.map((day, i) => {
                  const events = eventsFor(day.iso);
                  return (
                    <View key={day.iso} style={[styles.dayCol, i === 4 ? styles.dayColLast : {}]}>
                      <Text style={styles.dayNum}>{day.dayNum}</Text>
                      {events.map((ev, ei) => <EventChip key={ei} event={ev} />)}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

        <Text
          style={styles.pageNumber}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

// ── Word ──────────────────────────────────────────────────────────────────────

const BLUE_DOCX = "1E3A5F";
const LIGHT_DOCX = "E8F0F7";
const BORDER_HEX = "CBD5E1";

function tableBorders() {
  return {
    top:    { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
    left:   { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
    right:  { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
  };
}

function dayHeaderCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: LIGHT_DOCX },
    borders: tableBorders(),
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 15, color: BLUE_DOCX })],
    })],
  });
}

function weekLabelCell(text: string, header = false): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: header ? LIGHT_DOCX : "F8FAFC" },
    borders: tableBorders(),
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: header ? 15 : 14, color: header ? BLUE_DOCX : "334155" })],
    })],
  });
}

function eventParas(ev: CalEvent): Paragraph[] {
  const s = EVENT_STYLES[ev.kind];
  const sub = eventSubline(ev);
  return [
    new Paragraph({
      shading: { type: ShadingType.SOLID, color: s.docxBg },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: s.docxBorder } },
      spacing: { before: 40, after: 20 },
      indent: { left: 80 },
      children: [
        new TextRun({ text: s.label.toUpperCase() + "  ", size: 11, bold: true, color: s.docxBorder }),
        new TextRun({ text: `${ev.start} – ${ev.end}`, size: 13, bold: true, color: s.docxBorder }),
      ],
    }),
    new Paragraph({
      indent: { left: 80 },
      spacing: { after: sub ? 0 : 40 },
      children: [new TextRun({ text: truncate(eventLabel(ev), 32), size: 14, color: "1A202C" })],
    }),
    ...(sub ? [new Paragraph({
      indent: { left: 80 },
      spacing: { after: 40 },
      children: [new TextRun({ text: truncate(sub, 36), size: 12, color: "64748B" })],
    })] : []),
  ];
}

function dayCell(day: WeekDay): TableCell {
  const events = eventsFor(day.iso);
  const paras: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: String(day.dayNum), size: 12, color: "94A3B8" })],
      spacing: { after: 20 },
    }),
    ...events.flatMap((ev) => eventParas(ev)),
  ];
  return new TableCell({
    borders: tableBorders(),
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    children: paras,
  });
}

async function buildDocx(): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // Document header
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: TECH_NAME, color: BLUE_DOCX, size: 34, bold: true })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `Field Service Schedule — ${RANGE_LABEL}`, size: 20, color: "64748B" })],
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "SAMPLE — mock data for coordinator review", size: 16, color: "B45309", bold: true, italics: true })],
      spacing: { after: 160 },
    }),
    // Legend
    new Paragraph({
      children: (["job", "potential", "drive", "pto", "custom"] as EventKind[]).flatMap((k, i) => {
        const s = EVENT_STYLES[k];
        return [
          new TextRun({ text: "■ ", color: s.docxBorder, size: 14 }),
          new TextRun({ text: s.label + (i < 4 ? "   " : ""), size: 14, color: "64748B" }),
        ];
      }),
      spacing: { after: 240 },
    }),
  );

  // Group weeks by month
  const byMonth = new Map<string, { label: string; weeks: Week[] }>();
  for (const w of WEEKS) {
    const entry = byMonth.get(w.monthKey) ?? { label: w.monthLabel, weeks: [] };
    entry.weeks.push(w);
    byMonth.set(w.monthKey, entry);
  }

  for (const { label, weeks } of byMonth.values()) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: label, color: "FFFFFF", size: 22, bold: true })],
        shading: { type: ShadingType.SOLID, color: BLUE_DOCX },
        spacing: { before: 280, after: 0 },
      }),
    );

    const headerRow = new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: [weekLabelCell("Week", true), ...DAY_NAMES.map((d) => dayHeaderCell(d))],
    });

    const rows = weeks.map((w) =>
      new TableRow({
        cantSplit: true,
        children: [weekLabelCell(w.label), ...w.days.map((d) => dayCell(d))],
      }),
    );

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        columnWidths: [1700, 2540, 2540, 2540, 2540, 2540],
        rows: [headerRow, ...rows],
      }),
      new Paragraph({ children: [] }),
    );
  }

  const doc = new DocxDocument({
    sections: [{
      properties: {
        page: {
          size: { width: 15840, height: 12240, orientation: PageOrientation.LANDSCAPE },
          margin: { top: 620, bottom: 620, left: 620, right: 620 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const outDir = path.resolve(import.meta.dirname, "../../../attached_assets/calendar-report-samples");
  fs.mkdirSync(outDir, { recursive: true });

  const pdfPath = path.join(outDir, "SAMPLE_Schedule_Alex_Carter_Aug-Sep_2026.pdf");
  await renderToFile(<SamplePdf />, pdfPath);
  console.log("PDF written:", pdfPath);

  const docxPath = path.join(outDir, "SAMPLE_Schedule_Alex_Carter_Aug-Sep_2026.docx");
  fs.writeFileSync(docxPath, await buildDocx());
  console.log("DOCX written:", docxPath);
}

main().catch((err) => { console.error(err); process.exit(1); });
