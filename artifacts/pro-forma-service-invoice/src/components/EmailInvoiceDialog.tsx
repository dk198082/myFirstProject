import { useRef, useState } from "react";
import { emailProForma, type ProFormaPreview } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@workspace/production-priority-design-system/components/ui/dialog";
import { Button } from "@workspace/production-priority-design-system/components/ui/button";
import { Input } from "@workspace/production-priority-design-system/components/ui/input";
import { Label } from "@workspace/production-priority-design-system/components/ui/label";
import { Textarea } from "@workspace/production-priority-design-system/components/ui/textarea";
import { Mail, Paperclip, RefreshCw } from "lucide-react";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { invoiceFilename } from "@/lib/invoice-filename";
import type { SessionUser } from "@/lib/auth";

export function EmailInvoiceDialog({ preview, user, onClose, onAccessCheck, onUnauthorized }: {
  preview: ProFormaPreview; user: SessionUser; onClose: () => void;
  onAccessCheck: () => Promise<SessionUser | null>; onUnauthorized: () => void;
}) {
  const [to, setTo] = useState(preview.header.account_emailaddress1 ?? "");
  const [subject, setSubject] = useState(`Pro forma invoice ${preview.serviceOrderNumber}`);
  const [message, setMessage] = useState(`Please find attached the pro forma invoice for ${preview.reference}.\n\nKind regards,\n${user.displayName ?? user.email ?? ""}`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const busy = useRef(false);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || success) return;
    busy.current = true; setSending(true); setError("");
    let submitted = false;
    try {
      const current = await onAccessCheck();
      if (current?.role !== "editor") {
        setError("Your invoice editing permission is no longer available."); return;
      }
      const pdf = await buildInvoicePdf(preview);
      if (pdf.size > 2.5 * 1024 * 1024) throw new Error("This PDF exceeds the 2.5 MB email attachment limit. Download it and send it using Outlook instead.");
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Could not attach the invoice PDF."));
        reader.readAsDataURL(pdf);
      });
      submitted = true;
      const result = await emailProForma({ to: to.trim(), subject: subject.trim(), message: message.trim(), filename: invoiceFilename(preview), pdfBase64 });
      setSuccess(result.message);
    } catch (err) {
      const e = err as { status?: number; data?: { error?: string }; message?: string };
      if (e.status === 401) onUnauthorized();
      setError(e.data?.error ?? (submitted && e.status === undefined
        ? "Could not confirm whether the email was sent. Check your Microsoft 365 Sent Items before retrying to avoid sending a duplicate."
        : e.message ?? "The email could not be sent. Please retry."));
    } finally { busy.current = false; setSending(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Email pro forma invoice</DialogTitle>
        <DialogDescription>Send from your Microsoft 365 mailbox with the reviewed PDF attached automatically.</DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void send(event)} className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="invoice-email-from">From</Label>
          <Input id="invoice-email-from" value={user.email ?? ""} readOnly data-testid="input-email-from" />
          <p className="text-xs text-muted-foreground">Your signed-in mailbox. A copy will be saved in Sent Items.</p></div>
        <div className="space-y-1.5"><Label htmlFor="invoice-email-to">To</Label>
          <Input id="invoice-email-to" type="email" required maxLength={254} value={to} onChange={(e) => setTo(e.target.value)} disabled={sending || !!success} placeholder="recipient@example.com" data-testid="input-email-to" /></div>
        <div className="space-y-1.5"><Label htmlFor="invoice-email-subject">Subject</Label>
          <Input id="invoice-email-subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={sending || !!success} data-testid="input-email-subject" /></div>
        <div className="space-y-1.5"><Label htmlFor="invoice-email-message">Message</Label>
          <Textarea id="invoice-email-message" required maxLength={10000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} disabled={sending || !!success} data-testid="input-email-message" /></div>
        <div className="flex items-start gap-2 rounded-sm border border-border bg-muted p-3 text-sm" data-testid="email-attachment">
          <Paperclip className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-all">{invoiceFilename(preview)}<span className="block text-xs text-muted-foreground">PDF · Includes the reviewed tax, freight and customer Tax #</span></span>
        </div>
        {error && <p role="alert" className="text-sm text-destructive" data-testid="email-error">{error}</p>}
        {success && <p role="status" className="text-sm text-primary" data-testid="email-success">{success}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={sending} onClick={onClose}>{success ? "Close" : "Cancel"}</Button>
          {!success && <Button type="submit" disabled={sending || !user.email} data-testid="button-send-email">
            {sending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
            {sending ? "Sending…" : "Send email"}
          </Button>}
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
