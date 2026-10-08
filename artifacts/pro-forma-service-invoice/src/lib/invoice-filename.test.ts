import assert from "node:assert/strict";
import { test } from "node:test";
import { invoiceFilename } from "./invoice-filename.ts";

test("uses the billing account, PO number and PDF pro forma reference", () => {
  assert.equal(invoiceFilename({
    header: { account_name: " Example Company ", ponumber: " PO-123 " },
    serviceOrderNumber: "SV378702",
  }), "ProformaInvoice_Example Company(PO-123)_SV378702.pdf");
});

test("keeps names safe for download without replacing legitimate Unicode", () => {
  assert.equal(invoiceFilename({
    header: { account_name: "Société / Example", ponumber: "PO:123?" },
    serviceOrderNumber: "SV\\378702",
  }), "ProformaInvoice_Société _ Example(PO_123_)_SV_378702.pdf");
});

test("does not invent a PO number when CRM has none", () => {
  assert.equal(invoiceFilename({
    header: { account_name: "Example Company", ponumber: null },
    serviceOrderNumber: "SV378702",
  }), "ProformaInvoice_Example Company()_SV378702.pdf");
});
