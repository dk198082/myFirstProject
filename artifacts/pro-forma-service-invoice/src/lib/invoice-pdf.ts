import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ProFormaPreview } from "@workspace/api-client-react";
import regularUrl from "../assets/Arial.ttf?url";
import boldUrl from "../assets/Arial-Bold.ttf?url";
import logoUrl from "../assets/tinius-olsen.png?url";
import { formatDecimal as amount } from "./decimal-format";

// Bank instructions and the US export notice are transcribed from the
// user-supplied regional example PDFs, not inferred from CRM records.
const BANK = {
  US: ["Bank name: PNC Bank", "ABA routing number: 031000053", "Account number: 8511023972", "Swift: PNCCUS33ENJ", "Beneficiary: Tinius Olsen Testing Machine Company"],
  UK: ["Bank name: National Westminster Bank", "Sort code: 60-01-04", "Account number: 33850763", "Swift: NWBKGB2L", "Beneficiary: Tinius Olsen Ltd."],
};
const US_NOTICE = "Any local, state, or federal taxes or other special taxes are to be paid by the purchaser of this equipment. These commodities, technology, or software were exported from the United States in accordance with the export administration regulations. Diversion contrary to United States law is prohibited.";

function base64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
let assets: Promise<{ regular: string; bold: string; logo: Uint8Array }> | undefined;
function loadAssets() {
  if (!assets) assets = Promise.all([regularUrl, boldUrl, logoUrl].map(async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not load the PDF assets.");
    return new Uint8Array(await res.arrayBuffer());
  })).then(([regular, bold, logo]) => ({ regular: base64(regular), bold: base64(bold), logo }))
    .catch((err) => { assets = undefined; throw err; });
  return assets;
}

