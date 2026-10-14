import { Router, type IRouter } from "express";
import { EmailProFormaBody } from "@workspace/api-zod";
import { requireInvoiceAccess } from "../lib/appAccess.js";
import { getGraphAccessToken } from "../lib/graphMail.js";

const router: IRouter = Router();
router.post("/pro-forma/email", requireInvoiceAccess, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (res.locals.invoiceRole !== "editor") {
    res.status(403).json({ error: "Only invoice editors can email PDFs." }); return;
  }
  const result = EmailProFormaBody.strict().safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Enter one valid recipient, a subject and message, and attach a PDF no larger than 2.5 MB." }); return;
  }
  const { to, subject, message, filename, pdfBase64 } = result.data;
  const sender = req.session.user;
  if (!sender?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender.email) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(sender.entraOid)) {
    res.status(503).json({ error: "Your signed-in account has no valid Microsoft 365 mailbox identity. Sign in again or contact your administrator." }); return;
  }
  const pdf = Buffer.from(pdfBase64, "base64");
  if (pdf.length > 2.5 * 1024 * 1024 || pdf.length < 5 ||
      pdf.toString("base64") !== pdfBase64 || pdf.subarray(0, 5).toString() !== "%PDF-") {
    res.status(400).json({ error: "The attachment must be a valid PDF no larger than 2.5 MB." }); return;
  }
  let token: string;
  try { token = await getGraphAccessToken(); }
  catch {
    req.log.error("Microsoft 365 authentication failed for invoice email");
    res.status(503).json({ error: "Microsoft 365 mail is unavailable. Ask your administrator to verify the existing Mail.Send permission." }); return;
  }
  try {
    // Neither the caller nor the UI may choose another user's From mailbox.
    const sent = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender.entraOid)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        message: {
          subject, body: { contentType: "Text", content: message },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: filename, contentType: "application/pdf", contentBytes: pdfBase64,
          }],
        },
        saveToSentItems: true,
      }),
    });
    if (sent.status !== 202) {
      req.log.error({ status: sent.status }, "Microsoft 365 rejected invoice email");
      res.status(503).json({ error: sent.status === 403
        ? "Microsoft 365 denied sending from your mailbox. Ask your administrator to verify Mail.Send permission and mailbox access."
        : "Microsoft 365 did not accept the email. Verify your mailbox and retry shortly." }); return;
    }
    res.status(202).json({ message: "Email submitted to Microsoft 365 with the PDF attached. A copy is saved in your Sent Items." });
  } catch {
    // A timeout can happen after acceptance: never automatically resend.
    req.log.error("Invoice email sending outcome could not be confirmed");
    res.status(504).json({ error: "Could not confirm whether the email was sent. Check your Microsoft 365 Sent Items before retrying to avoid sending a duplicate." });
  }
});
export default router;
