import { describe, expect, it } from "vitest";
import { buildProposal } from "./proForma";

const header = {
  territory_name: "R1", currency: "USD", company_name: "TOUS",
  serviceordernumber: "SV123", workordernumber: "WO123", customeraccount: "TEST",
  account_name: "Test customer", company_address: "Company address", remit_to: "Remittance",
};
const input = { serviceOrderNumber: "SV123", tax: "0", freight: "0" };
const line = { linenumber: 1, linetype: "PRODUCT", description: "Test item", uom: "Each", qty_orderd: "3", unitamount: "0.10", netamount: "0.30" };
describe("pro forma calculations", () => {
  it("preserves the entered customer tax identifier without changing CRM data", () => {
    const p = buildProposal(header, [line], { ...input, customerTaxNumber: "  GB-001234-A  " });
    expect(p.customerTaxNumber).toBe("GB-001234-A");
    expect(p.header).not.toHaveProperty("customerTaxNumber");
    expect(buildProposal(header, [line], input).customerTaxNumber).toBe("");
  });
  it("applies the entered percentage to net and adds freight using the service order reference", () => {
    const p = buildProposal(header, [line], { ...input, tax: "20", freight: "0.10" });
    expect(p.reference).toBe("WO123 / SV123");
    expect(p.totals).toEqual({ gross: "0.30", net: "0.30", discount: "0.00", tax: "0.08", freight: "0.10", freightTax: "0.02", total: "0.48" });
  });
  it("sums taxes rounded per line, rather than taxing the combined net", () => {
    const rows = [1, 2, 3].map((linenumber) => ({ ...line, linenumber, netamount: "0.05" }));
    const p = buildProposal(header, rows, { ...input, tax: "10" });
    expect(p.totals.net).toBe("0.15");
    expect(p.totals.tax).toBe("0.03");
    expect(p.taxRate).toBe("10");
    expect(p.lines.map((row) => row.taxAmount)).toEqual(["0.01", "0.01", "0.01"]);
    expect(p.totals.total).toBe("0.18");
  });
  it("uses each line's net, not gross, and taxes freight with the same fractional rate", () => {
    const rows = [
      { ...line, linenumber: 1, qty_orderd: "1", unitamount: "200", netamount: "100" },
      { ...line, linenumber: 2, qty_orderd: "1", unitamount: "100", netamount: "50" },
    ];
    const p = buildProposal(header, rows, { ...input, tax: "7.25", freight: "20" });
    expect(p.totals.freightTax).toBe("1.45");
    expect(p.totals.tax).toBe("12.33");
    expect(p.lines.map((row) => row.taxAmount)).toEqual(["7.25", "3.63"]);
    expect(p.totals.total).toBe("182.33");
  });
  it("rounds freight tax separately half-up before summing it with line tax", () => {
    const p = buildProposal(header, [{ ...line, netamount: "0.05" }], { ...input, tax: "10", freight: "0.05" });
    expect(p.lines[0].taxAmount).toBe("0.01");
    expect(p.totals.freightTax).toBe("0.01");
    expect(p.totals.tax).toBe("0.02");
    expect(p.totals.total).toBe("0.12");
  });
  it("keeps freight tax zero for zero freight or zero tax, including UK invoices", () => {
    expect(buildProposal(header, [line], { ...input, tax: "10" }).totals.freightTax).toBe("0.00");
    const p = buildProposal({ ...header, territory_name: "R4", currency: "GBP", company_name: "TOUK" }, [line], { ...input, freight: "100" });
    expect(p.totals.freightTax).toBe("0.00");
    expect(p.totals.tax).toBe("0.00");
    expect(p.totals.total).toBe("100.30");
  });
  it("applies the percentage to negative adjustment lines", () => {
    const p = buildProposal(header, [{ ...line, netamount: "-100" }], { ...input, tax: "7.5" });
    expect(p.totals.tax).toBe("-7.50");
    expect(p.lines[0].taxAmount).toBe("-7.50");
    expect(p.totals.total).toBe("-107.50");
  });
  it("rounds each visible line half-up and sums those values", () => {
    const p = buildProposal(header, [{ ...line, qty_orderd: "1", unitamount: "1.005", netamount: "0.005" }], input);
    expect(p.totals.gross).toBe("1.01");
    expect(p.totals.net).toBe("0.01");
  });
  it.each(["R1", "R2", "R3", "R5"])("maps %s to US/USD", (territory_name) => {
    expect(buildProposal({ ...header, territory_name }, [line], input).region).toBe("US");
  });
  it("uses the entered percentage for UK, including zero rather than a default rate", () => {
    const p = buildProposal({ ...header, territory_name: "R4", currency: "GBP", company_name: "TOUK", account_address1_country: "GB" }, [line], { ...input, tax: "0" });
    expect(p.region).toBe("UK"); expect(p.totals.tax).toBe("0.00");
    expect(p.taxRate).toBe("0"); expect(p.lines[0].taxAmount).toBe("0.00");
  });
  it.each([
    { territory_name: "R99" }, { currency: "GBP" }, { company_name: "TOUK" },
    { customeraccount: null }, { account_name: "" },
  ])("rejects unsupported or incomplete headers %j", (patch) => {
    expect(() => buildProposal({ ...header, ...patch }, [line], input)).toThrow();
  });
  it.each([null, "", "NaN", "Infinity", "not-a-number"])("rejects invalid line numbers %s", (value) => {
    expect(() => buildProposal(header, [{ ...line, netamount: value }], input)).toThrow();
  });
  it("does not fabricate an invoice without lines", () => expect(() => buildProposal(header, [], input)).toThrow(/Order WO123 \/ SV123 was found.*no charge lines/));
  it("allows real signed adjustments", () => {
    const p = buildProposal(header, [{ ...line, unitamount: "-1", netamount: "-3" }], input);
    expect(p.totals.total).toBe("-3.00");
  });
});
