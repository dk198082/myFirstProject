/**
 * generate-training-doc.cjs
 * Generates docs/field-service-schedule-board-guide.docx
 * Run from workspace root: node scripts/generate-training-doc.cjs
 * (docx is resolved via the field-service-schedule-board package)
 */
'use strict';

// Run from the package that has docx installed
const docxPkg = require('/home/runner/workspace/node_modules/.pnpm/docx@9.7.1/node_modules/docx/dist/index.cjs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, ShadingType, WidthType,
  VerticalAlign, PageOrientation, TableLayoutType,
} = docxPkg;
const { writeFileSync } = require('fs');
const { resolve } = require('path');

// ── Colour palette ──────────────────────────────────────────────────────────
const C = {
  blue:       '2563EB',
  blueDark:   '1E40AF',
  blueLight:  'DBEAFE',
  bluePale:   'EFF6FF',
  amber:      'D97706',
  amberLight: 'FEF9C3',
  green:      '16A34A',
  greenLight: 'DCFCE7',
  slate700:   '334155',
  slate600:   '475569',
  slate400:   '94A3B8',
  slate100:   'F1F5F9',
  slate50:    'F8FAFC',
  white:      'FFFFFF',
  black:      '0F172A',
};

const BORDER_NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const BORDER_THIN = { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0' };
const noBorders   = { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE };
const thinBorders = { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN };

// Convert inches to twips
function twip(inches) { return Math.round(inches * 1440); }
// Half-points
function pt(n) { return Math.round(n * 2); }

// ── Primitives ───────────────────────────────────────────────────────────────

function spacer(after = 160) {
  return new Paragraph({ children: [], spacing: { before: 0, after } });
}

function para(text, opts = {}) {
  const {
    size = 11, color = C.slate700, bold = false, italic = false,
    before = 0, after = 120, indent = 0,
    align = AlignmentType.LEFT,
  } = opts;
  return new Paragraph({
    alignment: align,
    indent: indent ? { left: twip(indent) } : undefined,
    spacing: { before, after },
    children: [new TextRun({ text, size: pt(size), color, bold, italics: italic })],
  });
}

function paraRuns(runs, opts = {}) {
  const { before = 0, after = 120, align = AlignmentType.LEFT, indent } = opts;
  return new Paragraph({
    alignment: align,
    indent: indent ? { left: twip(indent) } : undefined,
    spacing: { before, after },
    children: runs.map(r =>
      new TextRun({
        text:    r.text,
        size:    pt(r.size ?? 11),
        color:   r.color ?? C.slate700,
        bold:    r.bold  ?? false,
        italics: r.italic ?? false,
      })
    ),
  });
}

function sectionHeading(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 0 },
    shading: { type: ShadingType.SOLID, color: C.blue },
    children: [
      new TextRun({ text: `  ${title}`, size: pt(13), color: C.white, bold: true }),
    ],
  });
}

function subHeading(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    children: [
      new TextRun({ text: title, size: pt(11.5), color: C.blueDark, bold: true }),
    ],
  });
}

function minorHeading(title) {
  return new Paragraph({
    spacing: { before: 200, after: 60 },
    children: [
      new TextRun({ text: title, size: pt(11), color: C.slate700, bold: true }),
    ],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    bullet: { level },
    spacing: { before: 0, after: 80 },
    indent: { left: twip(0.25 + level * 0.25), hanging: twip(0.18) },
    children: [new TextRun({ text, size: pt(11), color: C.slate700 })],
  });
}

function step(num, text) {
  return paraRuns(
    [
      { text: `${num}.   `, bold: true, color: C.blue, size: 11 },
      { text, size: 11 },
    ],
    { after: 100, indent: 0.08 }
  );
}

// ── Composite blocks ─────────────────────────────────────────────────────────