export async function buildInvoicePdf(p: ProFormaPreview): Promise<Blob> {
  const a = await loadAssets();
  const doc = new jsPDF({ unit: "pt", format: p.region === "UK" ? "a4" : "letter", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("Arial.ttf", a.regular);
  doc.addFont("Arial.ttf", "Arial", "normal");
  doc.addFileToVFS("Arial-Bold.ttf", a.bold);
  doc.addFont("Arial-Bold.ttf", "Arial", "bold");
  doc.setFont("Arial");
  doc.setProperties({ title: `Pro forma invoice — ${p.serviceOrderNumber}`, subject: p.reference, creator: "Pro Forma Service Invoice" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const margin = 30;
  const width = w - margin * 2;
  const half = (width - 20) / 2;
  const head = p.header;
  const get = (key: string) => head[key]?.trim() || "";
  const join = (...keys: string[]) => keys.map(get).filter(Boolean).join("\n");
  const sym = p.currency === "GBP" ? "£" : "$";
  const date = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(p.generatedAt));
  let headingBaseline = 110;

  function text(value: string, x: number, y: number, max: number, size = 9, bold = false, draw = true) {
    doc.setFont("Arial", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(value || "—", max) as string[];
    if (draw) doc.text(lines, x, y, { lineHeightFactor: 1.25 });
    return y + lines.length * size * 1.25;
  }
  function header(draw: boolean, includeAddresses = true): number {
    let leftY = text(get("company_address"), margin, 35, 180, 9, false, draw);
    leftY = text("Remit payment to:", margin, leftY + 10, 180, 9, true, draw);
    leftY = text(get("remit_to"), margin, leftY + 1, 180, 9, false, draw);
    if (draw) doc.addImage(a.logo, "PNG", w / 2 - 80, 38, 160, 45.7);
    const contactText = [
      get("company_phone") && `Phone: ${get("company_phone")}`,
      get("company_fax") && `Fax: ${get("company_fax")}`,
      get("company_vat_ein") && `${p.region === "UK" ? "VAT" : "EIN"}: ${get("company_vat_ein")}`,
      get("company_url"),
    ].filter(Boolean).join("\n");
    const rightY = text(contactText, w - margin - 143, 35, 143, 9, false, draw);
    const titleY = Math.max(110, leftY - 9 * 1.25, rightY + 12);
    headingBaseline = titleY;
    if (draw) {
      doc.setFont("Arial", "bold"); doc.setFontSize(14);
      doc.text("Pro forma invoice", w / 2, titleY, { align: "center" });
      doc.setLineWidth(0.7); doc.line(margin, titleY + 12, w - margin, titleY + 12);
    }
    let metaY = titleY + 26;
    const metadata = [
      ["Date:", date], ["TO Ref:", p.reference],
      ["PO:", get("ponumber") || "—"], ["Pro forma ref:", p.serviceOrderNumber],
    ].map(([label, value]) => {
      value = value.replace(/\s+/g, " ");
      doc.setFontSize(9);
      doc.setFont("Arial", "bold");
      const labelWidth = doc.getTextWidth(`${label} `);
      doc.setFont("Arial", "normal");
      return {
        label, labelWidth,
        lines: doc.splitTextToSize(value, width - labelWidth) as string[],
        width: Math.min(width, labelWidth + doc.getTextWidth(value)),
      };
    });
    // Keep standard references on one baseline, but never shrink below 9 pt.
    const referenceRows: (typeof metadata)[] = [];
    let row: typeof metadata = [];
    let rowWidth = 0;
    for (const item of metadata) {
      if (row.length && rowWidth + 10 + item.width > width) {
        referenceRows.push(row); row = []; rowWidth = 0;
      }
      rowWidth += (row.length ? 10 : 0) + item.width;
      row.push(item);
    }
    referenceRows.push(row);
    referenceRows.forEach((items, index) => {
      const gap = items.length > 1 ? (width - items.reduce((sum, item) => sum + item.width, 0)) / (items.length - 1) : 0;
      let x = margin;
      items.forEach(({ label, labelWidth, lines, width: itemWidth }) => {
        if (draw) {
          doc.setFont("Arial", "bold");
          doc.text(label, x, metaY);
          doc.setFont("Arial", "normal");
          doc.text(lines, x + labelWidth, metaY, { lineHeightFactor: 1.25 });
        }
        x += itemWidth + gap;
      });
      metaY += (Math.max(...items.map((item) => item.lines.length)) - 1) * 9 * 1.25;
      if (index < referenceRows.length - 1) metaY += 9 * 1.25;
    });
    if (draw) {
      doc.setLineWidth(0.7);
      doc.line(margin, metaY + 10, w - margin, metaY + 10);
    }
    if (!includeAddresses) return metaY + 18;
    const addressY = metaY + 24;
    const billX = margin + 62;
    const shipX = margin + half + 20 + 98;
    const bill = [
      ...["account_name", "account_address1_line1", "account_address1_line2", "account_address1_line3"].map(get),
      [get("account_address1_city"), get("account_address1_stateorprovince"), get("account_address1_postalcode")].filter(Boolean).join(", "),
      get("account_address1_country"),
    ].filter(Boolean);
    const ship = [
      join("delivery_address1", "delivery_address2", "delivery_address3"),
      [get("delivery_city"), get("delivery_stateorprovince"), get("delivery_postalcode")].filter(Boolean).join(", "),
      get("delivery_country"),
    ].filter(Boolean).join("\n");
    text("Invoice to:", margin, addressY, 62, 9, true, draw);
    text("Delivery address:", margin + half + 20, addressY, 98, 9, true, draw);
    const accountEnd = text(get("customeraccount"), billX, addressY, half - 62, 9, false, draw);
    let billEnd = text([...new Set(bill)].join("\n"), billX, accountEnd, half - 62, 9, false, draw);
    const shipNameEnd = text(get("delivery_addressname"), shipX, addressY, half - 98, 9, false, draw);
    let shipEnd = text(ship, shipX, shipNameEnd, half - 98, 9, false, draw);
    const detailsY = Math.max(billEnd, shipEnd) + 6;
    function contactDetails(rows: string[][], x: number): number {
      let end = detailsY;
      rows.filter(([, value]) => value).forEach(([label, value]) => {
        const labelEnd = text(label, x, end, 78, 9, true, draw);
        const valueEnd = text(value, x + 78, end, half - 78, 9, false, draw);
        end = Math.max(labelEnd, valueEnd);
      });
      return end;
    }
    billEnd = contactDetails([
      ["Phone:", get("account_telephone1")],
      ["Contact email:", get("account_emailaddress1")],
      ["Tax #:", p.customerTaxNumber || ""],
    ], margin);
    shipEnd = contactDetails([
      ["Contact:", get("contact_fullname")],
      ["Phone:", get("contact_telephone1")],
      ["Contact email:", get("contact_emailaddress1")],
    ], margin + half + 20);
    return Math.max(billEnd, shipEnd) + 6;
  }
  const bodyStart = header(false);
  const continuationStart = header(false, false);
  if (bodyStart > h - 180) throw new Error("The address block is too long for the supported invoice layout. Correct the CRM address before generating a PDF.");
  const footerReserve = p.region === "US" ? 64 : 38;
  autoTable(doc, {
    startY: bodyStart, margin: { top: continuationStart, bottom: footerReserve, left: margin, right: margin },
    head: [["Line", "Description", "UOM", "Qty ordered", `Unit price ${sym}`, `Net extended ${sym}`]],
    body: p.lines.map((line) => [String(line.lineNumber), line.description, line.uom || "—", amount(line.quantity), amount(line.unitAmount), amount(line.netAmount)]),
    theme: "plain",
    styles: { font: "Arial", fontSize: 9, textColor: 0, cellPadding: 5, overflow: "linebreak", valign: "top" },
    headStyles: { fontStyle: "bold", lineWidth: { top: 0.7, bottom: 0.7 }, lineColor: 0 },
    columnStyles: {
      0: { cellWidth: 30 }, 1: { cellWidth: width - 284 },
      2: { cellWidth: 40 }, 3: { cellWidth: 62, halign: "right" },
      4: { cellWidth: 76, halign: "right" }, 5: { cellWidth: 76, halign: "right" },
    },
    rowPageBreak: "avoid", showHead: "everyPage",
    didDrawPage: ({ pageNumber }) => { header(true, pageNumber === 1); },
  });
  const tableEnd = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const totalsHeight = 122;
  let totalsY = Math.max(tableEnd + 20, h - footerReserve - totalsHeight);
  if (totalsY + totalsHeight > h - footerReserve) {
    doc.addPage(); header(true, false);
    totalsY = Math.max(continuationStart + 12, h - footerReserve - totalsHeight);
  }
  doc.setLineWidth(0.7); doc.line(margin, totalsY - 10, w - margin, totalsY - 10);
  text(`Payment terms: ${p.region === "UK" ? "Advance" : "Prepaid"}`, margin, totalsY, width / 2, 9, true);
  text("Bank details", margin, totalsY + 24, width / 2, 9, true);
  text(BANK[p.region].join("\n"), margin, totalsY + 39, width / 2 - 10, 9);
  const totals: [string, string][] = [
    ["Gross extended", p.totals.gross], ["Discount", p.totals.discount],
    ["Net extended price", p.totals.net], ["Freight", p.totals.freight],
    ["Tax", p.totals.tax], ["Total price", p.totals.total],
  ];
  doc.setFontSize(9);
  const amountWidth = totals.reduce((max, [, value], i) => {
    doc.setFont("Arial", i === 5 ? "bold" : "normal");
    return Math.max(max, doc.getTextWidth(amount(value)));
  }, 0);
  const currencyX = w - margin - Math.max(80, amountWidth + 12);
  totals.forEach(([label, value], i) => {
    const y = totalsY + i * 18;
    doc.setFont("Arial", "bold");
    doc.setFontSize(9);
    doc.text(`${label}:`, currencyX - 10, y, { align: "right" });
    doc.setFont("Arial", i === 5 ? "bold" : "normal");
    doc.setFontSize(9);
    doc.text(sym, currencyX, y);
    doc.text(amount(value), w - margin, y, { align: "right" });
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("Arial", "bold"); doc.setFontSize(9);
    // Page numbering is in the header, matching the supplied documents.
    doc.text(`Page ${page} of ${pages}`, w - margin, headingBaseline, { align: "right" });
    if (p.region === "US") text(US_NOTICE, margin, h - 43, width, 9);
    if (page < pages) {
      doc.setFontSize(9); doc.text("Continued on next page", w - margin, h - footerReserve + 8, { align: "right" });
    }
  }
  return doc.output("blob");
}
