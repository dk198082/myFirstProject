// Run after bundling invoice-pdf.ts with esbuild into /tmp/pro-forma-pdf.
import fs from "node:fs/promises";
import path from "node:path";
const dir = "/tmp/pro-forma-pdf";
globalThis.fetch = async (url) => new Response(await fs.readFile(path.join(dir, String(url).split("?")[0])));
const { buildInvoicePdf } = await import(`${dir}/invoice-pdf.mjs`);
const output = ".agents/outputs/pro-forma";
for (const region of ["US", "UK"]) {
  const preview = {
    serviceOrderNumber: "TEST-ONLY", reference: "WO-TEST / TEST-ONLY",
    region, currency: region === "US" ? "USD" : "GBP", generatedAt: "2026-10-06T12:00:00.000Z",
    header: {
      company_address: region === "US" ? "Tinius Olsen Testing Machine Company\n1065 Easton Road\nHorsham, PA 19044\nUS" : "Tinius Olsen Limited\n6 Perrywood Business Park\nHoneycrock Lane, Salfords\nRedhill\nRH1 5DZ",
      remit_to: region === "US" ? "Tinius Olsen Testing Machine Company\nP.O. Box 7780-1204\nPhiladelphia, PA 19182\nUSA" : "6 Perrywood Business Park\nHoneycrock Lane\nSalfords\nRedhill\nRH1 5DZ",
      company_phone: "TEST PHONE", company_fax: "", company_vat_ein: "TEST TAX ID", company_url: "www.tiniusolsen.com",
      customeraccount: "TEST", account_name: "PDF Verification Fixture", account_address1_line1: "Test billing address",
      account_address1_city: "Test city", account_address1_country: region,
      delivery_addressname: "Test delivery", delivery_address1: "Test delivery street", delivery_country: region,
      ponumber: "TEST-PO", contact_fullname: "Fixture Contact",
    },
    lines: Array.from({ length: 55 }, (_, i) => ({
      lineNumber: i + 1, type: "PRODUCT", uom: "Each", quantity: "2", unitAmount: "10.25", netAmount: "20.50",
      description: `Line ${i + 1} — Calibration and inspection of laboratory testing equipment, including a long description to verify wrapping; accented text: précision £ $.`,
    })),
    totals: { gross: "1127.50", discount: "0.00", net: "1127.50", freight: "15.50", tax: "0.20", total: "1143.20" },
    warnings: [],
  };
  const blob = await buildInvoicePdf(preview);
  await fs.writeFile(`${output}/${region.toLowerCase()}-multipage-test.pdf`, new Uint8Array(await blob.arrayBuffer()));
  preview.lines = preview.lines.slice(0, 2);
  preview.totals = { gross: "41.00", discount: "0.00", net: "41.00", freight: "15.50", tax: "0.20", total: "56.70" };
  const small = await buildInvoicePdf(preview);
  await fs.writeFile(`${output}/${region.toLowerCase()}-singlepage-test.pdf`, new Uint8Array(await small.arrayBuffer()));
  console.log(`${region}: generated single- and multi-page PDFs`);
}
