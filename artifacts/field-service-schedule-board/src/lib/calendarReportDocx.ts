/**
 * Word (.docx) generation for the technician calendar report.
 * Renders a stacked-weeks calendar grid (one row per week, Mon–Fri columns)
 * matching the board's single-technician Calendar View.
 * Includes all event types: Jobs, Potential Jobs, Drive Time, PTO, Custom.
 */
import {
  Document,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  Packer,
  HeadingLevel,
  AlignmentType,
  WidthType,
  TableLayoutType,
  BorderStyle,
  ShadingType,
  VerticalAlign,
  PageOrientation,
} from "docx";
import type { ReportTechnician, CalEvent, ReportWeek } from "./calendarReportApi";
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

const BORDER_HEX = "CBD5E1";
const BLUE = "1E3A5F";
const LIGHT_BLUE = "E8F0F7";

function cellBorders() {
  return {
    top:    { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
    left:   { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
    right:  { style: BorderStyle.SINGLE, size: 1, color: BORDER_HEX },
  };
}

// ── Cell builders ─────────────────────────────────────────────────────────────

function weekLabelHeaderCell(): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: LIGHT_BLUE },
    borders: cellBorders(),
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        children: [new TextRun({ text: "Week", bold: true, size: 15, color: BLUE })],
      }),
    ],
  });
}

function dayNameHeaderCell(name: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: LIGHT_BLUE },
    borders: cellBorders(),
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: name, bold: true, size: 15, color: BLUE })],
      }),
    ],
  });
}

function weekLabelCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: "F8FAFC" },
    borders: cellBorders(),
    margins: { top: 40, bottom: 40, left: 60, right: 60 },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 14, color: "334155" })],
      }),
    ],
  });
}

function eventParagraphs(ev: CalEvent): Paragraph[] {
  const s = EVENT_STYLE_MAP[ev.kind];
  const time = timeLine(ev);
  const name = truncate(eventDisplayName(ev), 32);
  const sub = eventSubline(ev);

  const paras: Paragraph[] = [];

  // Kind + time on one shaded line
  paras.push(
    new Paragraph({
      shading: { type: ShadingType.SOLID, color: s.docxBg },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: s.docxBorder } },
      spacing: { before: 40, after: 0 },
      indent: { left: 60 },
      children: [
        new TextRun({ text: s.label.toUpperCase() + "  ", size: 11, bold: true, color: s.docxBorder }),
        ...(time ? [new TextRun({ text: time, size: 13, bold: true, color: s.docxBorder })] : []),
      ],
    }),
  );

  // Customer / title
  paras.push(
    new Paragraph({
      indent: { left: 60 },
      spacing: { after: sub ? 0 : 40 },
      shading: { type: ShadingType.SOLID, color: s.docxBg },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: s.docxBorder } },
      children: [new TextRun({ text: name, size: 14, color: "1A202C" })],
    }),
  );

  // Subline (WO / city)
  if (sub) {
    paras.push(
      new Paragraph({
        indent: { left: 60 },
        spacing: { after: 40 },
        shading: { type: ShadingType.SOLID, color: s.docxBg },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: s.docxBorder } },
        children: [new TextRun({ text: truncate(sub, 36), size: 12, color: "64748B" })],
      }),
    );
  }

  return paras;
}

function dayCell(events: CalEvent[], dayNum: number): TableCell {
  const paras: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: String(dayNum), size: 12, color: "94A3B8" })],
      spacing: { after: 20 },
    }),
    ...events.flatMap((ev) => eventParagraphs(ev)),
  ];
  return new TableCell({
    borders: cellBorders(),
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    children: paras,
  });
}

// ── Table builder ─────────────────────────────────────────────────────────────

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

function buildWeekTable(weeks: ReportWeek[], allEvents: CalEvent[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      weekLabelHeaderCell(),
      ...DAY_NAMES.map((d) => dayNameHeaderCell(d)),
    ],
  });

  const dataRows = weeks.map(
    (week) =>
      new TableRow({
        cantSplit: true,
        children: [
          weekLabelCell(week.label),
          ...week.days.map((day) =>
            dayCell(eventsForDay(allEvents, day.iso), day.dayNum),
          ),
        ],
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    // Landscape LETTER minus 1.25" margins = ~13,750 twips total;
    // 1,700 for week label + 5 × 2,410 for day columns = 13,750
    columnWidths: [1700, 2410, 2410, 2410, 2410, 2410],
    rows: [headerRow, ...dataRows],
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────

function buildLegendParagraph(): Paragraph {
  return new Paragraph({
    spacing: { after: 240 },
    children: EVENT_KINDS.flatMap((k, i) => {
      const s = EVENT_STYLE_MAP[k];
      return [
        new TextRun({ text: "■ ", color: s.docxBorder, size: 14 }),
        new TextRun({ text: s.label + (i < EVENT_KINDS.length - 1 ? "   " : ""), size: 14, color: "64748B" }),
      ];
    }),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Generate a .docx Blob for a single technician. */
export async function generateTechDocx(
  tech: ReportTechnician,
  dateRangeLabel: string,
  startDate: string,
  endDate: string,
): Promise<Blob> {
  const generatedAt = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const weeks = buildReportWeeks(startDate, endDate);

  // Group weeks by month for month headings
  const byMonth = new Map<string, { label: string; weeks: ReportWeek[] }>();
  for (const w of weeks) {
    const entry = byMonth.get(w.monthKey) ?? { label: w.monthLabel, weeks: [] };
    entry.weeks.push(w);
    byMonth.set(w.monthKey, entry);
  }

  const children: (Paragraph | Table)[] = [];

  // Title
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({ text: tech.resource_name ?? "Technician", color: BLUE, size: 36, bold: true }),
      ],
    }),
  );

  // Subtitle
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Field Service Schedule — ${dateRangeLabel}`,
          size: 20,
          color: "64748B",
        }),
      ],
      spacing: { after: 40 },
    }),
  );

  // Generated at
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `Generated ${generatedAt}`, size: 16, color: "94A3B8", italics: true }),
      ],
      spacing: { after: 160 },
    }),
  );

  // Legend
  children.push(buildLegendParagraph());

  if (tech.events.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No scheduled activity in this period.",
            italics: true,
            color: "64748B",
            size: 18,
          }),
        ],
      }),
    );
  }

  // One table per month
  for (const { label, weeks: monthWeeks } of byMonth.values()) {
    // Month heading
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: label, color: "FFFFFF", size: 22, bold: true })],
        shading: { type: ShadingType.SOLID, color: BLUE },
        spacing: { before: 280, after: 0 },
      }),
    );

    children.push(buildWeekTable(monthWeeks, tech.events));
    children.push(new Paragraph({ children: [] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              // LETTER landscape: 11" × 8.5" in twentieths of a point
              width: 15840,
              height: 12240,
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: { top: 620, bottom: 620, left: 900, right: 900 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}
