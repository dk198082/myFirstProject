import { useEffect, useState } from "react";
import { useSendStoreroomRequest } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Send, AlertCircle, CheckCircle2 } from "lucide-react";

const DEFAULT_TO = "DTait@tiniusolsen.com";
const DEFAULT_CC = ["CKnabb@tiniusolsen.com", "DGoodwin@tiniusolsen.com"];

// "Request parts" dialog on the production-order detail page. Sends an email
// to the storeroom inbox through Exchange Online via the API server.
export function StoreroomRequestDialog({
  prodid,
  productiongroupid,
}: {
  prodid: string;
  productiongroupid?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [subjectEdited, setSubjectEdited] = useState(false);
  const [message, setMessage] = useState("");
  const [requestedBy, setRequestedBy] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [sent, setSent] = useState(false);

  const mutation = useSendStoreroomRequest();

  // Default subject: "Order {prodid} {group}-{name}". Auto-recomputed as the
  // name is typed until the user manually edits the subject field.
  const defaultSubject = () => {
    const group = productiongroupid ? ` ${productiongroupid}` : "";
    return `Order ${prodid}${group}${requestedBy.trim() ? `-${requestedBy.trim()}` : ""}`;
  };

  // Reset state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSubjectEdited(false);
      setSent(false);
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the subject in sync with the prefill unless manually edited.
  useEffect(() => {
    if (open && !subjectEdited) setSubject(defaultSubject());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subjectEdited, requestedBy, prodid, productiongroupid]);

  const errMessage = (() => {
    const e = mutation.error as unknown;
    if (!e) return null;
    if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message?: unknown }).message === "string") {
      return (e as { message: string }).message;
    }
    return "Sending failed. Please try again.";
  })();

  const send = () => {
    if (!subject.trim() || !message.trim()) return;
    mutation.mutate(
      {
        data: {
          prodid,
          subject: subject.trim(),
          message: message.trim(),
          ...(requestedBy.trim() ? { requestedBy: requestedBy.trim() } : {}),
          ...(fromEmail.trim() ? { fromEmail: fromEmail.trim() } : {}),
          toEmail: DEFAULT_TO,
          cc: DEFAULT_CC,
        },
      },
      {
        onSuccess: () => {
          setSent(true);
          setMessage("");
        },
      },
    );
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="print:hidden flex items-center gap-2 shrink-0"
        onClick={() => setOpen(true)}
        data-testid="btn-request-parts"
      >
        <Mail className="w-4 h-4" />
        <span className="hidden sm:inline">Request Parts</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="w-4 h-4" /> Request parts from storeroom
            </DialogTitle>
          </DialogHeader>

          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
              <p className="font-medium">Request sent to the storeroom</p>
              <p className="text-sm text-muted-foreground">
                The storeroom will receive it in their email inbox.
              </p>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} data-testid="btn-close-request">
                Close
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="req-from">Your email</Label>
                  <Input
                    id="req-from"
                    type="email"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    placeholder="you@tiniusolsen.com"
                    data-testid="input-request-from"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>To</Label>
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
                    {DEFAULT_TO}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>CC</Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
                  {DEFAULT_CC.join(", ")}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="req-by">Your name (optional)</Label>
                <Input
                  id="req-by"
                  value={requestedBy}
                  onChange={(e) => setRequestedBy(e.target.value)}
                  placeholder="e.g. Mike D"
                  data-testid="input-requested-by"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="req-subject">Subject</Label>
                <Input
                  id="req-subject"
                  value={subject}
                  onChange={(e) => {
                    setSubject(e.target.value);
                    setSubjectEdited(true);
                  }}
                  maxLength={300}
                  data-testid="input-request-subject"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="req-message">Message</Label>
                <Textarea
                  id="req-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={5000}
                  placeholder="e.g. The assembler is missing fasteners XXXX from the kit. Please review ASAP and issue to Mike."
                  data-testid="input-request-message"
                />
              </div>

              {errMessage && (
                <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errMessage}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} data-testid="btn-cancel-request">
                  Cancel
                </Button>
                <Button
                  onClick={send}
                  disabled={mutation.isPending || !subject.trim() || !message.trim()}
                  className="flex items-center gap-2"
                  data-testid="btn-send-request"
                >
                  <Send className="w-4 h-4" />
                  {mutation.isPending ? "Sending…" : "Send to storeroom"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
