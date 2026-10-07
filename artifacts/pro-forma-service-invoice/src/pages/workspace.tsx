import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePreviewProForma, type ProFormaPreview } from "@workspace/api-client-react";
import { Button } from "@workspace/production-priority-design-system/components/ui/button";
import { Input } from "@workspace/production-priority-design-system/components/ui/input";
import { Label } from "@workspace/production-priority-design-system/components/ui/label";
import { Badge } from "@workspace/production-priority-design-system/components/ui/badge";
import { Skeleton } from "@workspace/production-priority-design-system/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/production-priority-design-system/components/ui/table";
import { cn } from "@workspace/production-priority-design-system/lib/utils";
import { toast } from "@workspace/production-priority-design-system/hooks/use-toast";
import { AlertTriangle, Download, FileSearch, FileText, Printer, RefreshCw, Search, X } from "lucide-react";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import type { SessionUser } from "@/lib/auth";
import { formatDateTime, groupHeader, humanize, money, validateAmount } from "@/lib/format";

type Fields = { serviceOrderNumber: string; tax: string; freight: string };
type FieldErrors = Partial<Record<keyof Fields, string>>;
type Failure = { kind: "notFound" | "conflict" | "invalid" | "unavailable" | "network" | "other"; title: string; detail: string };

function describeError(err: unknown): Failure | "unauthorized" {
  const e = err as { status?: number; data?: unknown; message?: string };
  const serverMsg =
    e?.data && typeof e.data === "object" && "error" in (e.data as object)
      ? String((e.data as { error: unknown }).error)
      : undefined;
  switch (e?.status) {
    case 401:
      return "unauthorized";
    case 404:
      return { kind: "notFound", title: "Order not found", detail: serverMsg ?? "No CRM proposal matches that service or work order number. Check the number and try again." };
    case 409:
      return { kind: "conflict", title: "Proposal data is inconsistent", detail: serverMsg ?? "The CRM records for this order conflict (for example region and currency disagree). Correct them in CRM, then retry." };
    case 422:
      return { kind: "invalid", title: "Request could not be processed", detail: serverMsg ?? "The server rejected the input or the proposal cannot be priced. Review the values and retry." };
    case 503:
      return { kind: "unavailable", title: "CRM is temporarily unavailable", detail: serverMsg ?? "The CRM connection is not responding. Wait a moment and retry." };
    case undefined:
      return { kind: "network", title: "Could not reach the server", detail: "Check your connection, then retry." };
    default:
      return { kind: "other", title: `Unexpected error (HTTP ${e.status})`, detail: serverMsg ?? e.message ?? "Please retry." };
  }
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{children}</h3>
);

