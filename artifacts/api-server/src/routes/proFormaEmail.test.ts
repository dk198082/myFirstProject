import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import session from "express-session";
import request from "supertest";
const mocks = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock("../lib/graphMail.js", () => ({ getGraphAccessToken: mocks.token }));
vi.mock("../lib/appAccess.js", () => ({
  requireInvoiceAccess: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.session.user) { res.status(401).json({ error: "Login required" }); return; }
    res.locals.invoiceRole = req.session.user.role; next();
  },
}));
import router from "./proFormaEmail.js";
const oid = "11111111-1111-4111-8111-111111111111";
const pdfBase64 = Buffer.from("%PDF-1.7\nSynthetic test attachment\n%%EOF").toString("base64");
const input = { to: "recipient@example.invalid", subject: "Pro forma invoice SV-TEST", message: "Attached is the reviewed invoice.", filename: "ProformaInvoice_Test Company(PO 1)_SV-TEST.pdf", pdfBase64 };
function app() {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(session({ secret: "test-only", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => { req.log = { error: vi.fn() } as unknown as typeof req.log; next(); });
  app.get("/seed/:role", (req, res) => {
    req.session.user = { entraOid: oid, email: "sender@example.invalid", displayName: "Test", role: String(req.params.role) };
    res.sendStatus(204);
  });
  app.use("/api", router); return app;
}
async function editor(role = "editor") {
  const agent = request.agent(app()); await agent.get(`/seed/${role}`); return agent;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.token.mockResolvedValue("test-only-mail-token");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 202 }));
});
afterEach(() => vi.unstubAllGlobals());
describe("invoice email", () => {
  it("requires login and independently restricts sending to invoice editors", async () => {
    await request(app()).post("/api/pro-forma/email").send(input).expect(401);
    await (await editor("viewer")).post("/api/pro-forma/email").send(input).expect(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("sends the exact PDF from the authenticated mailbox with a Sent Items copy", async () => {
    const result = await (await editor()).post("/api/pro-forma/email").send(input).expect(202);
    expect(result.body.message).toContain("submitted");
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe(`https://graph.microsoft.com/v1.0/users/${oid}/sendMail`);
    const payload = JSON.parse(String(options?.body));
    expect(payload.saveToSentItems).toBe(true);
    expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: input.to } }]);
    expect(payload.message.body).toEqual({ contentType: "Text", content: input.message });
    expect(payload.message.attachments).toEqual([{
      "@odata.type": "#microsoft.graph.fileAttachment", contentType: "application/pdf",
      name: input.filename, contentBytes: pdfBase64,
    }]);
  });
  it.each([
    { ...input, from: "other-user@example.invalid" },
    { ...input, to: "not-an-email" },
    { ...input, subject: "Subject\r\nBcc: attacker@example.invalid" },
    { ...input, filename: "../invoice.pdf" },
    { ...input, pdfBase64: Buffer.from("not a PDF").toString("base64") },
    { ...input, pdfBase64: `${pdfBase64}!!!!` },
  ])("rejects spoofed sender or invalid email/attachment input", async (body) => {
    await (await editor()).post("/api/pro-forma/email").send(body).expect(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts safe Unicode, spaces and parentheses in existing invoice filenames", async () => {
    await (await editor()).post("/api/pro-forma/email").send({ ...input, filename: "ProformaInvoice_Café UK(PO 1)_SV-TEST.pdf" }).expect(202);
  });
  it("rejects oversized PDFs before contacting Microsoft", async () => {
    const large = Buffer.alloc(2.5 * 1024 * 1024 + 1, "a"); large.write("%PDF-");
    await (await editor()).post("/api/pro-forma/email").send({ ...input, pdfBase64: large.toString("base64") }).expect(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports mailbox permission failures without returning provider details", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 403 } as Response);
    const result = await (await editor()).post("/api/pro-forma/email").send(input).expect(503);
    expect(result.body.error).toContain("mailbox");
    expect(result.body.detail).toBeUndefined();
  });
  it("warns about an uncertain send rather than automatically sending a duplicate", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network timeout"));
    const result = await (await editor()).post("/api/pro-forma/email").send(input).expect(504);
    expect(result.body.error).toContain("Sent Items");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("does not send when the mail service cannot authenticate", async () => {
    mocks.token.mockRejectedValueOnce(new Error("Provider-specific details"));
    const result = await (await editor()).post("/api/pro-forma/email").send(input).expect(503);
    expect(result.body.error).not.toContain("Provider-specific");
    expect(fetch).not.toHaveBeenCalled();
  });
});
