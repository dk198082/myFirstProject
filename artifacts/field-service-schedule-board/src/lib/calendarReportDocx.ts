/**
 * Word (.docx) generation for the technician calendar report.
 * Renders a stacked-weeks calendar grid (one row per week, Mon–Fri columns)
 * matching the board's single-technician Calendar View.
 * Includes all event types: Jobs, Potential Jobs, Travel Time, PTO, Custom.
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
  eventLines,
  EVENT_STYLE_MAP,
  eventKindsForExport,
  eventsForExport,
} from "./calendarReportApi";

const BORDER_HEX = "CBD5E1";
const BLUE = "1E3A5F";
const LIGHT_BLUE = "E8F0F7";
const BLACK = "000000";
const TEXT_SIZE = 22; // docx sizes are expressed in half-points: 22 = 11 pt

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
        children: [new TextRun({ text: "Week", bold: true, size: TEXT_SIZE, color: BLACK })],
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
        children: [new TextRun({ text: name, bold: true, size: TEXT_SIZE, color: BLACK })],
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
        children: [new TextRun({ text, bold: true, size: TEXT_SIZE, color: BLACK })],
      }),
    ],
  });
}

function eventParagraphs(ev: CalEvent): Paragraph[] {
  const s = EVENT_STYLE_MAP[ev.kind];
  const lines = eventLines(ev);
  return lines.map((line, index) =>
    new Paragraph({
      indent: { left: 60 },
      spacing: {
        before: index === 0 ? 60 : 0,
        after: index === lines.length - 1 ? 60 : 0,
      },
      shading: { type: ShadingType.SOLID, color: s.docxBg },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: s.docxBorder },
        right: { style: BorderStyle.SINGLE, size: 4, color: s.docxBorder },
        ...(index === 0
          ? { top: { style: BorderStyle.SINGLE, size: 4, color: s.docxBorder } }
          : {}),
        ...(index === lines.length - 1
          ? { bottom: { style: BorderStyle.SINGLE, size: 4, color: s.docxBorder } }
          : {}),
      },
      children: [
        new TextRun({
          text: line,
          size: TEXT_SIZE,
          color: BLACK,
        }),
      ],
    }),
  );
}

function dayCell(events: CalEvent[], dayNum: number): TableCell {
  const paras: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: String(dayNum), size: TEXT_SIZE, color: BLACK })],
      spacing: { after: 20 },
    }),
    ...events.flatMap((ev, index) => [
      ...eventParagraphs(ev),
      ...(index < events.length - 1
        ? [new Paragraph({ spacing: { before: 50, after: 50 }, children: [] })]
        : []),
    ]),
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

function buildLegendParagraph(includeCustomBlocks = false): Paragraph {
  const exportKinds = eventKindsForExport(includeCustomBlocks);
  return new Paragraph({
    spacing: { after: 240 },
    children: exportKinds.flatMap((k, i) => {
      const s = EVENT_STYLE_MAP[k];
      return [
        new TextRun({ text: "■ ", color: BLACK, size: TEXT_SIZE }),
        new TextRun({ text: s.label + (i < exportKinds.length - 1 ? "   " : ""), size: TEXT_SIZE, color: BLACK }),
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
  includeCustomBlocks = false,
): Promise<Blob> {
  const generatedAt = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const weeks = buildReportWeeks(startDate, endDate);
  const exportEvents = eventsForExport(tech.events, includeCustomBlocks);

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
        new TextRun({ text: tech.resource_name ?? "Technician", color: BLACK, size: TEXT_SIZE, bold: true }),
      ],
    }),
  );

  // Subtitle
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Field Service Schedule — ${dateRangeLabel}`,
          size: TEXT_SIZE,
          color: BLACK,
        }),
      ],
      spacing: { after: 40 },
    }),
  );

  // Generated at
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: `Generated ${generatedAt}`, size: TEXT_SIZE, color: BLACK, italics: true }),
      ],
      spacing: { after: 160 },
    }),
  );

  // Legend
  children.push(buildLegendParagraph(includeCustomBlocks));

  if (exportEvents.length === 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No scheduled activity in this period.",
            italics: true,
            color: BLACK,
            size: TEXT_SIZE,
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
        children: [new TextRun({ text: label, color: BLACK, size: TEXT_SIZE, bold: true })],
        shading: { type: ShadingType.SOLID, color: LIGHT_BLUE },
        spacing: { before: 280, after: 0 },
      }),
    );

    children.push(buildWeekTable(monthWeeks, exportEvents));
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
