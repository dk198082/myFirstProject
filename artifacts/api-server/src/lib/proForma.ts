import Decimal from "decimal.js";
import type { ProFormaInput, ProFormaPreview } from "@workspace/api-zod";

export class ProposalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Row = Record<string, unknown>;
const text = (v: unknown) => v == null ? "" : String(v).trim();
const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);

function decimal(v: unknown, field: string): Decimal {
  if (v == null || text(v) === "") throw new ProposalError(422, `Proposal line is missing ${field}. Correct the CRM data before generating a PDF.`);
  let value: Decimal;
  try { value = new Decimal(text(v)); } catch { throw new ProposalError(422, `Proposal line has an invalid ${field}.`); }
  if (!value.isFinite() || value.abs().greaterThan("1000000000000")) {
    throw new ProposalError(422, `Proposal line has an unsupported ${field}.`);
  }
  return value;
}

export function buildProposal(header: Row, rows: Row[], input: ProFormaInput, now = new Date()): ProFormaPreview {
  const territory = text(header.territory_name).toUpperCase();
  const region = territory === "R4" ? "UK" : ["R1", "R2", "R3", "R5"].includes(territory) ? "US" : null;
  if (!region) throw new ProposalError(422, `Territory ${territory || "(missing)"} is not supported. Supported territories are R1–R5.`);
  const currency = region === "UK" ? "GBP" : "USD";
  if (text(header.currency).toUpperCase() !== currency) throw new ProposalError(422, `Territory ${territory} requires ${currency}, but the proposal currency is ${text(header.currency) || "missing"}.`);
  const expectedCompany = region === "UK" ? "TOUK" : "TOUS";
  if (text(header.company_name) !== expectedCompany) throw new ProposalError(422, `The proposal company does not match territory ${territory}. Correct the CRM company before generating a PDF.`);
  for (const key of ["serviceordernumber", "workordernumber", "account_name", "customeraccount", "company_address", "remit_to"]) {
    if (!text(header[key])) throw new ProposalError(422, `The proposal is missing ${key.replaceAll("_", " ")}. Correct the CRM data before generating a PDF.`);
  }
  if (!rows.length) throw new ProposalError(422, `Order ${text(header.workordernumber)} / ${text(header.serviceordernumber)} was found, but the CRM proposal source has no charge lines. Check the charges and CRM data sync before generating a PDF.`);
  let gross = new Decimal(0);
  let net = new Decimal(0);
  let tax = new Decimal(0);
  const taxRate = new Decimal(input.tax);
  const freight = money(new Decimal(input.freight));
  const freightTax = money(new Decimal(freight).mul(taxRate).div(100));
  const lines = rows.map((row) => {
    const quantity = decimal(row.qty_orderd, "quantity");
    const unit = decimal(row.unitamount, "unit amount");
    const amount = decimal(row.netamount, "net amount");
    const lineNumber = Number(row.linenumber);
    if (!Number.isSafeInteger(lineNumber) || lineNumber < 1 || !text(row.description)) {
      throw new ProposalError(422, "A proposal line is missing its line number or description. Correct the CRM data before generating a PDF.");
    }
    gross = gross.plus(money(quantity.mul(unit)));
    net = net.plus(money(amount));
    // Sum rounded, per-line tax on the same net amounts shown on the invoice.
    const taxAmount = money(new Decimal(money(amount)).mul(taxRate).div(100));
    tax = tax.plus(taxAmount);
    return {
      lineNumber, type: text(row.linetype), description: text(row.description),
      uom: text(row.uom), quantity: quantity.toFixed(), unitAmount: unit.toFixed(),
      netAmount: money(amount), taxAmount,
    };
  });
  tax = tax.plus(freightTax);
  const warnings: string[] = [];
  for (const [key, label] of [
    ["ponumber", "Purchase order number"], ["contact_fullname", "Billing contact"],
    ["contact_telephone1", "Billing contact phone"], ["account_address1_line1", "Billing street address"],
    ["account_address1_country", "Billing country"], ["delivery_addressname", "Delivery name"],
    ["delivery_address1", "Delivery street address"], ["delivery_country", "Delivery country"],
    ["company_phone", "Company phone"], ["company_vat_ein", "Company tax identifier"],
  ]) if (!text(header[key])) warnings.push(`${label} is missing in CRM.`);
  const normalizedHeader = Object.fromEntries(Object.entries(header).map(([k, v]) => [k, v == null ? null : text(v)]));
  return {
    serviceOrderNumber: text(header.serviceordernumber),
    reference: `${text(header.workordernumber)} / ${text(header.serviceordernumber)}`,
    customerTaxNumber: input.customerTaxNumber?.trim() || "",
    taxRate: taxRate.toFixed(),
    generatedAt: now.toISOString(), region, currency, header: normalizedHeader, lines,
    totals: {
      gross: money(gross), discount: "0.00", net: money(net),
      freight, freightTax, tax: money(tax),
      total: money(net.plus(freight).plus(tax)),
    },
    warnings,
  };
}
