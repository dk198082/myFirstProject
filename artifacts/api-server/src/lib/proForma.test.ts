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
  it("adds exact entered amounts and uses the service order reference", () => {
    const p = buildProposal(header, [line], { ...input, tax: "0.20", freight: "0.10" });
    expect(p.reference).toBe("WO123 / SV123");
    expect(p.totals).toEqual({ gross: "0.30", net: "0.30", discount: "0.00", tax: "0.20", freight: "0.10", total: "0.60" });
  });
  it("rounds each visible line half-up and sums those values", () => {
    const p = buildProposal(header, [{ ...line, qty_orderd: "1", unitamount: "1.005", netamount: "0.005" }], input);
    expect(p.totals.gross).toBe("1.01");
    expect(p.totals.net).toBe("0.01");
  });
  it.each(["R1", "R2", "R3", "R5"])("maps %s to US/USD", (territory_name) => {
    expect(buildProposal({ ...header, territory_name }, [line], input).region).toBe("US");
  });
  it("uses entered tax for UK rather than automatic percentage", () => {
    const p = buildProposal({ ...header, territory_name: "R4", currency: "GBP", company_name: "TOUK", account_address1_country: "GB" }, [line], { ...input, tax: "0" });
    expect(p.region).toBe("UK"); expect(p.totals.tax).toBe("0.00");
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
