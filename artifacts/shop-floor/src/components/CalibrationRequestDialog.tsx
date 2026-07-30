import { useEffect, useState } from "react";
import { useSendCalibrationRequest } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Gauge, Send, AlertCircle, CheckCircle2 } from "lucide-react";

const CALIBRATION_TO = "BWood@tiniusolsen.com";

export function CalibrationRequestDialog({
  prodid,
  productiongroupid,
  itemname,
  demandsalesordernumber,
}: {
  prodid: string;
  productiongroupid?: string | null;
  itemname?: string | null;
  demandsalesordernumber?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [fromEmail, setFromEmail] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const mutation = useSendCalibrationRequest();

  const autoSubject = (() => {
    const parts = ["CALIBRATION READY", prodid];
    if (productiongroupid) parts.push(productiongroupid);
    if (demandsalesordernumber) parts.push(demandsalesordernumber);
    return parts.join(" - ");
  })();
  const autoBody = `${itemname?.trim() || prodid} is ready for calibration`;

  useEffect(() => {
    if (open) {
      setSent(false);
      setBody(autoBody);
      mutation.reset();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errMessage = (() => {
    const e = mutation.error as unknown;
    if (!e) return null;
    if (typeof e === "object" && e !== null && "message" in e && typeof (e as { message?: unknown }).message === "string") {
      return (e as { message: string }).message;
    }
    return "Sending failed. Please try again.";
  })();

  const send = () => {
    if (!fromEmail.trim() || !body.trim()) return;
    mutation.mutate(
      {
        data: {
          prodid,
          fromEmail: fromEmail.trim(),
          ordername: itemname?.trim() || prodid,
          productiongroupname: productiongroupid ?? undefined,
          subject: autoSubject,
          demandsalesordernumber: demandsalesordernumber ?? null,
        },
      },
      {
        onSuccess: () => {
          setSent(true);
          setBody("");
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
        data-testid="btn-request-calibration"
      >
        <Gauge className="w-4 h-4" />
        <span className="hidden sm:inline">Request Calibration</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Request Calibration
            </DialogTitle>
          </DialogHeader>

          {sent ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="w-10 h-10 text-green-600" />
              <p className="font-medium">Calibration request sent</p>
              <p className="text-sm text-muted-foreground">
                {CALIBRATION_TO} has been notified that this order is ready for calibration.
              </p>
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} data-testid="btn-close-calibration">
                Close
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cal-from">Your email</Label>
                  <Input
                    id="cal-from"
                    type="email"
                    value={fromEmail}
                    onChange={(e) => setFromEmail(e.target.value)}
                    placeholder="you@tiniusolsen.com"
                    data-testid="input-calibration-from"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>To</Label>
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
                    {CALIBRATION_TO}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Subject</Label>
                <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground select-all">
                  {autoSubject}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cal-body">Message</Label>
                <Textarea
                  id="cal-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={5000}
                  data-testid="input-calibration-body"
                />
              </div>

              {errMessage && (
                <div className="flex items-start gap-2 p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{errMessage}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} data-testid="btn-cancel-calibration">
                  Cancel
                </Button>
                <Button
                  onClick={send}
                  disabled={mutation.isPending || !fromEmail.trim() || !body.trim()}
                  className="flex items-center gap-2"
                  data-testid="btn-send-calibration"
                >
                  <Send className="w-4 h-4" />
                  {mutation.isPending ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
