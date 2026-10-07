import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ProFormaPreview } from "@workspace/api-client-react";
import regularUrl from "../assets/DejaVuSans.ttf?url";
import boldUrl from "../assets/DejaVuSans-Bold.ttf?url";
import logoUrl from "../assets/tinius-olsen.png?url";

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

/** Decimal strings are grouped without converting financial amounts to floats. */
function amount(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

export async function buildInvoicePdf(p: ProFormaPreview): Promise<Blob> {
  const a = await loadAssets();
  const doc = new jsPDF({ unit: "pt", format: p.region === "UK" ? "a4" : "letter", compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS("Invoice-Regular.ttf", a.regular);
  doc.addFont("Invoice-Regular.ttf", "Invoice", "normal");
  doc.addFileToVFS("Invoice-Bold.ttf", a.bold);
  doc.addFont("Invoice-Bold.ttf", "Invoice", "bold");
  doc.setFont("Invoice");
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

  function text(value: string, x: number, y: number, max: number, size = 9, bold = false, draw = true) {
    doc.setFont("Invoice", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(value || "—", max) as string[];
    if (draw) doc.text(lines, x, y, { lineHeightFactor: 1.25 });
    return y + lines.length * size * 1.25;
  }
  function header(draw: boolean): number {
    let leftY = text(get("company_address"), margin, 35, 180, 8.5, false, draw);
    leftY = text("Remit payment to:", margin, leftY + 10, 180, 8, true, draw);
    leftY = text(get("remit_to"), margin, leftY + 1, 180, 8.5, false, draw);
    if (draw) doc.addImage(a.logo, "PNG", w / 2 - 80, 38, 160, 45.7);
    const contactText = [
      get("company_phone") && `Phone: ${get("company_phone")}`,
      get("company_fax") && `Fax: ${get("company_fax")}`,
      get("company_vat_ein") && `${p.region === "UK" ? "VAT" : "EIN"}: ${get("company_vat_ein")}`,
      get("company_url"),
    ].filter(Boolean).join("\n");
    const rightY = text(contactText, w - margin - 143, 35, 143, 8, false, draw);
    const titleY = Math.max(155, leftY + 12, rightY + 12);
    if (draw) {
      doc.setFont("Invoice", "bold"); doc.setFontSize(16);
      doc.text("Pro forma invoice", w / 2, titleY, { align: "center" });
      doc.setLineWidth(0.7); doc.line(margin, titleY + 12, w - margin, titleY + 12);
    }
    const metaY = titleY + 26;
    const metaLeft = text(`Date: ${date}\nTO Ref: ${p.reference}`, margin, metaY, half, 8.5, false, draw);
    const metaRight = text(`PO: ${get("ponumber") || "—"}\nPro forma ref: ${p.serviceOrderNumber}`, margin + half + 20, metaY, half, 8.5, false, draw);
    const addressY = Math.max(metaLeft, metaRight) + 14;
    const bill = [
      join("customeraccount", "account_name", "account_address1_line1", "account_address1_line2", "account_address1_line3"),
      [get("account_address1_city"), get("account_address1_stateorprovince"), get("account_address1_postalcode")].filter(Boolean).join(", "),
      join("account_address1_country", "account_emailaddress1"),
      get("contact_fullname") && `Contact: ${get("contact_fullname")}`,
      get("contact_telephone1") && `Phone: ${get("contact_telephone1")}`,
      get("contact_emailaddress1") && `Contact email: ${get("contact_emailaddress1")}`,
    ].filter(Boolean).join("\n");
    const ship = [
      join("delivery_addressname", "delivery_address1", "delivery_address2", "delivery_address3"),
      [get("delivery_city"), get("delivery_stateorprovince"), get("delivery_postalcode")].filter(Boolean).join(", "),
      get("delivery_country"), get("delivery_phonenumber") && `Phone: ${get("delivery_phonenumber")}`,
    ].filter(Boolean).join("\n");
    text("Invoice to", margin, addressY, half, 9, true, draw);
    text("Delivery address", margin + half + 20, addressY, half, 9, true, draw);
    const billEnd = text(bill, margin, addressY + 15, half, 8.5, false, draw);
    const shipEnd = text(ship, margin + half + 20, addressY + 15, half, 8.5, false, draw);
    return Math.max(billEnd, shipEnd) + 12;
  }
  const bodyStart = header(false);
  if (bodyStart > h - 180) throw new Error("The address block is too long for the supported invoice layout. Correct the CRM address before generating a PDF.");
  const footerReserve = p.region === "US" ? 64 : 38;
  autoTable(doc, {
    startY: bodyStart, margin: { top: bodyStart, bottom: footerReserve, left: margin, right: margin },
    head: [["Line", "Description", "UOM", "Qty ordered", `Unit price ${sym}`, `Net extended ${sym}`]],
    body: p.lines.map((line) => [String(line.lineNumber), line.description, line.uom || "—", line.quantity, amount(line.unitAmount), amount(line.netAmount)]),
    theme: "plain",
    styles: { font: "Invoice", fontSize: 8, textColor: 0, cellPadding: 5, overflow: "linebreak", valign: "top" },
    headStyles: { fontStyle: "bold", lineWidth: { top: 0.7, bottom: 0.7 }, lineColor: 0 },
    columnStyles: {
      0: { cellWidth: 30 }, 1: { cellWidth: width - 284 },
      2: { cellWidth: 40 }, 3: { cellWidth: 62, halign: "right" },
      4: { cellWidth: 76, halign: "right" }, 5: { cellWidth: 76, halign: "right" },
    },
    rowPageBreak: "avoid", showHead: "everyPage",
    didDrawPage: () => { header(true); },
  });
  const tableEnd = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const totalsHeight = 122;
  let totalsY = Math.max(tableEnd + 20, h - footerReserve - totalsHeight);
  if (totalsY + totalsHeight > h - footerReserve) {
    doc.addPage(); header(true);
    totalsY = Math.max(bodyStart + 12, h - footerReserve - totalsHeight);
  }
  doc.setLineWidth(0.7); doc.line(margin, totalsY - 10, w - margin, totalsY - 10);
  text(`Payment terms: ${p.region === "UK" ? "Advance" : "Prepaid"}`, margin, totalsY, width / 2, 9, true);
  text("Bank details", margin, totalsY + 24, width / 2, 9, true);
  text(BANK[p.region].join("\n"), margin, totalsY + 39, width / 2 - 10, 8);
  const totals: [string, string][] = [
    ["Gross extended", p.totals.gross], ["Discount", p.totals.discount],
    ["Net extended price", p.totals.net], ["Freight", p.totals.freight],
    ["Tax", p.totals.tax], ["Total price", p.totals.total],
  ];
  totals.forEach(([label, value], i) => {
    const y = totalsY + i * 18;
    text(`${label}:`, margin + width / 2 + 2, y, 130, 8.5, i === 5);
    doc.setFont("Invoice", i === 5 ? "bold" : "normal");
    doc.setFontSize(8.5);
    doc.text(`${sym} ${amount(value)}`, w - margin, y, { align: "right" });
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setFont("Invoice"); doc.setFontSize(8);
    // Page numbering is in the header, matching the supplied documents.
    doc.text(`Page ${page} of ${pages}`, w - margin, 18, { align: "right" });
    if (p.region === "US") text(US_NOTICE, margin, h - 43, width, 7);
    if (page < pages) {
      doc.setFontSize(8); doc.text("Continued on next page", w - margin, h - footerReserve + 12, { align: "right" });
    }
  }
  return doc.output("blob");
}