export default function Workspace({ user, onUnauthorized, brand }: { user: SessionUser; onUnauthorized: () => void; brand: ReactNode }) {
  const [fields, setFields] = useState<Fields>({ serviceOrderNumber: "", tax: "", freight: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [preview, setPreview] = useState<ProFormaPreview | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<"idle" | "building" | "error">("idle");
  const reqSeq = useRef(0);
  const pdfSeq = useRef(0);
  const urlRef = useRef<string | null>(null);

  const mutation = usePreviewProForma();
  const resetRef = useRef(mutation.reset);
  resetRef.current = mutation.reset;
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  mutateAsyncRef.current = mutation.mutateAsync;
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  const setBlobUrl = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setPdfUrl(url);
  }, []);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const clearResult = useCallback(() => {
    reqSeq.current++;
    pdfSeq.current++;
    setPreview(null);
    setFailure(null);
    setPdfState("idle");
    setBlobUrl(null);
    resetRef.current();
  }, [setBlobUrl]);

  const update = (k: keyof Fields, v: string) => {
    setFields((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
    clearResult();
  };

  const run = useCallback(async (input: Fields) => {
    const id = ++reqSeq.current;
    pdfSeq.current++;
    setFailure(null);
    setPreview(null);
    setPdfState("idle");
    setBlobUrl(null);
    try {
      const result = await mutateAsyncRef.current({ data: input });
      if (id !== reqSeq.current) return;
      setPreview(result);
    } catch (err) {
      if (id !== reqSeq.current) return;
      const f = describeError(err);
      if (f === "unauthorized") {
        clearResult();
        toast({ title: "Session expired", description: "Sign in again to continue." });
        unauthorizedRef.current();
        return;
      }
      setFailure(f);
    }
  }, [clearResult, setBlobUrl]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const so = fields.serviceOrderNumber.trim();
    const next: FieldErrors = {};
    if (!so) next.serviceOrderNumber = "Service order number is required.";
    else if (so.length > 100) next.serviceOrderNumber = "Service order number is too long.";
    const t = validateAmount(fields.tax, "Sales tax");
    if (t) next.tax = t;
    const fr = validateAmount(fields.freight, "Freight");
    if (fr) next.freight = fr;
    setErrors(next);
    if (Object.keys(next).length) return;
    void run({ serviceOrderNumber: so, tax: fields.tax.trim(), freight: fields.freight.trim() });
  };

  const generatePdf = async () => {
    if (!preview) return;
    const id = ++pdfSeq.current;
    setPdfState("building");
    setBlobUrl(null);
    try {
      const blob = await buildInvoicePdf(preview);
      if (id !== pdfSeq.current) return;
      setBlobUrl(URL.createObjectURL(blob));
      setPdfState("idle");
    } catch {
      if (id !== pdfSeq.current) return;
      setPdfState("error");
    }
  };

  const fileName = preview ? `ProForma-${preview.serviceOrderNumber.replace(/[^\w.-]+/g, "_")}.pdf` : "ProForma.pdf";
  const loading = mutation.isPending;

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          {brand}
          <div className="flex items-center gap-3 text-right">
            <Badge variant="outline" className="hidden sm:inline-flex">Read-only</Badge>
            <div className="leading-tight">
              <div className="text-xs font-semibold" data-testid="text-user-name">{user.displayName ?? user.email ?? "Signed in"}</div>
              {user.email && user.displayName && <div className="text-[11px] text-muted-foreground">{user.email}</div>}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:px-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-[76px] lg:self-start">
          <form onSubmit={submit} noValidate className="rounded-sm border border-border bg-card p-5" aria-labelledby="lookup-title">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="grid h-5 w-5 place-items-center rounded-sm bg-primary/15">1</span> Lookup
            </div>
            <h1 id="lookup-title" className="mt-2 text-lg font-bold">Prepare a pro forma</h1>
            <p className="mt-1 text-xs text-muted-foreground">The service order number is the pro forma reference — no invoice number is allocated.</p>

            <div className="mt-5 space-y-4">
              <FieldRow id="so" label="Service / work order number" error={errors.serviceOrderNumber}>
                <Input id="so" value={fields.serviceOrderNumber} maxLength={100} autoComplete="off" spellCheck={false}
                  onChange={(e) => update("serviceOrderNumber", e.target.value)} placeholder="e.g. 839709 or SV-001360"
                  aria-invalid={!!errors.serviceOrderNumber} aria-describedby={errors.serviceOrderNumber ? "so-err" : undefined}
                  className="font-bold tracking-wide" data-testid="input-service-order" />
                <p className="text-[11px] text-muted-foreground">Either CRM number is accepted. The matched service order is shown in the review.</p>
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow id="tax" label="Sales tax" error={errors.tax}>
                  <Input id="tax" inputMode="decimal" value={fields.tax} onChange={(e) => update("tax", e.target.value)} placeholder="0.00"
                    aria-invalid={!!errors.tax} aria-describedby={errors.tax ? "tax-err" : "amount-hint"} className="tabular-nums" data-testid="input-tax" />
                </FieldRow>
                <FieldRow id="freight" label="Freight" error={errors.freight}>
                  <Input id="freight" inputMode="decimal" value={fields.freight} onChange={(e) => update("freight", e.target.value)} placeholder="0.00"
                    aria-invalid={!!errors.freight} aria-describedby={errors.freight ? "freight-err" : "amount-hint"} className="tabular-nums" data-testid="input-freight" />
                </FieldRow>
              </div>
              <p id="amount-hint" className="text-[11px] text-muted-foreground">Amounts, not percentages. Both required — enter 0 if none.</p>
            </div>

            <div className="mt-5 flex gap-2">
              <Button type="submit" className="flex-1" disabled={loading} data-testid="button-lookup">
                {loading ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                {loading ? "Reading CRM…" : "Review proposal"}
              </Button>
              {(preview || failure || fields.serviceOrderNumber || fields.tax || fields.freight) && (
                <Button type="button" variant="ghost" size="icon" aria-label="Clear form" data-testid="button-clear"
                  onClick={() => { setFields({ serviceOrderNumber: "", tax: "", freight: "" }); setErrors({}); clearResult(); }}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </aside>

        <section aria-live="polite" aria-busy={loading} className="min-w-0">
          {loading && <ReviewSkeleton />}
          {!loading && failure && (
            <div role="alert" className="rounded-sm border border-destructive/50 bg-destructive/10 p-5" data-testid="status-error">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-red-300">{failure.title}</h2>
                  <p className="mt-1 text-sm text-foreground/90">{failure.detail}</p>
                  <Button variant="outline" size="sm" className="mt-4" data-testid="button-retry"
                    onClick={() => void run({ serviceOrderNumber: fields.serviceOrderNumber.trim(), tax: fields.tax.trim(), freight: fields.freight.trim() })}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              </div>
            </div>
          )}
          {!loading && !failure && !preview && <EmptyState />}
          {!loading && preview && (
            <Review preview={preview} pdfUrl={pdfUrl} pdfState={pdfState} onGenerate={() => void generatePdf()} fileName={fileName} />
          )}
        </section>
      </main>
    </div>
  );
}

function FieldRow({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      {children}
      {error && <p id={`${id}-err`} className="text-[11px] text-red-400" data-testid={`error-${id}`}>{error}</p>}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-sm border border-dashed border-border bg-card/40 p-8 text-center" data-testid="state-empty">
      <div className="max-w-sm">
        <FileSearch className="mx-auto h-10 w-10 text-primary/70" aria-hidden />
        <h2 className="mt-4 text-base font-bold">No proposal loaded</h2>
        <p className="mt-2 text-sm text-muted-foreground">Enter a service or work order number with sales tax and freight. The CRM proposal header, addresses, lines and backend totals appear here for review before any PDF is produced.</p>
        <ol className="mx-auto mt-6 grid max-w-xs gap-2 text-left text-xs text-muted-foreground">
          {["Look up the CRM proposal", "Review every field and total", "Generate, download or print the PDF"].map((s, i) => (
            <li key={s} className="flex items-center gap-3"><span className="grid h-5 w-5 place-items-center rounded-sm border border-border text-[10px] font-bold text-primary">{i + 1}</span>{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading proposal">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}

function Review({ preview, pdfUrl, pdfState, onGenerate, fileName }: {
  preview: ProFormaPreview; pdfUrl: string | null; pdfState: "idle" | "building" | "error"; onGenerate: () => void; fileName: string;
}) {
  const { groups, empty } = useMemo(() => groupHeader(preview.header), [preview.header]);
  const cur = preview.currency;
  const t = preview.totals;

  return (
    <div className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="rounded-sm border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="grid h-5 w-5 place-items-center rounded-sm bg-primary/15">2</span> Review
            </div>
            <h2 className="mt-2 text-2xl font-bold tracking-tight" data-testid="text-reference">{preview.reference}</h2>
            <p className="mt-1 text-xs text-muted-foreground">Pro forma for service order <span className="font-semibold text-foreground" data-testid="text-service-order">{preview.serviceOrderNumber}</span> · prepared {formatDateTime(preview.generatedAt)}</p>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" data-testid="badge-region">Region {preview.region}</Badge>
            <Badge data-testid="badge-currency">{cur}</Badge>
          </div>
        </div>
        {preview.warnings.length > 0 && (
          <ul className="mt-4 space-y-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid="list-warnings">
            {preview.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /><span><span className="sr-only">Warning: </span>{w}</span></li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.id} className={cn("rounded-sm border border-border bg-card p-4", g.entries.length > 8 && "md:col-span-2")}>
            <SectionLabel>{g.title}</SectionLabel>
            <dl className={cn("mt-3 grid gap-x-6 gap-y-2.5", g.entries.length > 8 && "sm:grid-cols-2")}>
              {g.entries.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground" title={k}>{humanize(k)}</dt>
                  <dd className="whitespace-pre-line break-words text-sm text-foreground" data-testid={`field-${k}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {empty.length > 0 && (
        <details className="rounded-sm border border-border bg-card/50 px-4 py-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{empty.length} header field{empty.length === 1 ? "" : "s"} empty in CRM</summary>
          <p className="mt-2 break-words">{empty.map(humanize).join(", ")}</p>
        </details>
      )}

      <div className="rounded-sm border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <SectionLabel>Proposal lines</SectionLabel>
          <span className="text-[11px] text-muted-foreground">{preview.lines.length} line{preview.lines.length === 1 ? "" : "s"}</span>
        </div>
        {preview.lines.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">This proposal has no lines.</p>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-card">
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-24">Type</TableHead>
                  <TableHead className="min-w-[240px]">Description</TableHead>
                  <TableHead>UoM</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.lines.map((l) => (
                  <TableRow key={l.lineNumber} data-testid={`row-line-${l.lineNumber}`}>
                    <TableCell className="font-bold text-primary tabular-nums">{l.lineNumber}</TableCell>
                    <TableCell className="text-xs">{l.type}</TableCell>
                    <TableCell className="whitespace-pre-line break-words text-sm">{l.description}</TableCell>
                    <TableCell className="text-xs">{l.uom}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(l.unitAmount, cur)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{money(l.netAmount, cur)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <dl className="ml-auto grid max-w-sm gap-1.5 border-t border-border p-4 text-sm" data-testid="totals">
          {([["Gross", t.gross], ["Discount", t.discount], ["Net", t.net], ["Freight", t.freight], ["Sales tax", t.tax]] as const).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-6"><dt className="text-muted-foreground">{k}</dt><dd className="tabular-nums">{money(v, cur)}</dd></div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-6 border-t border-border pt-2">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.16em]">Total {cur}</dt>
            <dd className="text-xl font-bold text-primary tabular-nums" data-testid="text-total">{money(t.total, cur)}</dd>
          </div>
        </dl>
      </div>

      <div className="rounded-sm border border-primary/40 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="grid h-5 w-5 place-items-center rounded-sm bg-primary/15">3</span> Document
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Generated locally in your browser from the reviewed values. Nothing is saved or sent.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!pdfUrl ? (
              <Button onClick={onGenerate} disabled={pdfState === "building"} data-testid="button-generate-pdf">
                {pdfState === "building" ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                {pdfState === "building" ? "Generating…" : "Generate PDF"}
              </Button>
            ) : (
              <>
                <Button asChild data-testid="button-download-pdf">
                  <a href={pdfUrl} download={fileName}><Download className="mr-2 h-4 w-4" /> Download PDF</a>
                </Button>
                <Button variant="outline" asChild data-testid="button-print-pdf">
                  <a href={pdfUrl} target="_blank" rel="noopener"><Printer className="mr-2 h-4 w-4" /> Open to print</a>
                </Button>
              </>
            )}
          </div>
        </div>
        {pdfState === "error" && (
          <p role="alert" className="mt-3 text-sm text-red-400" data-testid="status-pdf-error">The PDF could not be generated. <button className="underline" onClick={onGenerate}>Try again</button></p>
        )}
        {pdfState === "building" && <Skeleton className="mt-4 h-[480px] w-full" />}
        {pdfUrl && (
          <iframe title={`PDF preview ${preview.reference}`} src={pdfUrl} className="mt-4 h-[75dvh] min-h-[480px] w-full rounded-sm border border-border bg-muted" data-testid="frame-pdf" />
        )}
      </div>
    </div>
  );
}