function callout(label, text, bg = C.blueLight, accent = C.blue) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER_NONE, bottom: BORDER_NONE, left: BORDER_NONE, right: BORDER_NONE,
               insideH: BORDER_NONE, insideV: BORDER_NONE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 3, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: accent },
            borders: noBorders,
            margins: { top: 60, bottom: 60, left: 40, right: 40 },
            children: [para('', { size: 9, after: 0 })],
          }),
          new TableCell({
            width: { size: 97, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: bg },
            borders: noBorders,
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              paraRuns([
                { text: `${label}  `, bold: true, color: accent, size: 10.5 },
                { text, color: C.slate700, size: 10.5 },
              ], { after: 0 }),
            ],
          }),
        ],
      }),
    ],
  });
}

function featureTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN,
               insideH: BORDER_THIN, insideV: BORDER_THIN },
    rows: rows.map(([label, desc], i) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: i % 2 === 0 ? C.bluePale : C.white },
            borders: thinBorders,
            margins: { top: 80, bottom: 80, left: 100, right: 80 },
            children: [para(label, { size: 10.5, bold: true, color: C.blueDark, after: 0 })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: i % 2 === 0 ? C.slate50 : C.white },
            borders: thinBorders,
            margins: { top: 80, bottom: 80, left: 100, right: 80 },
            children: [para(desc, { size: 10.5, after: 0 })],
          }),
        ],
      })
    ),
  });
}

function chipColourTable() {
  const rows = [
    ['Scheduled Job (CRM)',        'Region colour — solid border',  'WO# · Customer · City/State/Postal Code · Duration'],
    ['Potential Job',              'Yellow (R4); region colour (others) — dashed border + diagonal stripe', 'Customer · City/State/Postal Code · Status · Notes'],
    ['Travel Time Block',          'Region colour — solid border',  '🚗 Travel Time · Duration'],
    ['PTO Block',                  'Region colour — solid border',  '☀️ PTO · Duration'],
    ['Custom Block',               'Orange (R4); region colour (others) — solid border', '✏️ Title (or "Custom") · Duration'],
    ['Conflict indicator',         'Amber ring overlay on any chip', 'Booking overlaps another in the same slot'],
  ];
  const hdr = new TableRow({
    tableHeader: true,
    children: ['Chip type', 'Colour / border style', 'What it shows'].map(h =>
      new TableCell({
        shading: { type: ShadingType.SOLID, color: C.slate700 },
        borders: thinBorders,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [para(h, { size: 10, bold: true, color: C.white, after: 0 })],
      })
    ),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN,
               insideH: BORDER_THIN, insideV: BORDER_THIN },
    rows: [
      hdr,
      ...rows.map(([type, style, shows], idx) =>
        new TableRow({
          children: [type, style, shows].map((cell, ci) =>
            new TableCell({
              shading: { type: ShadingType.SOLID, color: idx % 2 === 0 ? C.slate50 : C.white },
              borders: thinBorders,
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
              children: [para(cell, { size: 10, after: 0 })],
            })
          ),
        })
      ),
    ],
  });
}

function permMatrix() {
  const rows = [
    ['View the schedule board',        '✓', '✓'],
    ['View work order details',        '✓', '✓'],
    ['Search jobs',                    '✓', '✓'],
    ['View unscheduled jobs',          '✓', '✓'],
    ['View resource utilisation',      '✓', '✓'],
    ['Drag-and-drop reschedule',       '–', '✓'],
    ['Edit booking via dialog',        '–', '✓'],
    ['Add / edit schedule blocks',     '–', '✓'],
    ['Add / edit potential jobs',      '–', '✓'],
    ['Add dispatcher notes',           '–', '✓'],
    ['Generate Calendar Report',       '–', '✓'],
    ['Download PDF / Word',            '–', '✓'],
    ['Send report emails to technicians', '–', '✓'],
  ];
  const hdr = new TableRow({
    tableHeader: true,
    children: ['Action', 'Viewer', 'Editor'].map((h, i) =>
      new TableCell({
        width: { size: i === 0 ? 62 : 19, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: C.blue },
        borders: thinBorders,
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [para(h, { size: 10.5, bold: true, color: C.white, after: 0,
                             align: i > 0 ? AlignmentType.CENTER : AlignmentType.LEFT })],
      })
    ),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: { top: BORDER_THIN, bottom: BORDER_THIN, left: BORDER_THIN, right: BORDER_THIN,
               insideH: BORDER_THIN, insideV: BORDER_THIN },
    rows: [
      hdr,
      ...rows.map(([action, viewer, editor], idx) =>
        new TableRow({
          children: [action, viewer, editor].map((cell, ci) =>
            new TableCell({
              width: { size: ci === 0 ? 62 : 19, type: WidthType.PERCENTAGE },
              shading: { type: ShadingType.SOLID, color: idx % 2 === 0 ? C.slate50 : C.white },
              borders: thinBorders,
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
              children: [para(cell, {
                size: 10.5, after: 0,
                bold:  cell === '✓',
                color: cell === '✓' ? C.green : cell === '–' ? C.slate400 : C.slate700,
                align: ci > 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
              })],
            })
          ),
        })
      ),
    ],
  });
}

