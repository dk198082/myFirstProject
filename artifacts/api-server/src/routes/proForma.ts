import { Router, type IRouter } from "express";
import { PreviewProFormaBody } from "@workspace/api-zod";
import { requireInvoiceAccess } from "../lib/appAccess.js";
import { getCrmPool, isCrmConfigured } from "../lib/crmDb.js";
import { buildProposal, ProposalError } from "../lib/proForma.js";

const router: IRouter = Router();
router.post("/pro-forma/preview", requireInvoiceAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const result = PreviewProFormaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Enter a valid service order number, a non-negative sales tax percentage and freight amount with at most two decimal places, and an optional customer tax number of at most 100 characters with no control characters." });
    return;
  }
  const input = { ...result.data, serviceOrderNumber: result.data.serviceOrderNumber.trim() };
  if (res.locals.invoiceRole !== "editor" &&
      (!/^0+(?:\.0+)?$/.test(input.tax.trim()) || !/^0+(?:\.0+)?$/.test(input.freight.trim()) || input.customerTaxNumber?.trim())) {
    res.status(403).json({ error: "Read-only users cannot change tax, freight or customer Tax #." }); return;
  }
  if (!input.serviceOrderNumber || /[\x00-\x1f\x7f]/.test(input.serviceOrderNumber)) {
    res.status(400).json({ error: "Enter a valid service order number." }); return;
  }
  if (!isCrmConfigured()) {
    res.status(503).json({ error: "CRM is not configured. Contact your administrator." }); return;
  }
  let client;
  try {
    client = await getCrmPool().connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15000ms'");
    const headers = await client.query(`
      SELECT workorderid, workordernumber, serviceordernumber, ponumber,
        customeraccount, currency, territory_name,
        account_name, account_address1_line1, account_address1_line2, account_address1_line3,
        account_address1_city, account_address1_stateorprovince, account_address1_postalcode,
        account_address1_country, account_emailaddress1, account_telephone1,
        contact_fullname, contact_emailaddress1, contact_telephone1,
        delivery_addressname, delivery_address1, delivery_address2, delivery_address3,
        delivery_city, delivery_stateorprovince, delivery_postalcode, delivery_country,
        delivery_phonenumber, company_name, company_address, remit_to,
        company_phone, company_fax, company_vat_ein, company_url
       FROM crm.proposalheader
       WHERE serviceordernumber = $1 OR workordernumber = $1
       LIMIT 2
    `, [input.serviceOrderNumber]);
    if (!headers.rows.length) throw new ProposalError(404, "No proposal was found for this service or work order number. Check the number and try again.");
    if (headers.rows.length > 1) throw new ProposalError(409, "Multiple proposals match this order number. Ask your CRM administrator to resolve the duplicate.");
    const header = headers.rows[0];
    const lines = await client.query(`
      SELECT linenumber, linetype, description, uom, qty_orderd::text,
        unitamount::text, netamount::text
      FROM crm.proposalline
      WHERE workorderid = $1 AND serviceordernumber = $2
      ORDER BY linenumber NULLS LAST, linetype, sourcelinenumber NULLS LAST, sourcerecordid
      LIMIT 2001
    `, [header.workorderid, header.serviceordernumber]);
    if (lines.rows.length > 2000) throw new ProposalError(422, "This order exceeds the supported 2,000-line document limit. Contact your administrator.");
    const preview = buildProposal(header, lines.rows, input);
    await client.query("COMMIT");
    res.json(preview);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (err instanceof ProposalError) {
      res.status(err.status).json({ error: err.message });
    } else {
      // Do not send SQL details, credentials or customer records to logs or clients.
      req.log.error({ code: (err as { code?: string })?.code }, "Pro forma proposal lookup failed");
      res.status(503).json({ error: "CRM proposal data is temporarily unavailable. Please retry shortly." });
    }
  } finally { client?.release(); }
});
export default router;
