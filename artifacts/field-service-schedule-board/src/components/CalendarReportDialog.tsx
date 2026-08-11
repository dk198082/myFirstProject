/**
 * CalendarReportDialog — coordinator tool to generate and deliver 3–6 month
 * per-technician schedule summaries as PDF, Word, or email.
 *
 * Privacy guarantee: one file / email per technician, never combined.
 */
import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Download,
  Mail,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Users,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchCalendarReport,
  sendCalendarReportEmail,
  groupEventsByMonth,
  fmtDate,
  addMonths,
  buildDateRangeLabel,
  eventDisplayName,
  eventSubline,
  eventLines,
  EVENT_STYLE_MAP,
  type ReportTechnician,
  type EmailSendResult,
} from "@/lib/calendarReportApi";
import { generateTechPdf, blobToBase64 } from "@/lib/calendarReportPdf";
import { generateTechDocx } from "@/lib/calendarReportDocx";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CalendarReportTech = {
  id: string;
  name: string;
  email: string | null;
};

type Props = {
  technicians: CalendarReportTech[];
  onClose: () => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Current month as "YYYY-MM" string */
function currentMonthKey(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" → human label "August 2026" */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Build list of YYYY-MM options from now through next 9 months */
function buildMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  const baseKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  for (let i = 0; i < 10; i++) {
    const key = addMonths(`${baseKey}-01`, i).slice(0, 7);
    opts.push({ value: key, label: monthLabel(key) });
  }
  return opts;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Let the browser register each download separately when several are queued. */
function pauseBetweenDownloads(index: number, total: number): Promise<void> {
  if (index >= total - 1) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, 150));
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TechPreview({ tech }: { tech: ReportTechnician }) {
  const [expanded, setExpanded] = useState(true);
  const months = groupEventsByMonth(tech.events);
  const totalEvents = tech.events.length;

  return (
    <div className="border rounded-lg overflow-hidden text-sm">
      <button
        type="button"
        className="w-full flex items-center justify-between bg-slate-50 px-4 py-2.5 hover:bg-slate-100 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="min-w-0 text-left">
          <span className="font-semibold text-slate-800 block">
            {tech.resource_name ?? "Unknown"}
          </span>
          {tech.user_email && (
            <span className="text-[11px] text-slate-500 block truncate">
              {tech.user_email}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 text-slate-500">
          <Badge variant="secondary" className="text-xs">
            {totalEvents} event{totalEvents !== 1 ? "s" : ""}
          </Badge>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="divide-y">
          {months.length === 0 && (
            <p className="px-4 py-3 text-slate-400 italic text-xs">
              No scheduled activity in this period.
            </p>
          )}
          {months.map((month) => (
            <div key={month.key}>
              <div className="px-4 py-2 bg-blue-900 text-white text-xs font-semibold">
                {month.label} — {month.events.length} event{month.events.length !== 1 ? "s" : ""}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-blue-50 text-blue-800 text-sm">
                    <th className="text-left px-3 py-2 w-28">Type</th>
                    <th className="text-left px-3 py-2 w-36">Date</th>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2 w-40">Info</th>
                  </tr>
                </thead>
                <tbody>
                  {month.events.map((ev, i) => {
                    const s = EVENT_STYLE_MAP[ev.kind];
                    const dateFmt = fmtDate(ev.start_time);
                    const sub = eventSubline(ev);
                    const lines = eventLines(ev);
                    return (
                      <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-3 py-2 align-top">
                          <span
                            className="inline-block text-xs font-semibold px-1.5 py-0.5 rounded"
                            style={{ color: s.dialogColor, backgroundColor: s.pdfBg, border: `1px solid ${s.pdfBorder}` }}
                          >
                            {s.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top text-slate-600 text-xs">
                          {dateFmt || "—"}
                        </td>
                        <td className="px-3 py-2 align-top text-slate-700">
                          {ev.kind === "job" ? (
                            <div className="space-y-0.5">
                              {lines.map((line, lineIndex) => (
                                <div key={lineIndex} className={lineIndex === 0 ? "font-medium" : "text-slate-500"}>
                                  {line}
                                </div>
                              ))}
                            </div>
                          ) : (
                            eventDisplayName(ev)
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-slate-500 text-xs">
                          {sub ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {month.events.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-slate-400 italic">
                        No activity this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main dialog ───────────────────────────────────────────────────────────────

type Phase = "configure" | "preview";
type ActionState = "idle" | "loading" | "done";

export function CalendarReportDialog({ technicians, onClose }: Props) {
  const { toast } = useToast();

  // ── Selection state ──────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(technicians.map((t) => t.id)),
  );
  const [startMonth, setStartMonth] = useState(() => currentMonthKey());
  const [monthCount, setMonthCount] = useState(3);

  const monthOptions = buildMonthOptions();

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === technicians.length
        ? new Set()
        : new Set(technicians.map((t) => t.id)),
    );
  }, [technicians]);

  const toggleTech = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ── Date range ───────────────────────────────────────────────────────────
  const startDate = `${startMonth}-01`;
  const endDate = addMonths(startDate, monthCount);
  const dateRangeLabel = buildDateRangeLabel(startDate, endDate);

  // ── Fetch / preview state ─────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("configure");
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [reportData, setReportData] = useState<ReportTechnician[] | null>(null);

  const handleFetch = useCallback(async () => {
    if (selectedIds.size === 0) {
      toast({ title: "No technicians selected", variant: "destructive" });
      return;
    }
    setFetching(true);
    setFetchError(null);
    try {
      const data = await fetchCalendarReport(
        Array.from(selectedIds),
        startDate,
        endDate,
      );
      setReportData(data.technicians);
      setPhase("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFetchError(msg);
      toast({ title: "Failed to load schedule data", description: msg, variant: "destructive" });
    } finally {
      setFetching(false);
    }
  }, [selectedIds, startDate, endDate, toast]);

  // ── PDF download ──────────────────────────────────────────────────────────
  const [pdfState, setPdfState] = useState<ActionState>("idle");

  const handleDownloadPdf = useCallback(async () => {
    if (!reportData) return;
    setPdfState("loading");
    try {
      if (reportData.length === 1) {
        const blob = await generateTechPdf(reportData[0], dateRangeLabel, startDate, endDate);
        const fname = `Schedule_${safeName(reportData[0].resource_name ?? "Tech")}_${safeName(dateRangeLabel)}.pdf`;
        downloadBlob(blob, fname);
      } else {
        // Multiple technicians → one private file per technician.
        for (const [index, tech] of reportData.entries()) {
          const blob = await generateTechPdf(tech, dateRangeLabel, startDate, endDate);
          const fname = `Schedule_${safeName(tech.resource_name ?? "Tech")}_${safeName(dateRangeLabel)}.pdf`;
          downloadBlob(blob, fname);
          await pauseBetweenDownloads(index, reportData.length);
        }
      }
      setPdfState("done");
      setTimeout(() => setPdfState("idle"), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "PDF generation failed", description: msg, variant: "destructive" });
      setPdfState("idle");
    }
  }, [reportData, dateRangeLabel, toast]);

  // ── Word download ─────────────────────────────────────────────────────────
  const [wordState, setWordState] = useState<ActionState>("idle");

  const handleDownloadWord = useCallback(async () => {
    if (!reportData) return;
    setWordState("loading");
    try {
      if (reportData.length === 1) {
        const blob = await generateTechDocx(reportData[0], dateRangeLabel, startDate, endDate);
        const fname = `Schedule_${safeName(reportData[0].resource_name ?? "Tech")}_${safeName(dateRangeLabel)}.docx`;
        downloadBlob(blob, fname);
      } else {
        // Multiple technicians → one private file per technician.
        for (const [index, tech] of reportData.entries()) {
          const blob = await generateTechDocx(tech, dateRangeLabel, startDate, endDate);
          const fname = `Schedule_${safeName(tech.resource_name ?? "Tech")}_${safeName(dateRangeLabel)}.docx`;
          downloadBlob(blob, fname);
          await pauseBetweenDownloads(index, reportData.length);
        }
      }
      setWordState("done");
      setTimeout(() => setWordState("idle"), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Word generation failed", description: msg, variant: "destructive" });
      setWordState("idle");
    }
  }, [reportData, dateRangeLabel, toast]);

  // ── Email ─────────────────────────────────────────────────────────────────
  const [emailState, setEmailState] = useState<ActionState>("idle");
  const [emailProgress, setEmailProgress] = useState<string | null>(null);
  const [emailResults, setEmailResults] = useState<EmailSendResult[] | null>(null);

  const techsWithEmail = reportData?.filter((t) => t.user_email) ?? [];
  const techsWithoutEmail = reportData?.filter((t) => !t.user_email) ?? [];

  const handleSendEmail = useCallback(async () => {
    if (!reportData) return;
    if (techsWithEmail.length === 0) {
      toast({
        title: "No email addresses available",
        description: "None of the selected technicians have an email address on record.",
        variant: "destructive",
      });
      return;
    }
    setEmailState("loading");
    setEmailResults(null);
    setEmailProgress(null);
    try {
      // Send one email per technician so each request stays under the 5 MB
      // body limit (one PDF per call instead of all PDFs in a single payload).
      const results: EmailSendResult[] = [];
      for (let i = 0; i < techsWithEmail.length; i++) {
        const tech = techsWithEmail[i];
        setEmailProgress(
          `Sending ${i + 1} of ${techsWithEmail.length}: ${tech.resource_name ?? ""}…`,
        );
        const pdfBlob = await generateTechPdf(tech, dateRangeLabel, startDate, endDate);
        const pdfBase64 = await blobToBase64(pdfBlob);
        const result = await sendCalendarReportEmail({
          technician_id: tech.technician_id,
          start_date: startDate,
          end_date: endDate,
          pdf_base64: pdfBase64,
        });
        results.push(result);
      }
      setEmailResults(results);
      setEmailState("done");
      setEmailProgress(null);
      const successCount = results.filter((r) => r.success).length;
      if (successCount === results.length) {
        toast({
          title: `Sent ${successCount} email${successCount !== 1 ? "s" : ""} successfully`,
        });
      } else {
        toast({
          title: `${successCount} of ${results.length} emails sent`,
          description: "Some emails failed — see results below.",
          variant: "destructive",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Email sending failed", description: msg, variant: "destructive" });
      setEmailState("idle");
      setEmailProgress(null);
    }
  }, [reportData, techsWithEmail, dateRangeLabel, toast]);

  // ── Render ────────────────────────────────────────────────────────────────
  const selectedTechs = technicians.filter((t) => selectedIds.has(t.id));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-5 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-blue-600" />
            Technician Calendar Report
          </DialogTitle>
          <p className="text-sm text-slate-500 mt-1">
            Generate a 1–6 month schedule summary for each technician.
            Each technician receives their own private file.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          {/* ── Configuration panel ── */}
          <div className="px-6 py-4 border-b bg-slate-50">
            <div className="grid grid-cols-2 gap-6">
              {/* Date range */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Date Range</h3>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-slate-500 mb-1 block">Start month</label>
                    <Select value={startMonth} onValueChange={setStartMonth}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {monthOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32">
                    <label className="text-xs text-slate-500 mb-1 block">Months</label>
                    <Select
                      value={String(monthCount)}
                      onValueChange={(v) => setMonthCount(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6].map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} month{n !== 1 ? "s" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-blue-700 font-medium bg-blue-50 border border-blue-200 rounded px-2 py-1">
                  {dateRangeLabel}
                </p>
              </div>

              {/* Technician selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    Technicians
                  </h3>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={toggleAll}
                  >
                    {selectedIds.size === technicians.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="max-h-28 overflow-y-auto space-y-1 border rounded bg-white p-2">
                  {technicians.map((tech) => (
                    <label
                      key={tech.id}
                      className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 px-1 py-0.5 rounded"
                    >
                      <Checkbox
                        checked={selectedIds.has(tech.id)}
                        onCheckedChange={() => toggleTech(tech.id)}
                      />
                      <span className="flex-1 min-w-0 text-slate-700">
                        <span className="block truncate">{tech.name}</span>
                        {tech.email && (
                          <span className="block truncate text-[10px] text-slate-400">
                            {tech.email}
                          </span>
                        )}
                      </span>
                      {!tech.email && (
                        <span className="text-[10px] text-amber-600 shrink-0">no email</span>
                      )}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">
                  {selectedIds.size} of {technicians.length} selected
                </p>
              </div>
            </div>

            {/* Load button */}
            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  setPhase("configure");
                  setReportData(null);
                  setEmailResults(null);
                  handleFetch();
                }}
                disabled={fetching || selectedIds.size === 0}
              >
                {fetching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Loading…
                  </>
                ) : (
                  "Load Schedule Data"
                )}
              </Button>
            </div>
            {fetchError && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                {fetchError}
              </p>
            )}
          </div>

          {/* ── Preview panel ── */}
          {phase === "preview" && reportData && (
            <div className="px-6 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  Schedule Preview — {dateRangeLabel}
                </h3>
                <Badge variant="outline" className="text-xs">
                  {reportData.length} technician{reportData.length !== 1 ? "s" : ""}
                </Badge>
              </div>

              {reportData.map((tech) => (
                <TechPreview key={tech.technician_id} tech={tech} />
              ))}

              {/* Email results */}
              {emailResults && (
                <div className="border rounded-lg overflow-hidden mt-2">
                  <div className="bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600">
                    Email send results
                  </div>
                  <div className="divide-y">
                    {emailResults.map((r) => (
                      <div
                        key={r.technician_email}
                        className="flex items-center gap-3 px-4 py-2 text-sm"
                      >
                        {r.success ? (
                          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                        )}
                        <span className="flex-1">
                          <span className="font-medium">{r.technician_name}</span>
                          <span className="text-slate-400 ml-2 text-xs">{r.technician_email}</span>
                        </span>
                        {!r.success && r.error && (
                          <span className="text-xs text-red-600 truncate max-w-48">{r.error}</span>
                        )}
                      </div>
                    ))}
                    {techsWithoutEmail.length > 0 && (
                      <div className="px-4 py-2 text-xs text-amber-600 bg-amber-50">
                        {techsWithoutEmail.length} technician
                        {techsWithoutEmail.length !== 1 ? "s were" : " was"} skipped (no email
                        address):{" "}
                        {techsWithoutEmail.map((t) => t.resource_name).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer actions ── */}
        <DialogFooter className="px-6 py-4 border-t bg-white shrink-0">
          {phase === "preview" && reportData ? (
            <div className="flex w-full items-center justify-between gap-2 flex-wrap">
              <div className="flex gap-2 flex-wrap">
                {/* PDF */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPdf}
                  disabled={pdfState === "loading"}
                  className="gap-1.5"
                >
                  {pdfState === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : pdfState === "done" ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download PDF
                  {reportData.length > 1 && (
                    <span className="text-slate-400 text-xs ml-0.5">
                      ({reportData.length} files)
                    </span>
                  )}
                </Button>

                {/* Word */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadWord}
                  disabled={wordState === "loading"}
                  className="gap-1.5"
                >
                  {wordState === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : wordState === "done" ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Download Word
                  {reportData.length > 1 && (
                    <span className="text-slate-400 text-xs ml-0.5">
                      ({reportData.length} files)
                    </span>
                  )}
                </Button>

                {/* Email */}
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSendEmail}
                  disabled={emailState === "loading" || techsWithEmail.length === 0}
                  className="gap-1.5"
                >
                  {emailState === "loading" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : emailState === "done" ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <Mail className="h-4 w-4" />
                  )}
                  {emailState === "loading" && emailProgress
                    ? emailProgress
                    : `Send Email${techsWithEmail.length !== 1 ? "s" : ""} (${techsWithEmail.length})`}
                </Button>
              </div>

              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : (
            <div className="flex w-full justify-between">
              {/* Hint when not yet loaded */}
              <p className="text-xs text-slate-400 self-center">
                Select technicians and a date range, then click "Load Schedule Data" to preview.
              </p>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