// ── Document content ─────────────────────────────────────────────────────────

const children = [

  // Cover banner
  new Paragraph({
    spacing: { before: 0, after: 0 },
    shading: { type: ShadingType.SOLID, color: C.blueDark },
    children: [
      new TextRun({ text: '  Field Service Schedule Board', size: pt(24), color: C.white, bold: true }),
    ],
  }),
  new Paragraph({
    spacing: { before: 0, after: 0 },
    shading: { type: ShadingType.SOLID, color: C.blue },
    children: [
      new TextRun({ text: '  Training & Quick-Reference Guide', size: pt(14), color: 'DBEAFE' }),
    ],
  }),
  new Paragraph({
    spacing: { before: 0, after: 300 },
    shading: { type: ShadingType.SOLID, color: C.blue },
    children: [
      new TextRun({ text: '  August 2026  ·  For dispatchers, managers, and new starters', size: pt(10.5), color: C.white }),
    ],
  }),

  // ── 1. What is this app? ────────────────────────────────────────────────
  sectionHeading('1.  What is the Field Service Schedule Board?'),
  spacer(100),
  para(
    'The Field Service Schedule Board is the central tool used by dispatchers and service managers to plan, view, and manage technician bookings across all regions. It provides a live calendar view drawn directly from Microsoft Dynamics 365 Field Service and lets editors reschedule jobs and write changes back to Dynamics in real time.',
    { size: 11, after: 140 }
  ),
  featureTable([
    ['Who uses it?',
     'Dispatchers (Editors) schedule, reschedule, and annotate the board. Managers and viewers see the same live data in read-only mode.'],
    ['Where does data come from?',
     'Bookings are synced from Dynamics 365 Field Service via a PostgreSQL mirror. Schedule blocks and potential jobs are stored locally in the app\'s own database.'],
    ['How do changes get back to Dynamics?',
     'Every reschedule or new booking is sent to the Dynamics Dataverse REST API. A spinning sync icon on the chip confirms the write is in flight.'],
    ['Who can access it?',
     'Access is controlled by the Admin Console. Users must sign in with their Microsoft work account (Entra ID). Roles (Viewer or Editor) are assigned in the Admin Console.'],
  ]),

  // ── 2. Signing in ───────────────────────────────────────────────────────
  sectionHeading('2.  Signing In'),
  spacer(100),
  step(1, 'Open the app URL in your browser. If you are not signed in you will see a "Sign in required" card.'),
  step(2, 'Click Sign in with Microsoft. Your browser opens the standard Microsoft login page.'),
  step(3, 'Enter your company Microsoft work account credentials.'),
  step(4, 'The Admin Console checks your account. If access has been granted you are redirected straight to the board.'),
  step(5, 'Your role — Viewer or Editor — is set at login and applies for the whole session. Editor controls are hidden entirely from Viewer sessions.'),
  spacer(80),
  callout('Access denied?', 'Your account has not been granted permission. Contact your system administrator to be added in the Admin Console.', C.amberLight, C.amber),
  spacer(60),
  callout('Embedded browser / iframe?', 'Microsoft login cannot be displayed inside an iframe. If clicking the button appears blocked, open the app URL directly in its own browser tab, then return here.', C.blueLight, C.blue),

  // ── 3. Navigating the board ─────────────────────────────────────────────
  sectionHeading('3.  Navigating the Board'),
  spacer(100),
  para('The controls row at the top of the board has two groups of buttons:', { size: 11, after: 100 }),

  subHeading('3.1  Date Navigation (left side)'),
  featureTable([
    ['← / → arrows',  'Move back or forward by one week (Week view) or one month (Calendar view).'],
    ['Today',          'Jump to the week or month containing today.'],
    ['Next quarter',   'Jump to the Monday of the first week of the next calendar quarter. E.g. clicking in August 2026 takes you to the week of 1 October 2026.'],
    ['Next year',      'Jump to the same date one year from now. Useful for pre-planning or copying annual schedules.'],
  ]),

  subHeading('3.2  View & Grouping (right side)'),
  featureTable([
    ['Week view',            '7-day swimlane grid — one row per technician, one column per day. Full chip detail: WO number, customer, city/state, duration. Default view.'],
    ['Calendar view',        'Monthly stacked grid — condensed chips. Best for spotting gaps over a longer horizon. Click a technician\'s name to enter the focused single-tech view.'],
    ['Focused single-tech',  'Entered by clicking a technician\'s name in Calendar view. Shows 13 weeks of that technician\'s schedule in a Mon–Fri grid. Has its own Today / Next quarter / Next year controls.'],
    ['By Tech Region',       'Groups technicians under their CRM service territory (R1, R2, R3, R4 …).'],
    ['By Service Location',  'Groups work orders by the state/city of the job site.'],
  ]),

  subHeading('3.3  Region & Technician Filters'),
  para('A row of region toggle pills below the controls lets you show or hide entire regions. Click a pill to toggle it; use Select All or Clear to reset. A technician name filter further narrows the board to specific individuals.', { size: 11, after: 120 }),

  // ── 4. Reading board chips ──────────────────────────────────────────────
  sectionHeading('4.  Reading Board Chips'),
  spacer(100),
  para('Every entry on the board is a colour-coded chip. All text wraps within the chip — no content is hidden by truncation.', { size: 11, after: 120 }),
  chipColourTable(),
  spacer(100),
  callout('Region colour defaults:', 'R1 = Blue · R2 = Yellow · R3 = Violet · R4 = Sky Blue (jobs), Yellow (potential), Orange (custom) · R5 = Lighter Salmon · R99 = Gray. Any chip colour can be overridden per-entry from the add/edit dialog.', C.blueLight, C.blue),

  // ── 5. Rescheduling ─────────────────────────────────────────────────────
  sectionHeading('5.  Rescheduling a Job  [Editor only]'),
  spacer(100),
  subHeading('Option A — Drag & Drop (quick move)'),
  step(1, 'Locate the booking chip. Only the start-day chip of a multi-day booking is draggable; single-day chips are always draggable.'),
  step(2, 'Click and hold until the cursor changes to a grab hand.'),
  step(3, 'Drag to the target technician\'s row and day column. The cell highlights when it accepts the drop.'),
  step(4, 'Release. The chip moves immediately and a CRM write-back is queued. A spinning sync icon confirms the pending save.'),
  spacer(80),
  subHeading('Option B — Edit Dialog (full control)'),
  step(1, 'Click the booking chip to open the Work Order Detail drawer.'),
  step(2, 'Click Reschedule (or the edit button on the chip).'),
  step(3, 'Change the Start time, End time, or Technician in the dialog.'),
  step(4, 'Click Save to CRM for an immediate Dynamics write, or Queue to batch the write.'),
  spacer(80),
  callout('Conflict detection:', 'If the technician already has an overlapping booking, the chip gains an amber ring and a warning is shown. You can proceed or pick a different slot.', C.amberLight, C.amber),

  // ── 6. Schedule blocks ──────────────────────────────────────────────────
  sectionHeading('6.  Schedule Blocks (Travel Time, PTO, Custom)  [Editor only]'),
  spacer(100),
  para('Schedule blocks are stored in the app\'s own database — not in Dynamics. Use them to mark a technician as unavailable or to annotate planned travel.', { size: 11, after: 100 }),
  minorHeading('Adding a block'),
  step(1, 'Hover over the technician\'s row for the target day. A faint "+ Add" button appears in the cell.'),
  step(2, 'Click + Add. The Add dialog opens.'),
  step(3, 'Choose the Type: Travel Time, PTO, or Custom. For Custom, enter an optional title (leave blank to show "Custom" on the chip).'),
  step(4, 'Set Start time and End time (defaults: 8:00 AM – 5:00 PM).'),
  step(5, 'Optionally add Notes. Each line shows as a separate bullet on the chip.'),
  step(6, 'Pick a Colour from the palette to override the region default, if needed.'),
  step(7, 'Click Save. The chip appears immediately.'),
  spacer(80),
  minorHeading('Editing, moving, or deleting a block'),
  bullet('Click the chip to open the edit dialog — all fields are editable.'),
  bullet('Click the small ✕ in the chip corner for an immediate delete (no confirmation needed).'),
  bullet('In the edit dialog, click Delete for a confirmation-prompted delete.'),
  bullet('Multi-day blocks: drag the start-day chip to move the start date; use the resize handle on the end-day chip to extend or shorten the block.'),

  // ── 7. Potential jobs ───────────────────────────────────────────────────
  sectionHeading('7.  Potential (Placeholder) Jobs  [Editor only]'),
  spacer(100),
  para('Potential jobs let you pre-schedule speculative or unconfirmed work without creating a Dynamics booking. They appear with a dashed border and diagonal stripe and are counted separately in utilisation.', { size: 11, after: 100 }),
  step(1, 'Click + Add in a technician\'s day cell and choose Potential Job.'),
  step(2, 'Fill in the fields: Service location (search CRM by ID, name, or city — auto-fills customer and city), Status (PO Received, Credit Hold, Quote Sent, etc.), Start/End time, Notes, and Colour.'),
  step(3, 'Click Save. The chip appears with a dashed border.'),
  spacer(80),
  callout('Service location search tip:', 'Type at least 2 characters. The picker searches by location ID, name, city, and state across 6,600+ active CRM locations. If the CRM is temporarily unavailable enter the customer name and city manually.', C.blueLight, C.blue),

  // ── 8. Unscheduled jobs ─────────────────────────────────────────────────
  sectionHeading('8.  Scheduling Unscheduled Jobs  [Editor only]'),
  spacer(100),
  para('The Unscheduled Jobs panel lists all work orders with no active booking. Open it with the Unscheduled Jobs button in the board toolbar.', { size: 11, after: 100 }),
  featureTable([
    ['What each card shows',    'WO number · Customer · City/State · Estimated duration · Due date · Best-fit technician suggestions (ranked by nearby job density).'],
    ['Due date groupings',      'Overdue · Due this week · Due next week · Due later · No due date.'],
    ['To schedule a job',       'Drag the job card onto the board and drop it on a technician\'s day cell, or click Schedule on the card. An Edit Booking dialog opens to confirm start/end times before the Dynamics booking is created.'],
    ['Best-fit suggestions',    'Click a suggested technician name to navigate the board straight to that technician\'s row.'],
  ]),

  // ── 9. Dispatcher notes ─────────────────────────────────────────────────
  sectionHeading('9.  Dispatcher Notes  [Editor only]'),
  spacer(100),
  para('Notes can be attached to any CRM booking. They are stored locally (not in Dynamics) and appear in italic on the chip and in the work order detail drawer.', { size: 11, after: 100 }),
  step(1, 'Click the booking chip to open the Work Order Detail drawer.'),
  step(2, 'Scroll to the Dispatcher Note field at the bottom.'),
  step(3, 'Type your note. Multi-line notes are supported.'),
  step(4, 'Click Save note. The note appears on the chip immediately.'),
  spacer(80),
  callout('Note:', 'Dispatcher notes persist even if the booking is rescheduled to a different technician or time — they are tied to the booking ID, not the time slot.', C.greenLight, C.green),

  // ── 10. Search ──────────────────────────────────────────────────────────
  sectionHeading('10.  Searching Jobs'),
  spacer(100),
  para('The global search bar is at the top of the board. It searches across scheduled, unscheduled, and potential jobs simultaneously.', { size: 11, after: 100 }),
  bullet('Type at least 2 characters — results appear after a short pause.'),
  bullet('Results are grouped: Scheduled · Potential · Unscheduled.'),
  bullet('Each result shows the WO number, customer, technician (if scheduled), and location.'),
  bullet('Clicking a result navigates the board to the relevant date and highlights the matching chip.'),
  bullet('Non-matching chips are dimmed while a search is active, making it easy to spot the result.'),

  // ── 11. Resource utilisation ────────────────────────────────────────────
  sectionHeading('11.  Resource Utilisation'),
  spacer(100),
  para('The Resource Utilisation panel (expandable at the bottom of the board) shows booked hours versus capacity for each technician, grouped by region.', { size: 11, after: 100 }),
  featureTable([
    ['Bar chart',       'The filled portion = booked hours ÷ capacity hours. The bar turns red if utilisation exceeds 100%.'],
    ['Breakdown',       'CRM job hours show in the region colour. Potential job hours show as a secondary segment. The two are never double-counted.'],
    ['Default capacity','40 hours per week (8 h/day × 5 days), applied server-side.'],
    ['Period views',    'Toggle between Week, Month, and Quarter to recalculate over different periods.'],
    ['Filtering',       'Region filter pills inside the panel narrow down to specific regions, matching the board\'s own region filter.'],
  ]),

  // ── 12. Calendar Report ─────────────────────────────────────────────────
  sectionHeading('12.  Calendar Report  [Editor only]'),
  spacer(100),
  para('The Calendar Report generates a personal schedule summary for one or more technicians across a chosen date range. All output formats use larger, more readable typography. Click Calendar Report in the controls row to open the dialog.', { size: 11, after: 100 }),
  minorHeading('What is included?'),
  featureTable([
    ['Scheduled CRM bookings',       'Included — Customer name + city/state + WO number on separate lines.'],
    ['Potential (placeholder) jobs', 'Included.'],
    ['Travel Time blocks',           'Included.'],
    ['PTO blocks',                   'Included.'],
    ['Custom blocks',                'Visible in the in-app preview. Check Include Custom Blocks to add them to PDF, Word, and emailed PDF reports.'],
    ['Multi-day bookings',           'Appear on every weekday they span — a Mon–Thu booking shows on Mon, Tue, Wed, Thu.'],
  ]),
  spacer(80),
  minorHeading('How to generate and send a report'),
  step(1, 'Click Calendar Report in the controls row.'),
  step(2, 'Choose how to define the date range using the Month range / Custom toggle at the top of the dialog:'),
  bullet('Month range — select a start month from the dropdown, then pick a span of 1–6 months.', 1),
  bullet('Custom — pick an exact start date and end date using the date picker popovers. The end date picker prevents selecting a date before the chosen start. The Load button stays disabled until both dates are set.', 1),
  step(3, 'Optionally check Include Custom Blocks, then click Load Schedule Data to fetch the schedule for the chosen range.'),
  step(4, 'Select one or more technicians from the picker.'),
  step(5, 'Choose an output format:'),
  bullet('Download PDF — multi-page PDF, one technician per page, with large readable font and event chips per day.', 1),
  bullet('Download Word (.docx) — same layout in an editable Word document.', 1),
  bullet('Send Email — sends the report to the technician\'s work email via Microsoft Graph. The greeting uses the technician\'s first name; the sign-off uses the sending dispatcher\'s name.', 1),
  spacer(80),
  callout('Tip:', 'Use Custom date range when you need a report that crosses month boundaries or covers an exact period such as a project duration or a technician\'s upcoming schedule.', C.blueLight, C.blue),

  // ── 13. Other reports ───────────────────────────────────────────────────
  sectionHeading('13.  Other Built-in Reports'),
  spacer(100),
  featureTable([
    ['Completed Not Approved', 'Service orders that have reached Completed status but not yet been approved. Filter by region, year, and month. Useful for billing pipeline management.'],
    ['Approved Not Invoiced',  'Service orders approved but not yet exported to the invoicing system (AX). Filter by region. Flags stalled invoicing.'],
    ['Weekly Approved',        'Volume of approved orders grouped by approver and week. Filter by region, approver, year, and month. Tracks throughput per approval workflow.'],
  ]),

  // ── 14. Roles & permissions ─────────────────────────────────────────────
  sectionHeading('14.  Roles & Permissions'),
  spacer(100),
  para('There are two roles. Roles are assigned in the Admin Console and take effect at the next login.', { size: 11, after: 100 }),
  paraRuns([
    { text: 'Viewer (Read-Only)  ', bold: true, color: C.green, size: 11 },
    { text: '— Can see the full board, work order details, utilisation panel, and reports. Cannot make any changes.', size: 11 },
  ], { after: 80 }),
  paraRuns([
    { text: 'Editor (Read/Write)  ', bold: true, color: C.amber, size: 11 },
    { text: '— Full access including rescheduling, adding blocks and potential jobs, dispatcher notes, and Calendar Report generation.', size: 11 },
  ], { after: 120 }),
  permMatrix(),

  // ── 15. Quick tips ──────────────────────────────────────────────────────
  sectionHeading('15.  Quick Tips for New Starters'),
  spacer(100),
  bullet('Start in Week view — it shows the most detail per chip. Switch to Calendar view for longer-horizon planning.'),
  bullet('Use the region filter pills to narrow the board to your region before a busy morning. Click Select All to restore all regions.'),
  bullet('The Unscheduled Jobs panel shows best-fit technician suggestions based on geographic proximity — use these to reduce technician travel time.'),
  bullet('A chip with an amber ring means that technician has two overlapping bookings. Investigate and reschedule one of them.'),
  bullet('Potential jobs (dashed border) are a planning tool — they do not appear in Dynamics and do not block scheduling.'),
  bullet('Dispatcher notes you add to a booking survive rescheduling — you do not need to re-enter them after a drag-and-drop move.'),
  bullet('Calendar Reports emailed to technicians are personalised with the technician\'s first name. Always review the technician picker before sending.'),
  bullet('To view a technician\'s full quarter at a glance, click their name in Calendar view to enter the focused 13-week single-tech view.'),
  bullet('Use Next quarter or Next year navigation before generating a Calendar Report to jump quickly to the planning period you need.'),

  // Footer rule
  spacer(200),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.slate400 } },
    children: [
      new TextRun({ text: 'Field Service Schedule Board  ·  Training & Reference Guide  ·  August 2026', size: pt(9), color: C.slate400, italics: true }),
    ],
  }),
];

// ── Build document ───────────────────────────────────────────────────────────

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: 'Calibri', size: pt(11), color: C.slate700 },
        paragraph: { spacing: { after: 120 } },
      },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal',
        run: { font: 'Calibri', size: pt(13), color: C.white, bold: true },
        paragraph: { spacing: { before: 320, after: 0 } },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal',
        run: { font: 'Calibri', size: pt(11.5), color: C.blueDark, bold: true },
        paragraph: { spacing: { before: 240, after: 80 } },
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: twip(8.5), height: twip(11) },
          margin: { top: twip(0.9), bottom: twip(0.9), left: twip(1.1), right: twip(1.1) },
        },
      },
      children,
    },
  ],
});

Packer.toBuffer(doc).then(buf => {
  const outPath = resolve(__dirname, '../docs/field-service-schedule-board-guide.docx');
  writeFileSync(outPath, buf);
  console.log('✓ Written:', outPath);
}).catch(err => {
  console.error('Error generating doc:', err);
  process.exit(1);
});
